/**
 * Hybrid Retrieval System
 * 
 * Retrieves RAG chunks targeted by structured analysis data.
 * The "librarian" that knows exactly which pages to look at.
 * 
 * Key insight: Instead of generic queries like "literature review",
 * we query specifically for each pattern's claim and its supporting papers.
 * 
 * @module lib/synthesis-engine/hybrid-retrieval
 */

import { createServiceClient } from '@/lib/supabase/service'
import { getCachedQueryEmbedding } from '@/lib/rag/embedding-cache'
import type { Pattern } from '@/lib/analysis/cross-document'
import type { FormattedPattern, FormattedContradiction } from './formatters'
import type { PaperInfo } from './types'

// =============================================================================
// Types
// =============================================================================

export interface TargetedChunk {
  id: string
  paperId: string
  paperTitle: string
  content: string
  score: number
  evidenceStrength: 'full_text' | 'abstract' | 'title_only'
  chunkIndex?: number
}

export interface PatternChunks {
  patternId: string
  patternClaim: string
  chunks: TargetedChunk[]
  totalRetrieved: number
  retrievalTimeMs: number
}

export interface RetrievalConfig {
  maxChunksPerPattern: number
  maxChunksPerPaper: number
  minScore: number
  maxTokensPerPattern: number
}

const DEFAULT_CONFIG: RetrievalConfig = {
  maxChunksPerPattern: 15,
  maxChunksPerPaper: 5,
  minScore: 0.15,
  maxTokensPerPattern: 5000
}

// =============================================================================
// Main Functions
// =============================================================================

/**
 * Retrieve chunks targeted for a specific pattern
 * 
 * Instead of generic search, we:
 * 1. Query using the pattern's claim as the search query
 * 2. Restrict to only papers that support this pattern
 * 3. Get contextual chunks that explain the "how" and "why"
 */
export async function retrieveChunksForPattern(
  pattern: FormattedPattern,
  papers: PaperInfo[],
  config: Partial<RetrievalConfig> = {}
): Promise<PatternChunks> {
  const startTime = Date.now()
  const cfg = { ...DEFAULT_CONFIG, ...config }
  
  // Get paper IDs that support this pattern
  const paperIdSet = new Set(
    pattern.supportingPapers.map(title => {
      const paper = papers.find(p => 
        p.title === title || 
        title.includes(p.title) || 
        p.title.includes(title.split(' (')[0])
      )
      return paper?.id
    }).filter(Boolean) as string[]
  )
  
  // If no papers found by title matching, fall back to all papers with warning
  const targetPaperIds = paperIdSet.size > 0 
    ? [...paperIdSet]
    : papers.map(p => p.id)
  
  if (paperIdSet.size === 0 && papers.length > 0) {
    console.warn(`⚠️ No papers matched for pattern "${pattern.claim.slice(0, 50)}...", falling back to all ${papers.length} papers`)
  }
  
  if (targetPaperIds.length === 0) {
    return {
      patternId: pattern.claim,
      patternClaim: pattern.claim,
      chunks: [],
      totalRetrieved: 0,
      retrievalTimeMs: Date.now() - startTime
    }
  }
  
  // Build targeted query from pattern claim
  const query = pattern.claim
  
  // Get embedding for query
  const embedding = await getCachedQueryEmbedding(query)
  
  // Search chunks restricted to supporting papers
  const supabase = createServiceClient()
  
  const { data: chunks, error } = await supabase.rpc('hybrid_search_chunks', {
    query_embedding: embedding,
    search_query: query,
    match_count: cfg.maxChunksPerPattern * 2, // Over-fetch for filtering
    min_vector_score: cfg.minScore,
    paper_ids: targetPaperIds,
    vector_weight: 0.7
  })
  
  if (error) {
    console.error(`Error retrieving chunks for pattern: ${error.message}`)
    return {
      patternId: pattern.claim,
      patternClaim: pattern.claim,
      chunks: [],
      totalRetrieved: 0,
      retrievalTimeMs: Date.now() - startTime
    }
  }
  
  // Get paper titles for chunks
  const paperMap = new Map(papers.map(p => [p.id, p.title]))
  
  // Transform and limit chunks
  const targetedChunks: TargetedChunk[] = []
  const paperChunkCounts = new Map<string, number>()
  let totalTokens = 0
  
  for (const chunk of (chunks || [])) {
    // Limit chunks per paper
    const paperCount = paperChunkCounts.get(chunk.paper_id) || 0
    if (paperCount >= cfg.maxChunksPerPaper) continue
    
    // Estimate tokens and check budget
    const estimatedTokens = Math.ceil(chunk.content.length / 4)
    if (totalTokens + estimatedTokens > cfg.maxTokensPerPattern) break
    
    targetedChunks.push({
      id: chunk.id,
      paperId: chunk.paper_id,
      paperTitle: paperMap.get(chunk.paper_id) || 'Unknown',
      content: chunk.content,
      score: chunk.combined_score || chunk.vector_score || 0,
      evidenceStrength: 'full_text',
      chunkIndex: chunk.chunk_index
    })
    
    paperChunkCounts.set(chunk.paper_id, paperCount + 1)
    totalTokens += estimatedTokens
    
    if (targetedChunks.length >= cfg.maxChunksPerPattern) break
  }
  
  return {
    patternId: pattern.claim,
    patternClaim: pattern.claim,
    chunks: targetedChunks,
    totalRetrieved: targetedChunks.length,
    retrievalTimeMs: Date.now() - startTime
  }
}

/**
 * Retrieve chunks for a contradiction (both sides)
 */
export async function retrieveChunksForContradiction(
  contradiction: FormattedContradiction,
  papers: PaperInfo[],
  config: Partial<RetrievalConfig> = {}
): Promise<{ side1Chunks: TargetedChunk[]; side2Chunks: TargetedChunk[] }> {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  
  const results = await Promise.all(
    contradiction.sides.map(async (side, index) => {
      // Find paper IDs for this side
      const paperIds = side.papers.map(title => {
        const paper = papers.find(p => 
          p.title === title || 
          title.includes(p.title) ||
          p.title.includes(title.split(' (')[0])
        )
        return paper?.id
      }).filter(Boolean) as string[]
      
      if (paperIds.length === 0) return []
      
      // Query using the side's position
      const query = `${side.position} ${contradiction.description}`
      const embedding = await getCachedQueryEmbedding(query)
      
      const supabase = createServiceClient()
      const { data: chunks, error } = await supabase.rpc('hybrid_search_chunks', {
        query_embedding: embedding,
        search_query: query,
        match_count: Math.ceil(cfg.maxChunksPerPattern / 2),
        min_vector_score: cfg.minScore,
        paper_ids: paperIds,
        vector_weight: 0.7
      })
      
      if (error) {
        console.error(`Error retrieving chunks for contradiction side ${index + 1}: ${error.message}`)
        return []
      }
      
      const paperMap = new Map(papers.map(p => [p.id, p.title]))
      
      return (chunks || []).slice(0, 5).map((chunk: any) => ({
        id: chunk.id,
        paperId: chunk.paper_id,
        paperTitle: paperMap.get(chunk.paper_id) || 'Unknown',
        content: chunk.content,
        score: chunk.combined_score || chunk.vector_score || 0,
        evidenceStrength: 'full_text' as const,
        chunkIndex: chunk.chunk_index
      }))
    })
  )
  
  return {
    side1Chunks: results[0] || [],
    side2Chunks: results[1] || []
  }
}

/**
 * Retrieve all chunks for a section's patterns
 */
export async function retrieveChunksForSection(
  patterns: FormattedPattern[],
  contradictions: FormattedContradiction[],
  papers: PaperInfo[],
  config: Partial<RetrievalConfig> = {}
): Promise<{
  patternChunks: Map<string, TargetedChunk[]>
  contradictionChunks: Map<string, { side1: TargetedChunk[]; side2: TargetedChunk[] }>
  totalChunks: number
  totalTimeMs: number
}> {
  const startTime = Date.now()
  
  // Retrieve chunks for all patterns in parallel
  const patternResults = await Promise.all(
    patterns.map(p => retrieveChunksForPattern(p, papers, config))
  )
  
  // Retrieve chunks for contradictions
  const contradictionResults = await Promise.all(
    contradictions.map(c => retrieveChunksForContradiction(c, papers, config))
  )
  
  // Build result maps
  const patternChunks = new Map<string, TargetedChunk[]>()
  for (const result of patternResults) {
    patternChunks.set(result.patternClaim, result.chunks)
  }
  
  const contradictionChunks = new Map<string, { side1: TargetedChunk[]; side2: TargetedChunk[] }>()
  contradictions.forEach((c, i) => {
    contradictionChunks.set(c.description, {
      side1: contradictionResults[i]?.side1Chunks || [],
      side2: contradictionResults[i]?.side2Chunks || []
    })
  })
  
  // Count total chunks
  let totalChunks = 0
  for (const chunks of patternChunks.values()) {
    totalChunks += chunks.length
  }
  for (const { side1, side2 } of contradictionChunks.values()) {
    totalChunks += side1.length + side2.length
  }
  
  return {
    patternChunks,
    contradictionChunks,
    totalChunks,
    totalTimeMs: Date.now() - startTime
  }
}

/**
 * Get all chunks for specific paper IDs (fallback when no patterns)
 */
export async function getChunksByPaperIds(
  paperIds: string[],
  query: string,
  config: Partial<RetrievalConfig> = {}
): Promise<TargetedChunk[]> {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  
  if (paperIds.length === 0) return []
  
  const embedding = await getCachedQueryEmbedding(query)
  const supabase = createServiceClient()
  
  const { data: chunks, error } = await supabase.rpc('hybrid_search_chunks', {
    query_embedding: embedding,
    search_query: query,
    match_count: cfg.maxChunksPerPattern,
    min_vector_score: cfg.minScore,
    paper_ids: paperIds,
    vector_weight: 0.7
  })
  
  if (error || !chunks) return []
  
  return chunks.map((chunk: any) => ({
    id: chunk.id,
    paperId: chunk.paper_id,
    paperTitle: 'Unknown', // Caller should enrich
    content: chunk.content,
    score: chunk.combined_score || chunk.vector_score || 0,
    evidenceStrength: 'full_text' as const,
    chunkIndex: chunk.chunk_index
  }))
}
