import { searchPaperChunks } from '@/lib/db/papers'
import { getPapersByIds } from '@/lib/db/library'
import type { PaperWithAuthors } from '@/types/simplified'
import { getContentStatus, ensureBulkContentIngestion } from '@/lib/content'
import { createDeterministicChunkId } from '@/lib/utils/deterministic-id'
import type { PaperChunk } from '@/lib/generation/types'

import { 
  ContentRetrievalError, 
  NoRelevantContentError, 
  ContentQualityError 
} from '@/lib/content/errors'

/**
 * ContextRetrievalService
 * 
 * Single source for fetching ranked context chunks/papers.
 * Wraps embeddings, keyword search, and filters into a unified API.
 */

export interface RetrievalParams {
  query?: string
  selection?: string
  projectId?: string
  paperIds?: string[]
  k?: number
  minScore?: number
}

export interface RetrievalResult {
  papers: PaperWithAuthors[]
  chunks: PaperChunk[]
  scores: number[]
  totalResults: number
}

export class ContextRetrievalService {
  private static cache = new Map<string, { result: RetrievalResult; timestamp: number }>()
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

  private constructor() {}

  /**
   * Create empty retrieval result - eliminates duplicate patterns
   */
  private static createEmptyResult(): RetrievalResult {
    return {
      papers: [],
      chunks: [],
      scores: [],
      totalResults: 0
    }
  }

  /**
   * Normalize chunk score - handles undefined scores consistently
   */
  static normalizeScore(score: number | undefined): number {
    return score ?? 0
  }

  static async retrieve(params: RetrievalParams): Promise<RetrievalResult> {
    const cacheKey = this.getCacheKey(params)
    const cached = this.cache.get(cacheKey)
    
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      console.log(`🎯 Cache HIT for query: "${params.query}" (${cached.result.chunks.length} cached chunks)`)
      // Apply downstream filtering to cached superset results  
      return this.applyDownstreamFiltering(cached.result, params)
    }

    console.log(`🔍 Cache MISS for query: "${params.query}" - performing retrieval`)
    const result = await this.performRetrieval(params)
    
    // Cache the superset result (without k/minScore filtering)
    this.cache.set(cacheKey, { result, timestamp: Date.now() })
    
    // Clean up old cache entries periodically
    if (Math.random() < 0.1) {
      this.cleanupCache()
    }
    
    // Apply requested filtering to fresh results
    return this.applyDownstreamFiltering(result, params)
  }

  /**
   * Apply k and minScore filtering to cached superset results
   */
  private static applyDownstreamFiltering(cachedResult: RetrievalResult, params: RetrievalParams): RetrievalResult {
    const { k = 20, minScore = 0.3 } = params
    
    // Filter by minScore and limit to k results
    const filteredChunks = cachedResult.chunks
      .filter(chunk => this.normalizeScore(chunk.score) >= minScore)
      .slice(0, k)
    
    const filteredScores = filteredChunks.map(chunk => this.normalizeScore(chunk.score))
    
    return {
      papers: cachedResult.papers, // Papers array typically small, keep as-is
      chunks: filteredChunks,
      scores: filteredScores,
      totalResults: filteredChunks.length
    }
  }

  private static async performRetrieval(params: RetrievalParams): Promise<RetrievalResult> {
    const {
      query = '',
      paperIds = []
    } = params

    if (!query.trim()) {
      return this.createEmptyResult()
    }

    try {
      // Fetch larger superset for better cache reuse - let downstream filtering handle limits
      const supersetLimit = Math.max(100, paperIds.length * 10) // Generous limit for caching
      const supersetMinScore = 0.05 // Very permissive for caching, filter downstream
      
      // Use existing searchPaperChunks with generous options for superset caching
      const searchResults = await searchPaperChunks(query, {
        paperIds: paperIds.length > 0 ? paperIds : undefined,
        limit: supersetLimit,
        minScore: supersetMinScore
      })

      // Convert to PaperChunk format with deterministic IDs
      const chunks: PaperChunk[] = searchResults.map((result, index) => {
        const normalizedScore = this.normalizeScore(result.score)
        return {
          id: createDeterministicChunkId(result.paper_id, result.content, index),
          paper_id: result.paper_id,
          content: result.content,
          metadata: { 
            source: 'context_retrieval_service',
            score: normalizedScore
          },
          score: normalizedScore
        }
      })

      // Sort by score descending but don't limit (cache the superset)
      const sortedChunks = chunks
        .sort((a, b) => this.normalizeScore(b.score) - this.normalizeScore(a.score))

      const scores = sortedChunks.map(chunk => this.normalizeScore(chunk.score))
      
      // Extract unique papers (stub - would need paper lookup for full objects)
      const papers: PaperWithAuthors[] = [] // TODO: Lookup papers by IDs

      console.log(`📊 Retrieved ${sortedChunks.length} chunks for caching (superset strategy)`)

      return {
        papers,
        chunks: sortedChunks,
        scores,
        totalResults: searchResults.length
      }

    } catch (error) {
      console.error('Context retrieval failed:', error)
      return this.createEmptyResult()
    }
  }

  private static getCacheKey(params: RetrievalParams): string {
    const { query = '', paperIds = [], projectId = '' } = params
    const paperIdsStr = paperIds.slice().sort().join(',')
    // Normalize cache key to exclude k and minScore for better reuse
    return `${query}:${paperIdsStr}:${projectId}`
  }

  private static cleanupCache(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.CACHE_TTL_MS) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Build contexts for all sections in an outline with caching
   * This is the unified entry point for section context building
   * 
   * Note: Now leverages the main ContextRetrievalService cache instead of maintaining separate cache
   */
  static async buildContexts(
    outline: import('@/lib/prompts/types').GeneratedOutline,
    topic: string,
    allPapers: import('@/types/simplified').PaperWithAuthors[] = []
  ): Promise<import('@/lib/prompts/types').SectionContext[]> {
    const sectionContexts: import('@/lib/prompts/types').SectionContext[] = []

    console.log(`📊 Building section contexts for ${outline.sections.length} sections...`)
    
    for (const section of outline.sections) {
      const ids = Array.isArray(section.candidatePaperIds) ? section.candidatePaperIds : []
      
      let contextChunks: PaperChunk[] = []
      try {
        const startTime = Date.now()
        contextChunks = await getRelevantChunks(
          topic,
          ids,
          Math.min(20, ids.length * 3),
          allPapers
        )
        const retrievalTime = Date.now() - startTime
        console.log(`📄 Retrieved chunks for "${section.title}" (${contextChunks.length} chunks, ${retrievalTime}ms)`)
        console.log(`     Paper IDs used: [${ids.slice(0, 3).join(', ')}${ids.length > 3 ? `... +${ids.length - 3}` : ''}]`)
      } catch (error) {
        console.warn(`⚠️ No relevant chunks found for section "${section.title}": ${error}`)
        console.warn(`⚠️ This section may have limited content quality due to lack of relevant source material`)
        contextChunks = []
      }

      sectionContexts.push({
        sectionKey: section.sectionKey,
        title: section.title,
        candidatePaperIds: ids,
        contextChunks: contextChunks.map(chunk => ({
          paper_id: chunk.paper_id,
          content: chunk.content,
          score: chunk.score
        })),
        expectedWords: section.expectedWords,
      })
    }

    console.log(`📊 Section contexts built: ${sectionContexts.length} sections processed`)
    return sectionContexts
  }
}

/**
 * Get relevant chunks for RAG generation
 */
export async function getRelevantChunks(
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
  console.log(`   📋 Paper IDs: [${paperIds.join(', ')}]`)
  console.log(`   📊 Chunk Limit: ${chunkLimit}`)
  
  // Get content status for all papers first
  const statusMap = await getContentStatus(paperIds)
  const papersWithContent = paperIds.filter(id => {
    const status = statusMap.get(id)
    return status?.hasContent && (status.chunkCount > 0 || status.contentType === 'abstract')
  })
  
  if (papersWithContent.length === 0) {
    console.warn(`⚠️ No papers have any content available. Triggering content ingestion...`)
    const libraryPapers = await getPapersByIds(paperIds)
    
    // Validate paper retrieval
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
    const papersWithContentAfterIngestion = paperIds.filter(id => {
      const status = retryStatus.get(id)
      return status?.hasContent && (status.chunkCount > 0 || status.contentType === 'abstract')
    })
    
    if (papersWithContentAfterIngestion.length === 0) {
      throw new ContentRetrievalError('Failed to ingest content for any papers', {
        attempted: papers.length,
        paperIds
      })
    }
    
    papersWithContent.push(...papersWithContentAfterIngestion)
  }
  
  console.log(`📊 Content availability: ${papersWithContent.length}/${paperIds.length} papers have content`)
  
  // DEBUG: Log the paper IDs being used for chunk filtering
  console.log(`🔍 CHUNK FILTER: Looking for chunks belonging to these ${paperIds.length} paper IDs:`)
  paperIds.forEach((id, idx) => {
    console.log(`   ${idx + 1}. ${id}`)
  })
  
  // Direct retrieval using ContextRetrievalService (already cached and processed)
  let allChunks: PaperChunk[] = []
  try {
    console.log(`📄 Single-pass chunk search with permissive floor and superset cache`)
    const retrievalResult = await ContextRetrievalService.retrieve({ 
      query: topic, 
      paperIds: papersWithContent, 
      k: Math.max(chunkLimit * 2, 120), 
      minScore: 0.08 
    })

    // Use chunks directly from ContextRetrievalService (no re-processing needed)
    const searchResults = retrievalResult.chunks.map(chunk => ({
      ...chunk,
      paper: allPapers.find(p => p.id === chunk.paper_id)
    }))

    if (searchResults.length > 0) {
      // Validate chunk content (relaxed thresholds)
      let validChunks = searchResults.filter(chunk => {
        const content = chunk.content.trim()
        return content.length >= 30 &&
               content.split(/\s+/).length >= 5 &&
               !/^[\d\s.,-]+$/.test(content)
      })

      if (validChunks.length === 0) {
        console.warn(`⚠️ All chunks failed quality validation. Using top raw chunks as fallback.`)
        validChunks = searchResults.slice(0, Math.min(10, searchResults.length))
      }

      allChunks = validChunks
      console.log(`✅ Found ${validChunks.length} valid chunks in single-pass search`)
    }
  } catch (error) {
    console.warn(`⚠️ Superset search failed:`, error)
  }

  // If no chunks are found after search, use abstracts as a fallback
  if (allChunks.length === 0) {
    console.warn(
      '⚠️ No relevant chunks found. Using paper abstracts as fallback context.'
    )
    const abstractChunks = allPapers
      .filter(p => p.abstract && p.abstract.trim().length >= 100) // Ensure abstract has meaningful content
      .slice(0, 10) // Limit to top 10 abstracts
      .map(p => ({
        id: `abstract-${p.id}`,
        paper_id: p.id,
        content: `Title: ${p.title}\n\nAbstract: ${p.abstract}`, // Keep it clean
        metadata: { source: 'abstract-fallback' },
        score: 0.5, // Assign a default score for abstracts
      }))

    if (abstractChunks.length === 0) {
      console.error('❌ No chunks found and no abstracts available.')
      throw new NoRelevantContentError(
        'Could not find any relevant content or abstracts for the selected papers.'
      )
    }
    
    console.log(`✅ Using ${abstractChunks.length} abstracts as fallback context.`)
    return abstractChunks
  }

  // Final check to ensure some chunks were found
  assertChunksFound(allChunks, topic, paperIds)

  // Validate final content quality (relaxed for abstract-based content)
  const avgScore = allChunks.reduce((sum, chunk) => sum + ContextRetrievalService.normalizeScore(chunk.score), 0) / allChunks.length
  if (avgScore < 0.08) { // Further lowered threshold to avoid false negatives with abstract-heavy corpora
    throw new ContentQualityError(
      `Content relevance scores too low for reliable generation (avg: ${avgScore.toFixed(3)})`,
      { scores: allChunks.map(c => c.score) }
    )
  }

  // Remove abstract-splitting booster to reduce repetition pressure

  // Deduplicate chunks to improve context diversity
  console.log(`🔄 Deduplicating ${allChunks.length} chunks...`)
  const deduplicated = deduplicateChunks(allChunks)
  console.log(`✅ After deduplication: ${deduplicated.length} unique chunks`)

  // Balance chunks across papers with higher limits
  const CHUNKS_PER_PAPER = 10 // Increased from 5 to allow more content per paper
  const perPaperCap = Math.max(CHUNKS_PER_PAPER, Math.ceil(chunkLimit / Math.max(1, papersWithContent.length)))
  const balanced = balanceChunks(deduplicated, perPaperCap, chunkLimit)
  
  // Final validation of balanced chunks
  if (balanced.length < Math.min(3, chunkLimit)) {
    throw new ContentQualityError(
      `Insufficient content after balancing (${balanced.length} chunks)`,
      { scores: balanced.map(c => c.score) }
    )
  }
  
  console.log(`📄 Final balanced chunks: ${balanced.length} (max ${perPaperCap} per paper)`)
  return balanced
}

/**
 * Deduplicate chunks to reduce redundancy and improve context diversity
 * Uses content similarity to filter near-duplicates from overlapping chunks
 */
function deduplicateChunks(chunks: PaperChunk[]): PaperChunk[] {
  const deduplicated: PaperChunk[] = []
  const contentHashes = new Set<string>()
  
  // Sort by score descending to prefer higher quality chunks
  const sortedChunks = [...chunks].sort((a, b) => 
    ContextRetrievalService.normalizeScore(b.score) - ContextRetrievalService.normalizeScore(a.score)
  )
  
  for (const chunk of sortedChunks) {
    // Create a simple content hash from first/last 100 chars for similarity detection
    const content = chunk.content.trim()
    const hashContent = content.length > 200 
      ? content.slice(0, 100) + content.slice(-100)
      : content
    
    // Normalize for comparison (remove extra whitespace, punctuation)
    const normalizedHash = hashContent
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    
    if (!contentHashes.has(normalizedHash)) {
      contentHashes.add(normalizedHash)
      deduplicated.push(chunk)
    }
  }
  
  return deduplicated
}

/**
 * Helper function to balance chunks across papers
 */
function balanceChunks(chunks: PaperChunk[], perPaperCap: number, totalLimit: number): PaperChunk[] {
  const balanced: PaperChunk[] = []
  const paperCounts = new Map<string, number>()
  const seen = new Set<string>()
  
  // First pass: Take top chunks from each paper up to cap
  for (const chunk of chunks) {
    if (balanced.length >= totalLimit) break
    
    const count = paperCounts.get(chunk.paper_id) || 0
    if (count >= perPaperCap) continue
    if (seen.has(chunk.content)) continue
    
    balanced.push(chunk)
    seen.add(chunk.content)
    paperCounts.set(chunk.paper_id, count + 1)
  }

  // Second pass: Fill remaining slots if needed
  if (balanced.length < totalLimit) {
    for (const chunk of chunks) {
      if (balanced.length >= totalLimit) break
      if (seen.has(chunk.content)) continue
      
      balanced.push(chunk)
      seen.add(chunk.content)
    }
  }

  return balanced
}

/**
 * Fail fast helper when chunks remain empty after adaptive attempts
 */
export function assertChunksFound(chunks: PaperChunk[], topic: string, paperIds: string[]): void {
  if (chunks.length === 0) {
    const errorContext = `topic: "${topic}", paperIds: [${paperIds.slice(0, 5).join(', ')}${paperIds.length > 5 ? '...' : ''}]`
    throw new Error(
      `RAG failed: no content chunks found for ${errorContext}. ` +
      `Ensure papers are ingested with chunks or disable paperId filtering.`
    )
  }
}
