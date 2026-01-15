import 'server-only'
import { 
  fetchPaperMetadata, 
  normalizeScore,
  createEmptyResult,
  type RetrievedChunk,
  type BaseRetrievalResult,
  type SearchMode,
  type EvidenceStrength
} from './base-retrieval'
import { ChunkRetriever } from './chunk-retriever'
import { ContextBuilder } from './context-builder'
import { getContentStatus, ensureBulkContentIngestion } from '@/lib/content'
import { getPapersByIds } from '@/lib/db/library'
import { createDeterministicChunkId } from '@/lib/utils/deterministic-id'
import { 
  ContentRetrievalError, 
  NoRelevantContentError, 
  ContentQualityError 
} from '@/lib/content/errors'
import type { PaperWithAuthors } from '@/types/simplified'
import type { GeneratedOutline, SectionContext } from '@/lib/prompts/types'

/**
 * Generation Context Retrieval Service
 * 
 * High-level RAG retrieval for paper generation pipeline.
 * Uses ChunkRetriever and ContextBuilder internally.
 * 
 * Features:
 * - 5-minute TTL caching with superset strategy
 * - Hybrid search (vector + keyword) with RRF
 * - Cross-encoder reranking (Cohere, when available)
 * - Sentence-level chunk compression
 * - Content ingestion and status checking
 * - Abstract fallbacks for papers without chunks
 */

// =============================================================================
// TYPES
// =============================================================================

export interface GenerationRetrievalParams {
  query: string
  paperIds: string[]
  limit?: number
  minScore?: number
  /** Search mode: 'hybrid' (default), 'vector', or 'keyword' */
  mode?: SearchMode
  /** Weight for vector search in hybrid mode (0-1, default 0.7) */
  vectorWeight?: number
  /** Whether to boost results by citation history (default true) */
  useCitationBoost?: boolean
  /** Enable cross-encoder reranking (default true if API key available) */
  useReranking?: boolean
  /** Number of candidates to rerank (default 30) */
  rerankTopK?: number
  /** Enable sentence-level compression (default true) */
  useCompression?: boolean
  /** Minimum sentence relevance score for compression (default 0.3) */
  sentenceMinScore?: number
  /** Token budget for context (default 8000) */
  maxTokens?: number
}

export interface GenerationRetrievalResult extends BaseRetrievalResult {
  scores: number[]
  totalResults: number
  /** Formatted context string (when compression enabled) */
  formattedContext?: string
  metrics?: {
    retrievalTimeMs: number
    rerankTimeMs: number
    compressionRatio: number
    wasReranked: boolean
    wasCompressed: boolean
  }
}

export interface PaperChunk extends RetrievedChunk {
  paper?: PaperWithAuthors
}

// =============================================================================
// CACHING
// =============================================================================

interface CacheEntry {
  result: GenerationRetrievalResult
  timestamp: number
}

const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const CACHE_MAX_SIZE = 100

function getCacheKey(params: GenerationRetrievalParams): string {
  const { query, paperIds, mode = 'hybrid', useCitationBoost = true } = params
  const paperIdsStr = paperIds.slice().sort().join(',')
  return `gen:${mode}:${useCitationBoost ? 'boost' : 'noboost'}:${query}:${paperIdsStr}`
}

function cleanupCache(): void {
  const now = Date.now()
  const expiredKeys: string[] = []
  
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      expiredKeys.push(key)
    }
  }
  
  for (const key of expiredKeys) {
    cache.delete(key)
  }
}

function evictIfNeeded(): void {
  if (cache.size <= CACHE_MAX_SIZE) return
  
  const entries = Array.from(cache.entries())
    .sort((a, b) => a[1].timestamp - b[1].timestamp)
  
  const toRemove = cache.size - CACHE_MAX_SIZE
  for (let i = 0; i < toRemove; i++) {
    cache.delete(entries[i][0])
  }
  
  console.log(`🧹 Cache eviction: removed ${toRemove} oldest entries`)
}

// =============================================================================
// SHARED RETRIEVER INSTANCE
// =============================================================================

let retrieverInstance: ChunkRetriever | null = null
let contextBuilderInstance: ContextBuilder | null = null

function getRetriever(params: GenerationRetrievalParams): ChunkRetriever {
  // Create or update retriever with current params
  // TUNED: Reduced filtering aggression for more synthesis material
  const config = {
    mode: params.mode || 'hybrid',
    vectorWeight: params.vectorWeight || 0.7,
    // REDUCED from 0.15 to 0.1: Let more chunks through
    minScore: params.minScore || 0.1,
    retrieveLimit: 100,
    // INCREASED default from 20 to 25
    finalLimit: params.limit || 25,
    useCitationBoost: params.useCitationBoost ?? true,
    useReranking: params.useReranking ?? true,
    rerankTopK: params.rerankTopK || 30,
    // INCREASED from 5 to 6: More context per paper
    maxPerPaper: 6
  }
  
  if (!retrieverInstance) {
    retrieverInstance = new ChunkRetriever(config)
  } else {
    retrieverInstance.setConfig(config)
  }
  
  return retrieverInstance
}

function getContextBuilder(params: GenerationRetrievalParams): ContextBuilder {
  const config = {
    maxTokens: params.maxTokens || 8000,
    sentenceMinScore: params.sentenceMinScore || 0.3,
    // DISABLED BY DEFAULT: Compression strips context needed for natural citations
    // Only enable as emergency fallback when context exceeds model limits
    enableCompression: params.useCompression ?? false,
    includeCitations: true,
    groupByPaper: false
  }
  
  if (!contextBuilderInstance) {
    contextBuilderInstance = new ContextBuilder(config)
  } else {
    contextBuilderInstance.setConfig(config)
  }
  
  return contextBuilderInstance
}

// =============================================================================
// MAIN SERVICE
// =============================================================================

export class GenerationContextService {
  /**
   * Retrieve context for paper generation.
   * Uses ChunkRetriever with reranking and ContextBuilder for compression.
   */
  static async retrieve(params: GenerationRetrievalParams): Promise<GenerationRetrievalResult> {
    const { 
      query, 
      paperIds, 
      limit = 20, 
      minScore = 0.2,
      // DISABLED BY DEFAULT: Compression strips context needed for natural citations
      useCompression = false
    } = params
    
    if (!query.trim() || paperIds.length === 0) {
      return { ...createEmptyResult(), scores: [], totalResults: 0 }
    }
    
    // Check cache
    const cacheKey = getCacheKey(params)
    const cached = cache.get(cacheKey)
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      console.log(`🎯 Cache HIT: "${query.slice(0, 50)}..."`)
      return this.applyFiltering(cached.result, limit, minScore)
    }
    
    console.log(`🔍 Cache MISS: "${query.slice(0, 50)}..."`)
    
    const startTime = Date.now()
    
    // Use ChunkRetriever for retrieval + reranking
    const retriever = getRetriever({
      ...params,
      limit: Math.max(limit * 3, 100), // Retrieve superset for caching
      minScore: 0.1
    })
    
    const retrievalResult = await retriever.retrieve({
      query,
      paperIds
    })
    
    // Get paper metadata
    const uniquePaperIds = [...new Set(retrievalResult.chunks.map(c => c.paper_id))]
    const papers = await fetchPaperMetadata(uniquePaperIds)
    
    // Optionally compress context
    let formattedContext: string | undefined
    let compressionRatio = 1.0
    let wasCompressed = false
    
    if (useCompression && retrievalResult.chunks.length > 0) {
      const builder = getContextBuilder(params)
      const builtContext = await builder.buildContext(
        retrievalResult.chunks,
        query,
        papers
      )
      formattedContext = builtContext.formattedContext
      compressionRatio = builtContext.metrics.compressionRatio
      wasCompressed = builtContext.wasCompressed
    }
    
    const result: GenerationRetrievalResult = {
      chunks: retrievalResult.chunks,
      papers,
      hasContent: retrievalResult.chunks.length > 0,
      scores: retrievalResult.chunks.map(c => normalizeScore(c.score)),
      totalResults: retrievalResult.totalRetrieved,
      formattedContext,
      metrics: {
        retrievalTimeMs: retrievalResult.metrics.retrievalTimeMs,
        rerankTimeMs: retrievalResult.metrics.rerankTimeMs,
        compressionRatio,
        wasReranked: retrievalResult.wasReranked,
        wasCompressed
      }
    }
    
    const totalTime = Date.now() - startTime
    console.log(`✅ Retrieved ${retrievalResult.chunks.length} chunks ` +
      `(${retrievalResult.wasReranked ? 'reranked, ' : ''}` +
      `${wasCompressed ? `${(compressionRatio * 100).toFixed(0)}% compressed, ` : ''}` +
      `${totalTime}ms)`)
    
    // Cache the superset result
    cache.set(cacheKey, { result, timestamp: Date.now() })
    evictIfNeeded()
    cleanupCache()
    
    return this.applyFiltering(result, limit, minScore)
  }
  
  /**
   * Get relevant chunks with content ingestion support.
   * Main entry point that handles content availability.
   */
  static async getRelevantChunks(
    topic: string,
    paperIds: string[],
    chunkLimit: number,
    allPapers: PaperWithAuthors[]
  ): Promise<PaperChunk[]> {
    if (!topic || topic.trim().length < 10) {
      throw new ContentRetrievalError('Topic must be at least 10 characters long')
    }

    if (!paperIds.length) {
      throw new ContentRetrievalError('No papers provided for content retrieval')
    }

    console.log(`📄 Searching for relevant content chunks...`)
    console.log(`   🎯 Query: "${topic}"`)
    console.log(`   📋 Paper IDs: [${paperIds.slice(0, 3).join(', ')}${paperIds.length > 3 ? '...' : ''}]`)
    
    // Get content status for all papers first
    const statusMap = await getContentStatus(paperIds)
    let papersWithContent = paperIds.filter(id => {
      const status = statusMap.get(id)
      return status?.hasContent && (status.chunkCount > 0 || status.contentType === 'abstract')
    })
    
    if (papersWithContent.length === 0) {
      console.warn(`⚠️ No papers have content. Triggering ingestion...`)
      const libraryPapers = await getPapersByIds(paperIds)
      
      if (!libraryPapers.length) {
        throw new ContentRetrievalError('Failed to retrieve papers from library')
      }
      
      const papers = libraryPapers.map(lp => ({
        ...lp.paper,
        authors: lp.paper.authors || [],
        author_names: lp.paper.authors?.map(a => a.name) || []
      } as PaperWithAuthors))
      
      await ensureBulkContentIngestion(papers)
      
      const retryStatus = await getContentStatus(paperIds)
      papersWithContent = paperIds.filter(id => {
        const status = retryStatus.get(id)
        return status?.hasContent && (status.chunkCount > 0 || status.contentType === 'abstract')
      })
      
      if (papersWithContent.length === 0) {
        throw new ContentRetrievalError('Failed to ingest content for any papers', {
          attempted: papers.length,
          paperIds
        })
      }
    }
    
    console.log(`📊 Content availability: ${papersWithContent.length}/${paperIds.length} papers`)
    
    // Retrieve chunks
    const result = await this.retrieve({
      query: topic,
      paperIds: papersWithContent,
      limit: Math.max(chunkLimit * 2, 60),
      minScore: 0.15,
      useCompression: false // Don't compress for getRelevantChunks
    })
    
    // Convert to PaperChunk format with deterministic IDs
    // Add evidence_strength based on chunk source
    let allChunks: PaperChunk[] = result.chunks.map((chunk, index) => ({
      ...chunk,
      id: chunk.id || createDeterministicChunkId(chunk.paper_id, chunk.content, index),
      paper: allPapers.find(p => p.id === chunk.paper_id),
      metadata: { source: 'generation_context_service', score: chunk.score },
      // Default to full_text for database chunks (they come from PDF ingestion)
      evidence_strength: (chunk.evidence_strength || 'full_text') as EvidenceStrength
    }))
    
    // Validate chunk content
    allChunks = allChunks.filter(chunk => {
      const content = chunk.content.trim()
      return content.length >= 30 &&
             content.split(/\s+/).length >= 5 &&
             !/^[\d\s.,-]+$/.test(content)
    })
    
    // Abstract fallback
    if (allChunks.length === 0) {
      console.warn('⚠️ No relevant chunks found. Using paper abstracts as fallback.')
      const abstractChunks = allPapers
        .filter(p => p.abstract && p.abstract.trim().length >= 100)
        .slice(0, 10)
        .map(p => ({
          id: `abstract-${p.id}`,
          paper_id: p.id,
          content: `Title: ${p.title}\n\nAbstract: ${p.abstract}`,
          metadata: { source: 'abstract-fallback' },
          score: 0.5,
          paper: p,
          // Mark as abstract-only evidence - LLM should not make strong claims from abstracts
          evidence_strength: 'abstract' as EvidenceStrength
        }))

      if (abstractChunks.length === 0) {
        throw new NoRelevantContentError(
          'Could not find any relevant content or abstracts for the selected papers.'
        )
      }
      
      console.log(`✅ Using ${abstractChunks.length} abstracts as fallback context.`)
      return abstractChunks
    }
    
    // Quality check
    const avgScore = allChunks.reduce((sum, chunk) => sum + normalizeScore(chunk.score), 0) / allChunks.length
    if (avgScore < 0.18) {
      throw new ContentQualityError(
        `Content relevance scores too low (avg: ${avgScore.toFixed(3)}). Consider adding more relevant papers.`,
        { scores: allChunks.map(c => c.score) }
      )
    }
    
    // Final limit (dedup and balance already done by ChunkRetriever)
    const finalChunks = allChunks.slice(0, chunkLimit)
    
    console.log(`✅ Final: ${finalChunks.length} chunks`)
    return finalChunks
  }
  
  /**
   * Apply downstream filtering to cached results.
   */
  private static applyFiltering(
    result: GenerationRetrievalResult,
    limit: number,
    minScore: number
  ): GenerationRetrievalResult {
    const filteredChunks = result.chunks
      .filter(c => c.score >= minScore)
      .slice(0, limit)
    
    return {
      ...result,
      chunks: filteredChunks,
      scores: filteredChunks.map(c => c.score),
      totalResults: filteredChunks.length
    }
  }
  
  /**
   * Build contexts for all sections in an outline.
   */
  static async buildContexts(
    outline: GeneratedOutline,
    topic: string,
    allPapers: PaperWithAuthors[] = []
  ): Promise<SectionContext[]> {
    const sectionContexts: SectionContext[] = []
    const allPaperIds = allPapers.map(p => p.id)
    
    console.log(`📊 Building section contexts for ${outline.sections.length} sections...`)
    
    for (const section of outline.sections) {
      const ids = Array.isArray(section.candidatePaperIds) ? section.candidatePaperIds : []
      
      let contextChunks: PaperChunk[] = []
      try {
        const startTime = Date.now()
        const targetIds = ids.length > 0 ? ids : allPaperIds
        
        try {
          // INCREASED limits: More material for synthesis (was 20 → 25, was 12 → 15)
          contextChunks = await this.getRelevantChunks(
            `${section.title}: ${(section.keyPoints || []).join('. ')}`,
            targetIds,
            Math.min(25, Math.max(targetIds.length * 3, 15)),
            allPapers
          )
        } catch (firstError) {
          if (ids.length > 0 && allPaperIds.length > ids.length) {
            console.warn(`⚠️ Assigned papers for "${section.title}" have no content, trying all papers...`)
            contextChunks = await this.getRelevantChunks(
              topic,
              allPaperIds,
              Math.min(25, Math.max(allPaperIds.length * 2, 15)),
              allPapers
            )
          } else {
            throw firstError
          }
        }
        
        const retrievalTime = Date.now() - startTime
        console.log(`📄 Retrieved chunks for "${section.title}" (${contextChunks.length} chunks, ${retrievalTime}ms)`)
      } catch (error) {
        console.warn(`⚠️ No relevant chunks found for section "${section.title}": ${error}`)
        
        // Abstract fallback
        const abstractChunks = allPapers
          .filter(p => p.abstract && p.abstract.trim().length >= 50)
          .slice(0, 5)
          .map(p => ({
            id: `abstract-fallback-${p.id}`,
            paper_id: p.id,
            content: `Title: ${p.title}\n\nAbstract: ${p.abstract}`,
            metadata: { source: 'abstract-fallback-section' },
            score: 0.4,
            paper: p,
            // Mark as abstract-only evidence
            evidence_strength: 'abstract' as EvidenceStrength
          }))
        
        if (abstractChunks.length > 0) {
          console.log(`   ↳ Using ${abstractChunks.length} abstract fallbacks for "${section.title}"`)
          contextChunks = abstractChunks
        }
      }
      
      const context: SectionContext = {
        sectionKey: section.sectionKey,
        title: section.title,
        keyPoints: section.keyPoints || [],
        candidatePaperIds: section.candidatePaperIds || [],
        contextChunks: contextChunks.map(c => ({
          id: c.id,
          paper_id: c.paper_id,
          content: c.content,
          score: c.score,
          // Include evidence strength for LLM to weight appropriately
          evidence_strength: c.evidence_strength || 'full_text'
        })),
        expectedWords: section.expectedWords
      }
      
      sectionContexts.push(context)
    }
    
    console.log(`📊 Section contexts built: ${sectionContexts.length} sections processed`)
    return sectionContexts
  }
  
  /**
   * Clear cache (for testing or memory management).
   */
  static clearCache(): void {
    cache.clear()
  }
  
  /**
   * Get cache stats (for monitoring).
   */
  static getCacheStats(): { size: number; keys: string[] } {
    return {
      size: cache.size,
      keys: Array.from(cache.keys())
    }
  }
  
  /**
   * Reset retriever instances (for testing).
   */
  static resetInstances(): void {
    retrieverInstance = null
    contextBuilderInstance = null
  }
}
