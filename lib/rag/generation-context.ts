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
import { getContentStatus } from '@/lib/content'
import { createDeterministicChunkId } from '@/lib/utils/deterministic-id'
import { 
  ContentRetrievalError, 
  NoRelevantContentError, 
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
  /** Token budget for evidence chunks (default 25000) */
  maxEvidenceTokens?: number
}

export interface GenerationRetrievalResult extends BaseRetrievalResult {
  scores: number[]
  totalResults: number
  mode?: SearchMode
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
  // Uses token-based limits - semantic relevance is the primary filter
  const config = {
    mode: params.mode || 'hybrid',
    vectorWeight: params.vectorWeight || 0.7,
    // Relevance threshold - primary quality filter
    minScore: params.minScore || 0.15,
    // Candidate pool for reranking
    retrieveLimit: 140,
    useCitationBoost: params.useCitationBoost ?? true,
    useReranking: params.useReranking ?? true,
    // Rerank top candidates for better selection
    rerankTopK: params.rerankTopK || 60,
    // Token budget for evidence - replaces arbitrary chunk limits
    maxEvidenceTokens: params.maxEvidenceTokens || 25000,
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
      // INCREASED from 20 to 30: More chunks for richer synthesis
      limit = 30, 
      // REDUCED from 0.2 to 0.15: Allow more papers through
      minScore = 0.15,
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
      return this.applyFiltering(cached.result, limit, minScore, params.mode || 'hybrid')
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
      mode: params.mode || 'hybrid',
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
    
    return this.applyFiltering(result, limit, minScore, params.mode || 'hybrid')
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
    
    // Retrieval-only path: ingestion/chunking is handled upstream by pipeline preflight.
    // We only read available chunked papers here.
    const statusMap = await getContentStatus(paperIds)
    const papersWithChunks = paperIds.filter(id => (statusMap.get(id)?.chunkCount || 0) > 0)
    
    console.log(`📊 Chunk availability: ${papersWithChunks.length}/${paperIds.length} papers`)
    
    let retrievedChunks: RetrievedChunk[] = []
    if (papersWithChunks.length > 0) {
      // Retrieve chunks
      // INCREASED minimum from 60 to 90: More material for synthesis
      const retrievalResult = await this.retrieve({
        query: topic,
        paperIds: papersWithChunks,
        limit: Math.max(chunkLimit * 2, 90),
        // REDUCED from 0.15 to 0.1: Allow more papers through for niche topics
        minScore: 0.1,
        useCompression: false // Don't compress for getRelevantChunks
      })
      retrievedChunks = retrievalResult.chunks
    } else {
      console.warn('⚠️ No chunked papers available during retrieval. Using abstract-only fallback.')
    }
    
    // Convert to PaperChunk format with deterministic IDs
    // Add evidence_strength based on chunk source
    let allChunks: PaperChunk[] = retrievedChunks.map((chunk, index) => ({
      ...chunk,
      id: chunk.id || createDeterministicChunkId(chunk.paper_id, chunk.content, index),
      paper: allPapers.find(p => p.id === chunk.paper_id),
      metadata: { source: 'generation_context_service', score: chunk.score },
      // Default to full_text for database chunks (they come from PDF ingestion)
      evidence_strength: (chunk.evidence_strength || 'full_text') as EvidenceStrength
    }))
    
    const originalCount = allChunks.length
    
    // Validate chunk content with strict filtering first
    allChunks = allChunks.filter(chunk => {
      const content = chunk.content.trim()
      return content.length >= 30 &&
             content.split(/\s+/).length >= 5 &&
             !/^[\d\s.,-]+$/.test(content)
    })
    
    // If strict filtering removes too many chunks, try relaxed filtering
    // This helps when coverage is low and we only have short abstract-based chunks
    const MIN_CHUNKS_THRESHOLD = 5
    if (allChunks.length < MIN_CHUNKS_THRESHOLD && originalCount > allChunks.length) {
      console.log(`⚠️ Strict filtering reduced ${originalCount} → ${allChunks.length} chunks. Trying relaxed filtering...`)
      
      // Relaxed filter: only require minimal content
      allChunks = retrievedChunks
        .map((chunk, index) => ({
          ...chunk,
          id: chunk.id || createDeterministicChunkId(chunk.paper_id, chunk.content, index),
          paper: allPapers.find(p => p.id === chunk.paper_id),
          metadata: { source: 'generation_context_service', score: chunk.score },
          evidence_strength: (chunk.evidence_strength || 'full_text') as EvidenceStrength
        }))
        .filter(chunk => {
          const content = chunk.content.trim()
          // Relaxed: only 20 chars and 3 words minimum
          return content.length >= 20 &&
                 content.split(/\s+/).length >= 3 &&
                 !/^[\d\s.,-]+$/.test(content)
        })
      
      console.log(`✅ Relaxed filtering recovered ${allChunks.length} chunks`)
    }
    
    // Abstract fallback - only if we still have very few chunks
    if (allChunks.length < MIN_CHUNKS_THRESHOLD) {
      console.warn(`⚠️ Only ${allChunks.length} chunks found. Supplementing with paper abstracts.`)
      const abstractChunks = allPapers
        .filter(p => p.abstract && p.abstract.trim().length >= 100)
        // Don't include papers we already have chunks for
        .filter(p => !allChunks.some(c => c.paper_id === p.id))
        .slice(0, Math.max(10 - allChunks.length, 5))
        .map(p => ({
          id: `abstract-${p.id}`,
          paper_id: p.id,
          content: `Title: ${p.title}\n\nAbstract: ${p.abstract}`,
          metadata: { source: 'abstract-fallback' },
          score: 0.2, // Low score - abstract only, not full-text verified
          paper: p,
          // Mark as abstract-only evidence - LLM should not make strong claims from abstracts
          evidence_strength: 'abstract' as EvidenceStrength
        }))

      if (allChunks.length === 0 && abstractChunks.length === 0) {
        throw new NoRelevantContentError(
          'Could not find any relevant content or abstracts for the selected papers.'
        )
      }
      
      // Combine existing chunks with abstract supplements
      allChunks = [...allChunks, ...abstractChunks]
      console.log(`✅ Using ${allChunks.length} total chunks (${abstractChunks.length} from abstracts)`)
    }
    
    // Quality check - only throw if we have zero usable chunks
    // Relaxed from 0.18 threshold since we may have lower-quality but still useful content
    const avgScore = allChunks.reduce((sum, chunk) => sum + normalizeScore(chunk.score), 0) / allChunks.length
    if (allChunks.length > 0 && avgScore < 0.1) {
      console.warn(`⚠️ Low average relevance score (${avgScore.toFixed(3)}), but proceeding with available content`)
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
    minScore: number,
    mode: SearchMode
  ): GenerationRetrievalResult {
    // IMPORTANT:
    // - In vector mode, `score` is cosine similarity-like (0-1) so `minScore` applies directly.
    // - In hybrid mode, `score` is an RRF score (~0.01-0.02), so filtering on it will wrongly drop everything.
    //   Instead, keep chunks if they passed vector threshold OR have any keyword match.
    const filteredChunks = result.chunks
      .filter(c => {
        if (mode === 'vector') return c.score >= minScore
        if (mode === 'keyword') return (c.score ?? 0) > 0
        // hybrid
        const vectorOk = (c.vector_score ?? 0) >= minScore
        const keywordOk = (c.keyword_score ?? 0) > 0
        return vectorOk || keywordOk
      })
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
    const allPaperIds = allPapers.map(p => p.id)
    
    console.log(`📊 Building section contexts for ${outline.sections.length} sections...`)

    const sectionContexts = await Promise.all(outline.sections.map(async (section) => {
      let contextChunks: PaperChunk[] = []
      try {
        const startTime = Date.now()
        
        // Retrieval-only: do NOT require or rely on outline paper assignment.
        // Always retrieve from the full paper pool; the retriever + reranker determine relevance.
        contextChunks = await this.getRelevantChunks(
          `${section.title}: ${(section.keyPoints || []).join('. ')}`,
          allPaperIds,
          120, // Larger-than-final pool - token budget determines final selection
          allPapers
        )
        
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
            score: 0.2, // Low score - abstract only, not full-text verified
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
        subsections: section.subsections?.map(sub => ({
          title: sub.title,
          expectedWords: sub.expectedWords,
          keyPoints: sub.keyPoints || []
        })),
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
      return context
    }))
    
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
