import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { getCachedQueryEmbedding } from './embedding-cache'
import { 
  normalizeScore, 
  deduplicateChunks, 
  reciprocalRankFusion,
  type RetrievedChunk,
  type SearchMode
} from './base-retrieval'
import { searchChunks as qdrantSearchChunks, isQdrantConfigured } from '@/lib/qdrant/client'

/**
 * ChunkRetriever - Focused class for semantic chunk retrieval
 * 
 * Responsibilities:
 * - Multi-modal search (hybrid, vector, keyword)
 * - Cross-encoder reranking (Cohere)
 * - Result deduplication
 * - Token-based evidence selection (semantic relevance is primary filter)
 * 
 * This class does NOT handle:
 * - Context building/formatting (see ContextBuilder)
 * - Caching (handled by GenerationContextService)
 * - Content ingestion (handled by ingestion layer)
 */

// =============================================================================
// TYPES
// =============================================================================

export interface RetrievalConfig {
  /** Search mode: hybrid (default), vector, or keyword */
  mode: SearchMode
  /** Weight for vector search in hybrid mode (0-1) */
  vectorWeight: number
  /** Minimum similarity score threshold - primary quality filter */
  minScore: number
  /** Maximum chunks to retrieve before reranking */
  retrieveLimit: number
  /** Enable citation-based boosting */
  useCitationBoost: boolean
  /** Max citation boost factor (0-1) */
  citationBoostFactor: number
  /** Enable cross-encoder reranking */
  useReranking: boolean
  /** Number of top candidates to rerank */
  rerankTopK: number
  /** Maximum tokens for evidence - the primary limit (replaces chunk count limits) */
  maxEvidenceTokens: number
}

export const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  mode: 'hybrid',
  vectorWeight: 0.7,
  // Relevance threshold - primary quality filter
  // Chunks below this score are excluded unless fallback kicks in
  minScore: 0.15,
  // Large candidate pool for reranking to select from
  retrieveLimit: 200,
  useCitationBoost: true,
  citationBoostFactor: 0.1,
  useReranking: true,
  // Rerank top candidates for better relevance ordering
  rerankTopK: 100,
  // Token budget for evidence - this is the primary limit
  // 25000 tokens ≈ 50-100 chunks depending on size
  // Leaves room for system prompt, output, and section context
  maxEvidenceTokens: 25000
}

export interface RetrievalRequest {
  query: string
  paperIds: string[]
  config?: Partial<RetrievalConfig>
}

export interface RetrievalResult {
  chunks: RetrievedChunk[]
  totalRetrieved: number
  wasReranked: boolean
  metrics: {
    retrievalTimeMs: number
    rerankTimeMs: number
    uniquePapers: number
    totalTokens: number
  }
}

// =============================================================================
// TOKEN ESTIMATION
// =============================================================================

/**
 * Estimate token count for a string.
 * Uses rough approximation: ~4 characters per token for English text.
 * This is conservative to avoid exceeding limits.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// =============================================================================
// CHUNK RETRIEVER CLASS
// =============================================================================

export class ChunkRetriever {
  private config: RetrievalConfig
  private cohereApiKey: string | null
  
  constructor(config?: Partial<RetrievalConfig>) {
    this.config = { ...DEFAULT_RETRIEVAL_CONFIG, ...config }
    this.cohereApiKey = process.env.COHERE_API_KEY || null
  }
  
  /**
   * Retrieve and optionally rerank chunks for a query.
   */
  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    const startTime = Date.now()
    const config = { ...this.config, ...request.config }
    
    if (!request.query.trim() || request.paperIds.length === 0) {
      return {
        chunks: [],
        totalRetrieved: 0,
        wasReranked: false,
        metrics: { retrievalTimeMs: 0, rerankTimeMs: 0, uniquePapers: 0, totalTokens: 0 }
      }
    }
    
    // Step 1: Initial retrieval
    const rawChunks = await this.searchChunks(request.query, request.paperIds, config)
    const retrievalTime = Date.now() - startTime
    
    if (rawChunks.length === 0) {
      return {
        chunks: [],
        totalRetrieved: 0,
        wasReranked: false,
        metrics: { retrievalTimeMs: retrievalTime, rerankTimeMs: 0, uniquePapers: 0, totalTokens: 0 }
      }
    }
    
    // Step 2: Deduplicate
    let chunks = deduplicateChunks(rawChunks)
    
    // Step 3: Rerank if enabled and we have enough candidates
    let rerankTime = 0
    let wasReranked = false
    
    if (config.useReranking && chunks.length > 20 && this.cohereApiKey) {
      const rerankStart = Date.now()
      const topCandidates = chunks.slice(0, config.rerankTopK)
      
      try {
        chunks = await this.rerankWithCohere(request.query, topCandidates)
        wasReranked = true
        console.log(`🔄 Reranked ${topCandidates.length} chunks with Cohere`)
      } catch (err) {
        console.warn('Cohere reranking failed, using original order:', err)
        // Keep original order on failure
      }
      
      rerankTime = Date.now() - rerankStart
    }
    
    // Step 4: Select chunks by token budget (semantic relevance is primary filter)
    const { selected, totalTokens } = this.selectByTokenBudget(chunks, config)
    chunks = selected
    
    // No fallback - if minScore filtered out everything, return empty
    // This prevents irrelevant chunks from being used as "evidence"
    if (chunks.length === 0 && rawChunks.length > 0) {
      console.warn(`⚠️ No chunks passed minScore threshold (${config.minScore}). Returning empty - content may be off-topic.`)
    }
    
    // Calculate metrics
    const uniquePapers = new Set(chunks.map(c => c.paper_id)).size
    
    return {
      chunks,
      totalRetrieved: rawChunks.length,
      wasReranked,
      metrics: {
        retrievalTimeMs: retrievalTime,
        rerankTimeMs: rerankTime,
        uniquePapers,
        totalTokens
      }
    }
  }
  
  /**
   * Multi-query retrieval with RRF fusion.
   * Useful for complex topics that benefit from multiple query perspectives.
   */
  async retrieveMultiQuery(
    queries: string[], 
    paperIds: string[],
    config?: Partial<RetrievalConfig>
  ): Promise<RetrievalResult> {
    const startTime = Date.now()
    const mergedConfig = { ...this.config, ...config }
    
    // Retrieve for each query
    const resultSets: RetrievedChunk[][] = []
    for (const query of queries) {
      const chunks = await this.searchChunks(query, paperIds, mergedConfig)
      resultSets.push(chunks)
    }
    
    // Merge with RRF
    let chunks = reciprocalRankFusion(resultSets)
    const retrievalTime = Date.now() - startTime
    
    if (chunks.length === 0) {
      return {
        chunks: [],
        totalRetrieved: 0,
        wasReranked: false,
        metrics: { retrievalTimeMs: retrievalTime, rerankTimeMs: 0, uniquePapers: 0, totalTokens: 0 }
      }
    }
    
    // Deduplicate and select by token budget
    chunks = deduplicateChunks(chunks)
    const { selected, totalTokens } = this.selectByTokenBudget(chunks, mergedConfig)
    
    const uniquePapers = new Set(selected.map(c => c.paper_id)).size
    
    return {
      chunks: selected,
      totalRetrieved: resultSets.reduce((sum, r) => sum + r.length, 0),
      wasReranked: false, // RRF doesn't use reranking
      metrics: {
        retrievalTimeMs: retrievalTime,
        rerankTimeMs: 0,
        uniquePapers,
        totalTokens
      }
    }
  }
  
  /**
   * Select chunks based on token budget.
   * Iterates through relevance-sorted chunks and adds them until budget is exhausted.
   * This is the primary selection mechanism - semantic relevance determines what gets included.
   */
  private selectByTokenBudget(
    chunks: RetrievedChunk[],
    config: RetrievalConfig
  ): { selected: RetrievedChunk[]; totalTokens: number } {
    const selected: RetrievedChunk[] = []
    let totalTokens = 0
    
    // Chunks should already be sorted by relevance score
    for (const chunk of chunks) {
      const chunkTokens = estimateTokens(chunk.content)
      
      // Check if adding this chunk would exceed budget
      if (totalTokens + chunkTokens > config.maxEvidenceTokens) {
        // If we haven't selected anything yet, include at least this one
        if (selected.length === 0) {
          selected.push(chunk)
          totalTokens += chunkTokens
        }
        break
      }
      
      selected.push(chunk)
      totalTokens += chunkTokens
    }
    
    // Log selection stats
    const uniquePapers = new Set(selected.map(c => c.paper_id)).size
    console.log(`📊 Token-based selection: ${selected.length} chunks (${totalTokens.toLocaleString()} tokens) from ${uniquePapers} papers`)
    
    return { selected, totalTokens }
  }
  
  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================
  
  /**
   * Core search implementation - routes to appropriate search method.
   */
  private async searchChunks(
    query: string, 
    paperIds: string[], 
    config: RetrievalConfig
  ): Promise<RetrievedChunk[]> {
    // Use service client to bypass RLS - this runs in Inngest background jobs
    const supabase = createServiceClient()
    
    switch (config.mode) {
      case 'hybrid':
        return this.hybridSearch(query, paperIds, config, supabase)
      case 'keyword':
        return this.keywordSearch(query, paperIds, config, supabase)
      case 'vector':
      default:
        return this.vectorSearch(query, paperIds, config, supabase)
    }
  }
  
  /**
   * Hybrid search combining vector (Qdrant) + keyword (Supabase) with client-side RRF.
   * 
   * This replaces the previous pgvector-based hybrid_search_chunks RPC.
   * Now uses:
   * - Qdrant for vector search (embeddings are only in Qdrant)
   * - Supabase keyword_search_chunks for full-text search
   * - Client-side Reciprocal Rank Fusion (RRF) to combine results
   */
  private async hybridSearch(
    query: string,
    paperIds: string[],
    config: RetrievalConfig,
    supabase: ReturnType<typeof createServiceClient>
  ): Promise<RetrievedChunk[]> {
    // Run vector and keyword searches in parallel
    const [vectorResults, keywordResults] = await Promise.all([
      this.vectorSearch(query, paperIds, config, supabase),
      this.keywordSearch(query, paperIds, config, supabase)
    ])
    
    // If one search type fails, return the other
    if (vectorResults.length === 0 && keywordResults.length === 0) {
      return []
    }
    if (vectorResults.length === 0) {
      return keywordResults
    }
    if (keywordResults.length === 0) {
      return vectorResults
    }
    
    // Client-side RRF fusion (same algorithm as the SQL function)
    // RRF formula: score = sum(1 / (k + rank)) where k=60 is standard
    const K = 60
    const vectorWeight = config.vectorWeight
    const keywordWeight = 1 - vectorWeight
    
    // Build score map from vector results (with ranks)
    const scoreMap = new Map<string, {
      chunk: RetrievedChunk
      vectorRank: number | null
      keywordRank: number | null
      vectorScore: number
      keywordScore: number
    }>()
    
    vectorResults.forEach((chunk, index) => {
      const key = chunk.id || `${chunk.paper_id}-${chunk.chunk_index}`
      scoreMap.set(key, {
        chunk,
        vectorRank: index + 1,
        keywordRank: null,
        vectorScore: chunk.score,
        keywordScore: 0
      })
    })
    
    // Merge keyword results
    keywordResults.forEach((chunk, index) => {
      const key = chunk.id || `${chunk.paper_id}-${chunk.chunk_index}`
      const existing = scoreMap.get(key)
      
      if (existing) {
        // Found in both - update keyword rank and score
        existing.keywordRank = index + 1
        existing.keywordScore = chunk.score
      } else {
        // Keyword only
        scoreMap.set(key, {
          chunk,
          vectorRank: null,
          keywordRank: index + 1,
          vectorScore: 0,
          keywordScore: chunk.score
        })
      }
    })
    
    // Calculate RRF scores and sort
    const combined = Array.from(scoreMap.values())
      .map(item => {
        const vectorRRF = item.vectorRank ? 1 / (K + item.vectorRank) : 0
        const keywordRRF = item.keywordRank ? 1 / (K + item.keywordRank) : 0
        const combinedScore = (vectorRRF * vectorWeight) + (keywordRRF * keywordWeight)
        
        return {
          ...item.chunk,
          score: combinedScore,
          vector_score: item.vectorScore,
          keyword_score: item.keywordScore
        }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, config.retrieveLimit)
    
    return combined
  }
  
  /**
   * Vector-only search using embeddings.
   * Uses Qdrant only (embeddings are only stored in Qdrant, not pgvector).
   */
  private async vectorSearch(
    query: string,
    paperIds: string[],
    config: RetrievalConfig,
    _supabase: ReturnType<typeof createServiceClient>,
    embedding?: number[]
  ): Promise<RetrievedChunk[]> {
    // Qdrant only - no pgvector fallback (embeddings are only in Qdrant)
    if (!isQdrantConfigured()) {
      console.warn('Qdrant not configured - cannot perform vector search')
      return []
    }
    
    const queryEmbedding = embedding || await getCachedQueryEmbedding(query)
    
    try {
      const results = await qdrantSearchChunks(queryEmbedding, {
        limit: config.retrieveLimit,
        minScore: config.minScore,
        paperIds: paperIds.length > 0 ? paperIds : undefined,
      })
      
      return results.map(r => ({
        id: r.id,
        paper_id: r.paper_id,
        content: r.content,
        score: normalizeScore(r.score),
        chunk_index: r.chunk_index,
        vector_score: normalizeScore(r.score)
      }))
    } catch (err) {
      console.error('Qdrant vector search failed:', err)
      return []
    }
  }
  
  /**
   * Keyword-only search using full-text search.
   */
  private async keywordSearch(
    query: string,
    paperIds: string[],
    config: RetrievalConfig,
    supabase: ReturnType<typeof createServiceClient>
  ): Promise<RetrievedChunk[]> {
    const { data, error } = await supabase.rpc('keyword_search_chunks', {
      search_query: query,
      match_count: config.retrieveLimit,
      paper_ids: paperIds
    })
    
    if (error) {
      console.warn('Keyword search failed:', error)
      return []
    }
    
    return (data || []).map((c: { 
      id?: string
      paper_id: string
      content: string
      score: number
      chunk_index?: number 
    }) => ({
      id: c.id,
      paper_id: c.paper_id,
      content: c.content,
      score: normalizeScore(c.score),
      chunk_index: c.chunk_index,
      keyword_score: normalizeScore(c.score)
    }))
  }
  
  /**
   * Map database results to RetrievedChunk format.
   */
  private mapSearchResults(data: Array<{
    id?: string
    paper_id: string
    content: string
    chunk_index?: number
    vector_score?: number
    keyword_score?: number
    citation_boost_applied?: number
    combined_score: number
  }>): RetrievedChunk[] {
    return data.map(c => ({
      id: c.id,
      paper_id: c.paper_id,
      content: c.content,
      score: normalizeScore(c.combined_score),
      chunk_index: c.chunk_index,
      vector_score: normalizeScore(c.vector_score),
      keyword_score: normalizeScore(c.keyword_score),
      metadata: c.citation_boost_applied ? { citation_boost: c.citation_boost_applied } : undefined
    }))
  }
  
  /**
   * Rerank chunks using Cohere cross-encoder.
   */
  private async rerankWithCohere(
    query: string,
    chunks: RetrievedChunk[]
  ): Promise<RetrievedChunk[]> {
    if (!this.cohereApiKey || chunks.length === 0) {
      return chunks
    }
    
    const response = await fetch('https://api.cohere.ai/v1/rerank', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.cohereApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'rerank-english-v3.0',
        query: query,
        documents: chunks.map(c => c.content),
        top_n: chunks.length,
        return_documents: false
      })
    })
    
    if (!response.ok) {
      throw new Error(`Cohere API error: ${response.status} ${response.statusText}`)
    }
    
    const result = await response.json() as {
      results: Array<{ index: number; relevance_score: number }>
    }
    
    // Reorder chunks based on Cohere scores
    return result.results.map(r => ({
      ...chunks[r.index],
      score: r.relevance_score,
      metadata: {
        ...chunks[r.index].metadata,
        original_score: chunks[r.index].score,
        rerank_score: r.relevance_score
      }
    }))
  }
  
  /**
   * Update configuration.
   */
  setConfig(config: Partial<RetrievalConfig>): void {
    this.config = { ...this.config, ...config }
  }
  
  /**
   * Check if reranking is available.
   */
  isRerankingAvailable(): boolean {
    return !!this.cohereApiKey
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let retrieverInstance: ChunkRetriever | null = null

export function getChunkRetriever(config?: Partial<RetrievalConfig>): ChunkRetriever {
  if (!retrieverInstance) {
    retrieverInstance = new ChunkRetriever(config)
  } else if (config) {
    retrieverInstance.setConfig(config)
  }
  return retrieverInstance
}

// Reset for testing
export function resetChunkRetriever(): void {
  retrieverInstance = null
}
