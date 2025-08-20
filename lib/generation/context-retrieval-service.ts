import 'server-only'
 
import { searchPaperChunks } from '@/lib/db/papers'
import { createDeterministicChunkId } from '@/lib/utils/deterministic-id'
import type { PaperWithAuthors } from '@/types/simplified'
import type { PaperChunk } from './types'

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

  static async retrieve(params: RetrievalParams): Promise<RetrievalResult> {
    const cacheKey = this.getCacheKey(params)
    const cached = this.cache.get(cacheKey)
    
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.result
    }

    const result = await this.performRetrieval(params)
    
    // Cache the result
    this.cache.set(cacheKey, { result, timestamp: Date.now() })
    
    // Clean up old cache entries periodically
    if (Math.random() < 0.1) {
      this.cleanupCache()
    }
    
    return result
  }

  private static async performRetrieval(params: RetrievalParams): Promise<RetrievalResult> {
    const {
      query = '',
      paperIds = [],
      k = 20,
      minScore = 0.3
    } = params

    if (!query.trim()) {
      return {
        papers: [],
        chunks: [],
        scores: [],
        totalResults: 0
      }
    }

    try {
      // Use existing searchPaperChunks with enhanced options
      const searchResults = await searchPaperChunks(query, {
        paperIds: paperIds.length > 0 ? paperIds : undefined,
        limit: k * 2, // Get extra to allow for filtering
        minScore
      })

      // Convert to PaperChunk format with deterministic IDs
      const chunks: PaperChunk[] = searchResults.map((result, index) => ({
        id: createDeterministicChunkId(result.paper_id, result.content, index),
        paper_id: result.paper_id,
        content: result.content,
        metadata: { 
          source: 'context_retrieval_service',
          score: result.score
        },
        score: result.score
      }))

      // Sort by score descending and limit results
      const sortedChunks = chunks
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, k)

      const scores = sortedChunks.map(chunk => chunk.score || 0)
      
      // Extract unique papers (stub - would need paper lookup for full objects)
      const papers: PaperWithAuthors[] = [] // TODO: Lookup papers by IDs

      return {
        papers,
        chunks: sortedChunks,
        scores,
        totalResults: searchResults.length
      }

    } catch (error) {
      console.error('Context retrieval failed:', error)
      return {
        papers: [],
        chunks: [],
        scores: [],
        totalResults: 0
      }
    }
  }

  private static getCacheKey(params: RetrievalParams): string {
    const { query = '', paperIds = [], k = 20, minScore = 0.3, projectId = '' } = params
    const paperIdsStr = paperIds.slice().sort().join(',')
    return `${query}:${paperIdsStr}:${k}:${minScore}:${projectId}`
  }

  private static cleanupCache(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.CACHE_TTL_MS) {
        this.cache.delete(key)
      }
    }
  }

  // NOTE: getRelevantChunks method removed to eliminate duplication
  // Use getRelevantChunks from @/lib/generation/chunks instead for consistent behavior
}