import 'server-only'
import { getSB } from '@/lib/supabase/server'
import { generateEmbeddings } from '@/lib/utils/embedding'
import { 
  normalizeScore, 
  deduplicateChunks, 
  balanceChunks,
  reciprocalRankFusion,
  type RetrievedChunk,
  type SearchMode
} from './base-retrieval'

/**
 * ChunkRetriever - Focused class for semantic chunk retrieval
 * 
 * Responsibilities:
 * - Multi-modal search (hybrid, vector, keyword)
 * - Cross-encoder reranking (Cohere)
 * - Result deduplication and balancing
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
  /** Minimum similarity score threshold */
  minScore: number
  /** Maximum chunks to retrieve before reranking */
  retrieveLimit: number
  /** Final limit after reranking */
  finalLimit: number
  /** Enable citation-based boosting */
  useCitationBoost: boolean
  /** Max citation boost factor (0-1) */
  citationBoostFactor: number
  /** Enable cross-encoder reranking */
  useReranking: boolean
  /** Number of top candidates to rerank */
  rerankTopK: number
  /** Maximum chunks per paper for diversity */
  maxPerPaper: number
}

export const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  mode: 'hybrid',
  vectorWeight: 0.7,
  // REDUCED from 0.15 to 0.1: Let more chunks through, trust LLM to filter
  // Over-aggressive filtering leaves sections with too few sources for synthesis
  minScore: 0.1,
  retrieveLimit: 100,
  // INCREASED from 20 to 25: More material for synthesis
  finalLimit: 25,
  useCitationBoost: true,
  citationBoostFactor: 0.1,
  useReranking: true,
  rerankTopK: 30,
  // INCREASED from 5 to 6: More context per source for deeper understanding
  maxPerPaper: 6
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
  }
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
        metrics: { retrievalTimeMs: 0, rerankTimeMs: 0, uniquePapers: 0 }
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
        metrics: { retrievalTimeMs: retrievalTime, rerankTimeMs: 0, uniquePapers: 0 }
      }
    }
    
    // Step 2: Deduplicate
    let chunks = deduplicateChunks(rawChunks)
    
    // Step 3: Rerank if enabled and we have enough candidates
    let rerankTime = 0
    let wasReranked = false
    
    if (config.useReranking && chunks.length > config.finalLimit && this.cohereApiKey) {
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
    
    // Step 4: Balance across papers and apply final limit
    chunks = balanceChunks(chunks, config.maxPerPaper, config.finalLimit)
    
    // Calculate metrics
    const uniquePapers = new Set(chunks.map(c => c.paper_id)).size
    
    return {
      chunks,
      totalRetrieved: rawChunks.length,
      wasReranked,
      metrics: {
        retrievalTimeMs: retrievalTime,
        rerankTimeMs: rerankTime,
        uniquePapers
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
        metrics: { retrievalTimeMs: retrievalTime, rerankTimeMs: 0, uniquePapers: 0 }
      }
    }
    
    // Deduplicate and balance
    chunks = deduplicateChunks(chunks)
    chunks = balanceChunks(chunks, mergedConfig.maxPerPaper, mergedConfig.finalLimit)
    
    const uniquePapers = new Set(chunks.map(c => c.paper_id)).size
    
    return {
      chunks,
      totalRetrieved: resultSets.reduce((sum, r) => sum + r.length, 0),
      wasReranked: false, // RRF doesn't use reranking
      metrics: {
        retrievalTimeMs: retrievalTime,
        rerankTimeMs: 0,
        uniquePapers
      }
    }
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
    const supabase = await getSB()
    
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
   * Hybrid search combining vector + keyword with RRF.
   */
  private async hybridSearch(
    query: string,
    paperIds: string[],
    config: RetrievalConfig,
    supabase: Awaited<ReturnType<typeof getSB>>
  ): Promise<RetrievedChunk[]> {
    const [queryEmbedding] = await generateEmbeddings([query])
    
    const rpcName = config.useCitationBoost 
      ? 'hybrid_search_chunks_with_boost' 
      : 'hybrid_search_chunks'
    
    const rpcParams = config.useCitationBoost
      ? {
          query_embedding: queryEmbedding,
          search_query: query,
          match_count: config.retrieveLimit,
          min_vector_score: config.minScore,
          paper_ids: paperIds,
          vector_weight: config.vectorWeight,
          citation_boost: config.citationBoostFactor
        }
      : {
          query_embedding: queryEmbedding,
          search_query: query,
          match_count: config.retrieveLimit,
          min_vector_score: config.minScore,
          paper_ids: paperIds,
          vector_weight: config.vectorWeight
        }
    
    const { data, error } = await supabase.rpc(rpcName, rpcParams)
    
    if (error) {
      // Fallback to vector search
      console.warn('Hybrid search failed, falling back to vector:', error.message)
      return this.vectorSearch(query, paperIds, config, supabase, queryEmbedding)
    }
    
    if (!data || data.length === 0) {
      return this.vectorSearch(query, paperIds, config, supabase, queryEmbedding)
    }
    
    return this.mapSearchResults(data)
  }
  
  /**
   * Vector-only search using embeddings.
   */
  private async vectorSearch(
    query: string,
    paperIds: string[],
    config: RetrievalConfig,
    supabase: Awaited<ReturnType<typeof getSB>>,
    embedding?: number[]
  ): Promise<RetrievedChunk[]> {
    const queryEmbedding = embedding || (await generateEmbeddings([query]))[0]
    
    const { data, error } = await supabase.rpc('match_paper_chunks', {
      query_embedding: queryEmbedding,
      match_count: config.retrieveLimit,
      min_score: config.minScore,
      paper_ids: paperIds
    })
    
    if (error) {
      console.warn('Vector search failed:', error)
      return []
    }
    
    return (data || [])
      .filter((c: { score: number }) => c.score >= config.minScore)
      .map((c: { id?: string; paper_id: string; content: string; score: number; chunk_index?: number }) => ({
        id: c.id,
        paper_id: c.paper_id,
        content: c.content,
        score: normalizeScore(c.score),
        chunk_index: c.chunk_index,
        vector_score: normalizeScore(c.score)
      }))
  }
  
  /**
   * Keyword-only search using full-text search.
   */
  private async keywordSearch(
    query: string,
    paperIds: string[],
    config: RetrievalConfig,
    supabase: Awaited<ReturnType<typeof getSB>>
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
