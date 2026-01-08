import 'server-only'
import { 
  searchChunks, 
  fetchPaperMetadata, 
  deduplicateChunks,
  balanceChunks,
  normalizeScore,
  createEmptyResult,
  type RetrievedChunk,
  type BaseRetrievalResult
} from './base-retrieval'
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
 * Specialized RAG retrieval for paper generation pipeline.
 * Features:
 * - 5-minute TTL caching with superset strategy
 * - Batch processing for multi-section generation
 * - Cross-paper chunk balancing
 * - Content ingestion and status checking
 * - Abstract fallbacks for papers without chunks
 * - No claims retrieval (not needed for generation)
 */

// =============================================================================
// TYPES
// =============================================================================

export interface GenerationRetrievalParams {
  query: string
  paperIds: string[]
  limit?: number
  minScore?: number
}

export interface GenerationRetrievalResult extends BaseRetrievalResult {
  scores: number[]
  totalResults: number
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
const CACHE_MAX_SIZE = 100 // Maximum number of cache entries

function getCacheKey(params: GenerationRetrievalParams): string {
  const { query, paperIds } = params
  const paperIdsStr = paperIds.slice().sort().join(',')
  // Exclude limit/minScore for better cache reuse
  return `gen:${query}:${paperIdsStr}`
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

/**
 * Evict oldest entries if cache exceeds max size (LRU-style eviction)
 */
function evictIfNeeded(): void {
  if (cache.size <= CACHE_MAX_SIZE) return
  
  // Sort entries by timestamp (oldest first)
  const entries = Array.from(cache.entries())
    .sort((a, b) => a[1].timestamp - b[1].timestamp)
  
  // Remove oldest entries until we're under the limit
  const toRemove = cache.size - CACHE_MAX_SIZE
  for (let i = 0; i < toRemove; i++) {
    cache.delete(entries[i][0])
  }
  
  console.log(`🧹 Cache eviction: removed ${toRemove} oldest entries`)
}

// =============================================================================
// MAIN SERVICE
// =============================================================================

export class GenerationContextService {
  /**
   * Retrieve context for paper generation
   * Uses caching to avoid redundant searches across sections
   */
  static async retrieve(params: GenerationRetrievalParams): Promise<GenerationRetrievalResult> {
    const { query, paperIds, limit = 20, minScore = 0.2 } = params
    
    if (!query.trim() || paperIds.length === 0) {
      return { ...createEmptyResult(), scores: [], totalResults: 0 }
    }
    
    // Check cache
    const cacheKey = getCacheKey(params)
    const cached = cache.get(cacheKey)
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      console.log(`🎯 Cache HIT for generation query: "${query.slice(0, 50)}..."`)
      return this.applyFiltering(cached.result, limit, minScore)
    }
    
    console.log(`🔍 Cache MISS for generation query: "${query.slice(0, 50)}..."`)
    
    // Perform retrieval with generous limits for caching
    const supersetLimit = Math.max(limit * 3, 100)
    const supersetMinScore = 0.1
    
    const chunks = await searchChunks(query, {
      paperIds,
      limit: supersetLimit,
      minScore: supersetMinScore
    })
    
    // Get paper metadata
    const uniquePaperIds = [...new Set(chunks.map(c => c.paper_id))]
    const papers = await fetchPaperMetadata(uniquePaperIds)
    
    const result: GenerationRetrievalResult = {
      chunks,
      papers,
      hasContent: chunks.length > 0,
      scores: chunks.map(c => normalizeScore(c.score)),
      totalResults: chunks.length
    }
    
    // Cache the superset result
    cache.set(cacheKey, { result, timestamp: Date.now() })
    
    // Evict oldest entries if cache exceeds max size
    evictIfNeeded()
    
    // Also cleanup expired entries periodically
    cleanupCache()
    
    return this.applyFiltering(result, limit, minScore)
  }
  
  /**
   * Get relevant chunks with content ingestion support
   * This is the main entry point that handles content availability
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
      
      // Try to ingest content
      await ensureBulkContentIngestion(papers)
      
      // Verify ingestion success
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
    
    // Retrieve chunks using caching
    const result = await this.retrieve({
      query: topic,
      paperIds: papersWithContent,
      limit: Math.max(chunkLimit * 2, 60),
      minScore: 0.15
    })
    
    // Convert to PaperChunk format with deterministic IDs
    let allChunks: PaperChunk[] = result.chunks.map((chunk, index) => ({
      ...chunk,
      id: chunk.id || createDeterministicChunkId(chunk.paper_id, chunk.content, index),
      paper: allPapers.find(p => p.id === chunk.paper_id),
      metadata: { source: 'generation_context_service', score: chunk.score }
    }))
    
    // Validate chunk content (relaxed thresholds)
    allChunks = allChunks.filter(chunk => {
      const content = chunk.content.trim()
      return content.length >= 30 &&
             content.split(/\s+/).length >= 5 &&
             !/^[\d\s.,-]+$/.test(content)
    })
    
    // If no chunks found, use abstracts as fallback
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
          paper: p
        }))

      if (abstractChunks.length === 0) {
        throw new NoRelevantContentError(
          'Could not find any relevant content or abstracts for the selected papers.'
        )
      }
      
      console.log(`✅ Using ${abstractChunks.length} abstracts as fallback context.`)
      return abstractChunks
    }
    
    // Validate final content quality
    const avgScore = allChunks.reduce((sum, chunk) => sum + normalizeScore(chunk.score), 0) / allChunks.length
    if (avgScore < 0.18) {
      throw new ContentQualityError(
        `Content relevance scores too low (avg: ${avgScore.toFixed(3)}). Consider adding more relevant papers.`,
        { scores: allChunks.map(c => c.score) }
      )
    }
    
    // Deduplicate and balance
    const deduplicated = deduplicateChunks(allChunks)
    const balanced = balanceChunks(deduplicated, chunkLimit, chunkLimit)
    
    console.log(`✅ Final: ${balanced.length} chunks after dedup and balancing`)
    return balanced
  }
  
  /**
   * Apply downstream filtering to cached results
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
   * Build contexts for all sections in an outline
   * Main entry point for section context building in generation pipeline
   */
  static async buildContexts(
    outline: GeneratedOutline,
    topic: string,
    allPapers: PaperWithAuthors[] = []
  ): Promise<SectionContext[]> {
    const sectionContexts: SectionContext[] = []
    
    console.log(`📊 Building section contexts for ${outline.sections.length} sections...`)
    
    for (const section of outline.sections) {
      const ids = Array.isArray(section.candidatePaperIds) ? section.candidatePaperIds : []
      
      let contextChunks: PaperChunk[] = []
      try {
        const startTime = Date.now()
        contextChunks = await this.getRelevantChunks(
          topic,
          ids.length > 0 ? ids : allPapers.map(p => p.id),
          Math.min(20, Math.max(ids.length * 3, 12)),
          allPapers
        )
        const retrievalTime = Date.now() - startTime
        console.log(`📄 Retrieved chunks for "${section.title}" (${contextChunks.length} chunks, ${retrievalTime}ms)`)
      } catch (error) {
        console.warn(`⚠️ No relevant chunks found for section "${section.title}": ${error}`)
        contextChunks = []
      }
      
      // Build section context
      const context: SectionContext = {
        sectionKey: section.sectionKey,
        title: section.title,
        keyPoints: section.keyPoints || [],
        candidatePaperIds: section.candidatePaperIds || [],
        contextChunks: contextChunks.map(c => ({
          paper_id: c.paper_id,
          content: c.content,
          score: c.score
        })),
        expectedWords: section.expectedWords
      }
      
      sectionContexts.push(context)
    }
    
    console.log(`📊 Section contexts built: ${sectionContexts.length} sections processed`)
    return sectionContexts
  }
  
  /**
   * Clear cache (for testing or memory management)
   */
  static clearCache(): void {
    cache.clear()
  }
  
  /**
   * Get cache stats (for monitoring)
   */
  static getCacheStats(): { size: number; keys: string[] } {
    return {
      size: cache.size,
      keys: Array.from(cache.keys())
    }
  }
}
