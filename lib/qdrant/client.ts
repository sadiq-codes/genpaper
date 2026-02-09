/**
 * Qdrant Vector Database Client
 * 
 * Handles all vector operations for semantic search.
 * Supabase continues to handle relational data (papers metadata, users, etc.)
 */

import { QdrantClient } from '@qdrant/js-client-rest'

// Collections
export const COLLECTIONS = {
  PAPERS: 'papers',
  PAPER_CHUNKS: 'paper_chunks',
} as const

// Singleton client
let client: QdrantClient | null = null

/**
 * Get Qdrant client instance
 */
export function getQdrantClient(): QdrantClient {
  if (!client) {
    const url = process.env.QDRANT_URL
    if (!url) {
      throw new Error('QDRANT_URL environment variable is not set')
    }
    
    client = new QdrantClient({
      url,
      apiKey: process.env.QDRANT_API_KEY, // Optional
    })
  }
  return client
}

/**
 * Check if Qdrant is configured
 */
export function isQdrantConfigured(): boolean {
  return !!process.env.QDRANT_URL
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChunkPayload {
  paper_id: string
  chunk_index: number
  content: string
  [key: string]: unknown
}

export interface PaperPayload {
  title: string
  doi?: string
  [key: string]: unknown
}

export interface SearchResult {
  id: string
  paper_id: string
  content: string
  chunk_index: number
  score: number
}

// ---------------------------------------------------------------------------
// Paper Chunks Operations
// ---------------------------------------------------------------------------

/**
 * Upsert paper chunks to Qdrant
 */
export async function upsertChunks(
  chunks: Array<{
    id: string
    paper_id: string
    chunk_index: number
    content: string
    embedding: number[]
  }>
): Promise<void> {
  const qdrant = getQdrantClient()
  
  const points = chunks.map(chunk => ({
    id: chunk.id,
    vector: chunk.embedding,
    payload: {
      paper_id: chunk.paper_id,
      chunk_index: chunk.chunk_index,
      content: chunk.content,
    } as ChunkPayload,
  }))
  
  await qdrant.upsert(COLLECTIONS.PAPER_CHUNKS, {
    wait: true,
    points,
  })
}

/**
 * Search for similar chunks
 */
export async function searchChunks(
  embedding: number[],
  options: {
    limit?: number
    minScore?: number
    paperIds?: string[] // Filter to specific papers
    boostPaperIds?: string[] // Boost scores for these papers
    boostFactor?: number
    deboostPaperIds?: string[] // De-boost scores for these papers (recently cited)
    deboostFactor?: number // Multiplier for de-boosted papers (default: 0.4 = 40% of original)
  } = {}
): Promise<SearchResult[]> {
  const qdrant = getQdrantClient()
  const {
    limit = 10,
    minScore = 0.3,
    paperIds,
    boostPaperIds,
    boostFactor = 1.15,
    deboostPaperIds,
    deboostFactor = 0.6, // Reduce to 60% of original score (softer penalty)
  } = options
  
  // Build filter
  let filter: any = undefined
  if (paperIds && paperIds.length > 0) {
    filter = {
      must: [
        {
          key: 'paper_id',
          match: { any: paperIds },
        },
      ],
    }
  }
  
  const results = await qdrant.search(COLLECTIONS.PAPER_CHUNKS, {
    vector: embedding,
    limit: limit * 2, // Fetch extra for score filtering
    filter,
    with_payload: true,
    score_threshold: minScore,
  })
  
  // Apply boost/de-boost and format results
  const boostedSet = new Set(boostPaperIds || [])
  const deboostSet = new Set(deboostPaperIds || [])
  
  return results
    .map(result => {
      const payload = result.payload as unknown as ChunkPayload
      let score = result.score
      
      // Apply de-boost first (recently cited papers)
      // This takes priority over boost - if paper is both boosted and de-boosted,
      // de-boost wins (user just cited it, don't want it again)
      if (deboostSet.has(payload.paper_id)) {
        score = score * deboostFactor
      }
      // Apply boost if paper is in boosted set (and not de-boosted)
      else if (boostedSet.has(payload.paper_id)) {
        score = Math.min(1.0, score * boostFactor)
      }
      
      return {
        id: result.id as string,
        paper_id: payload.paper_id,
        content: payload.content,
        chunk_index: payload.chunk_index,
        score,
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/**
 * Delete chunks by paper ID
 */
export async function deleteChunksByPaperId(paperId: string): Promise<void> {
  const qdrant = getQdrantClient()
  
  await qdrant.delete(COLLECTIONS.PAPER_CHUNKS, {
    wait: true,
    filter: {
      must: [
        {
          key: 'paper_id',
          match: { value: paperId },
        },
      ],
    },
  })
}

// ---------------------------------------------------------------------------
// Papers Operations (for paper-level similarity)
// ---------------------------------------------------------------------------

/**
 * Upsert paper embedding
 */
export async function upsertPaper(
  id: string,
  embedding: number[],
  payload: PaperPayload
): Promise<void> {
  const qdrant = getQdrantClient()
  
  await qdrant.upsert(COLLECTIONS.PAPERS, {
    wait: true,
    points: [
      {
        id,
        vector: embedding,
        payload,
      },
    ],
  })
}

/**
 * Batch upsert papers
 */
export async function upsertPapers(
  papers: Array<{
    id: string
    embedding: number[]
    title: string
    doi?: string
  }>
): Promise<void> {
  const qdrant = getQdrantClient()
  
  const points = papers.map(paper => ({
    id: paper.id,
    vector: paper.embedding,
    payload: {
      title: paper.title,
      doi: paper.doi,
    } as PaperPayload,
  }))
  
  await qdrant.upsert(COLLECTIONS.PAPERS, {
    wait: true,
    points,
  })
}

/**
 * Search for similar papers
 */
export async function searchPapers(
  embedding: number[],
  options: {
    limit?: number
    minScore?: number
  } = {}
): Promise<Array<{ id: string; score: number; title: string }>> {
  const qdrant = getQdrantClient()
  const { limit = 10, minScore = 0.3 } = options
  
  const results = await qdrant.search(COLLECTIONS.PAPERS, {
    vector: embedding,
    limit,
    with_payload: true,
    score_threshold: minScore,
  })
  
  return results.map(result => ({
    id: result.id as string,
    score: result.score,
    title: (result.payload as unknown as PaperPayload).title,
  }))
}

/**
 * Delete paper by ID
 */
export async function deletePaper(paperId: string): Promise<void> {
  const qdrant = getQdrantClient()
  
  await qdrant.delete(COLLECTIONS.PAPERS, {
    wait: true,
    points: [paperId],
  })
}

// ---------------------------------------------------------------------------
// Utility Operations
// ---------------------------------------------------------------------------

/**
 * Get collection info
 */
export async function getCollectionInfo(collection: string): Promise<{
  points_count: number
  indexed_vectors_count: number
}> {
  const qdrant = getQdrantClient()
  const info = await qdrant.getCollection(collection)
  
  return {
    points_count: info.points_count || 0,
    indexed_vectors_count: info.indexed_vectors_count || 0,
  }
}

/**
 * Health check
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const qdrant = getQdrantClient()
    await qdrant.getCollections()
    return true
  } catch {
    return false
  }
}
