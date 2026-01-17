import 'server-only'
import { LRUCache } from 'lru-cache'
import { getSB } from '@/lib/supabase/server'
import { generateEmbeddings } from '@/lib/utils/embedding'
import { 
  fetchPaperMetadata, 
  cosineSimilarity,
  getFirstAuthorLastName,
  createEmptyResult,
  formatChunksForPrompt,
  formatPapersForPrompt,
  type RetrievedChunk,
  type BaseRetrievalResult
} from './base-retrieval'

/**
 * Editor Context Retrieval Service
 * 
 * Specialized RAG retrieval for editor autocomplete.
 * Features:
 * - Claims retrieval for better grounding
 * - Citation verification (semantic matching)
 * - Embedding caching for verification AND query performance
 * - RAG result caching for cross-request performance
 * - Paper metadata included for frontend display
 */

// =============================================================================
// RAG RESULT CACHE (Cross-request LRU)
// =============================================================================

// Forward declaration for cache - actual EditorContext type defined below
// LRU cache for RAG results - persists across requests (Vercel Fluid Compute)
const ragCache = new LRUCache<string, EditorContext>({
  max: 200,           // Max 200 cached queries
  ttl: 2 * 60 * 1000  // 2 minute TTL (short for fresh content)
})

/**
 * Generate cache key for RAG query
 * Uses normalized query text + sorted paper IDs for consistency
 */
function getRagCacheKey(query: string, paperIds: string[], options: EditorRetrievalOptions): string {
  // Normalize query: lowercase, trim, take first 200 chars
  const normalizedQuery = query.trim().toLowerCase().slice(0, 200)
  // Sort paper IDs for consistent key
  const sortedPaperIds = [...paperIds].sort().join(',')
  // Include options in key
  const optionsKey = `${options.maxChunks || 10}:${options.maxClaims || 7}:${options.minChunkScore || 0.3}:${options.minClaimScore || 0.3}`
  
  return `${normalizedQuery}|${sortedPaperIds}|${optionsKey}`
}

// =============================================================================
// EMBEDDING CACHE (Enhanced for query embeddings too)
// =============================================================================

interface EmbeddingCacheEntry {
  embedding: number[]
  timestamp: number
}

// Cache embeddings for both verification AND query generation
// Key: hash of content text
const embeddingCache = new Map<string, EmbeddingCacheEntry>()
const EMBEDDING_CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes
const EMBEDDING_CACHE_MAX_SIZE = 500

function getEmbeddingCacheKey(text: string): string {
  // Simple hash for cache key
  const normalized = text.trim().toLowerCase().slice(0, 500)
  return normalized.length + ':' + normalized.slice(0, 50) + normalized.slice(-50)
}

function getCachedEmbedding(text: string): number[] | null {
  const key = getEmbeddingCacheKey(text)
  const entry = embeddingCache.get(key)
  
  if (!entry) return null
  
  // Check TTL
  if (Date.now() - entry.timestamp > EMBEDDING_CACHE_TTL_MS) {
    embeddingCache.delete(key)
    return null
  }
  
  return entry.embedding
}

function setCachedEmbedding(text: string, embedding: number[]): void {
  // Evict old entries if cache is full
  if (embeddingCache.size >= EMBEDDING_CACHE_MAX_SIZE) {
    const now = Date.now()
    const toDelete: string[] = []
    
    for (const [key, entry] of embeddingCache) {
      if (now - entry.timestamp > EMBEDDING_CACHE_TTL_MS) {
        toDelete.push(key)
      }
    }
    
    // Delete expired entries
    for (const key of toDelete) {
      embeddingCache.delete(key)
    }
    
    // If still full, delete oldest entries
    if (embeddingCache.size >= EMBEDDING_CACHE_MAX_SIZE) {
      const entries = Array.from(embeddingCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
      
      const deleteCount = Math.ceil(EMBEDDING_CACHE_MAX_SIZE * 0.2) // Delete 20%
      for (let i = 0; i < deleteCount && i < entries.length; i++) {
        embeddingCache.delete(entries[i][0])
      }
    }
  }
  
  embeddingCache.set(getEmbeddingCacheKey(text), {
    embedding,
    timestamp: Date.now()
  })
}

/**
 * Get embeddings with caching support
 * Returns embeddings for texts, using cache when available
 */
async function getEmbeddingsWithCache(texts: string[]): Promise<number[][]> {
  const results: (number[] | null)[] = texts.map(t => getCachedEmbedding(t))
  const uncachedIndices: number[] = []
  const uncachedTexts: string[] = []
  
  for (let i = 0; i < results.length; i++) {
    if (results[i] === null) {
      uncachedIndices.push(i)
      uncachedTexts.push(texts[i])
    }
  }
  
  // Generate missing embeddings
  if (uncachedTexts.length > 0) {
    const newEmbeddings = await generateEmbeddings(uncachedTexts)
    
    for (let i = 0; i < uncachedIndices.length; i++) {
      const idx = uncachedIndices[i]
      results[idx] = newEmbeddings[i]
      setCachedEmbedding(texts[idx], newEmbeddings[i])
    }
  }
  
  return results as number[][]
}

// =============================================================================
// TYPES
// =============================================================================

export interface RetrievedClaim {
  id: string
  paper_id: string
  claim_text: string
  evidence_quote: string
  section: string
  claim_type: string
  confidence: number
  score: number
}

export interface EditorRetrievalOptions {
  maxChunks?: number
  maxClaims?: number
  minChunkScore?: number
  minClaimScore?: number
}

export interface EditorContext extends BaseRetrievalResult {
  claims: RetrievedClaim[]
}

export interface CitationVerificationResult {
  verified: boolean
  confidence: number
  evidence?: string
}

// =============================================================================
// MAIN SERVICE
// =============================================================================

/**
 * Retrieve context for editor autocomplete
 * 
 * Features LRU caching for cross-request performance:
 * - Cache key: normalized query + paper IDs + options
 * - Cache TTL: 2 minutes (short for fresh content)
 * - Embedding cache: reuses query embeddings
 * 
 * @param query - Context text to search against (preceding text + section)
 * @param paperIds - Paper IDs to scope the search
 * @param options - Retrieval configuration
 */
export async function retrieveEditorContext(
  query: string,
  paperIds: string[],
  options: EditorRetrievalOptions = {}
): Promise<EditorContext> {
  const {
    maxChunks = 10,
    maxClaims = 7,
    minChunkScore = 0.3,
    minClaimScore = 0.3
  } = options

  // Early return if no papers
  if (!paperIds || paperIds.length === 0) {
    return {
      ...createEmptyResult(),
      claims: []
    }
  }

  // Check RAG cache first
  const cacheKey = getRagCacheKey(query, paperIds, options)
  const cached = ragCache.get(cacheKey)
  if (cached) {
    console.log('[RAG Cache] Hit for editor context')
    return cached
  }

  console.log('[RAG Cache] Miss, fetching fresh context')
  const supabase = await getSB()
  
  // Generate embedding for query (use cache for repeated queries)
  const [queryEmbedding] = await getEmbeddingsWithCache([query])

  // Run chunk and claim searches in parallel
  const [chunksResult, claimsResult] = await Promise.all([
    // Search paper chunks
    supabase.rpc('match_paper_chunks', {
      query_embedding: queryEmbedding,
      match_count: maxChunks * 2,
      min_score: minChunkScore,
      paper_ids: paperIds
    }),
    // Search paper claims
    supabase.rpc('match_paper_claims', {
      query_embedding: queryEmbedding,
      paper_ids: paperIds,
      match_count: maxClaims * 2
    })
  ])

  // Process chunks
  let chunks: RetrievedChunk[] = []
  if (!chunksResult.error && chunksResult.data) {
    chunks = (chunksResult.data as Array<{
      paper_id: string
      content: string
      score: number
      chunk_index: number
    }>)
      .filter(c => c.score >= minChunkScore)
      .slice(0, maxChunks)
      .map(c => ({
        paper_id: c.paper_id,
        content: c.content,
        score: c.score,
        chunk_index: c.chunk_index
      }))
  } else if (chunksResult.error) {
    console.warn('Chunk search failed:', chunksResult.error)
  }

  // Process claims (RPC returns 'similarity' not 'score')
  let claims: RetrievedClaim[] = []
  if (!claimsResult.error && claimsResult.data) {
    claims = (claimsResult.data as Array<{
      id: string
      paper_id: string
      claim_text: string
      evidence_quote: string
      section: string
      claim_type: string
      confidence: number
      similarity: number
    }>)
      .filter(c => c.similarity >= minClaimScore)
      .slice(0, maxClaims)
      .map(c => ({ 
        ...c, 
        score: c.similarity 
      }))
  } else if (claimsResult.error) {
    console.warn('Claim search failed:', claimsResult.error)
  }

  // Get unique paper IDs from retrieved content
  const retrievedPaperIds = new Set<string>([
    ...chunks.map(c => c.paper_id),
    ...claims.map(c => c.paper_id)
  ])

  // Fetch paper metadata
  const papers = await fetchPaperMetadata(Array.from(retrievedPaperIds), supabase)

  const result: EditorContext = {
    chunks,
    claims,
    papers,
    hasContent: chunks.length > 0 || claims.length > 0
  }

  // Cache the result
  ragCache.set(cacheKey, result)

  return result
}

/**
 * Format editor context for AI prompt
 */
export function formatEditorContextForPrompt(context: EditorContext): {
  chunksText: string
  claimsText: string
  papersText: string
} {
  const { chunks, claims, papers } = context

  // Format chunks
  const chunksText = formatChunksForPrompt(chunks, papers)

  // Format claims with evidence
  const claimsText = claims.length > 0
    ? claims.map(c => {
        const paper = papers.get(c.paper_id)
        const citation = paper 
          ? `(${getFirstAuthorLastName(paper.authors)}, ${paper.year})`
          : '(Unknown source)'
        return `- ${c.claim_text} ${citation}\n  Evidence: "${c.evidence_quote}"`
      }).join('\n\n')
    : 'No relevant claims found.'

  // Format papers
  const papersText = formatPapersForPrompt(papers)

  return { chunksText, claimsText, papersText }
}

// =============================================================================
// CITATION VERIFICATION
// =============================================================================

/**
 * Verify that a citation is supported by retrieved content
 * Uses semantic similarity rather than exact matching
 * Embeddings are cached for performance
 */
export async function verifyCitation(
  citationText: string,
  paperId: string,
  context: EditorContext,
  threshold: number = 0.5
): Promise<CitationVerificationResult> {
  // Get all content from this paper
  const paperChunks = context.chunks.filter(c => c.paper_id === paperId)
  const paperClaims = context.claims.filter(c => c.paper_id === paperId)

  if (paperChunks.length === 0 && paperClaims.length === 0) {
    return { verified: false, confidence: 0 }
  }

  // Collect content texts
  const contentTexts = [
    ...paperChunks.map(c => c.content),
    ...paperClaims.map(c => c.claim_text)
  ]

  if (contentTexts.length === 0) {
    return { verified: false, confidence: 0 }
  }

  // Generate embeddings with caching (citation + all content in one call)
  const allTexts = [citationText, ...contentTexts]
  const allEmbeddings = await getEmbeddingsWithCache(allTexts)
  
  const citationEmbedding = allEmbeddings[0]
  const contentEmbeddings = allEmbeddings.slice(1)

  // Find best match
  let bestScore = 0
  let bestEvidence = ''

  for (let i = 0; i < contentEmbeddings.length; i++) {
    const score = cosineSimilarity(citationEmbedding, contentEmbeddings[i])
    if (score > bestScore) {
      bestScore = score
      bestEvidence = contentTexts[i]
    }
  }

  return {
    verified: bestScore >= threshold,
    confidence: bestScore,
    evidence: bestEvidence
  }
}

/**
 * Verify all citations in a completion
 */
export async function verifyAllCitations(
  citations: Array<{ 
    paperId: string
    marker: string
    startOffset: number
    endOffset: number 
  }>,
  suggestionText: string,
  context: EditorContext,
  threshold: number = 0.4
): Promise<Array<{ 
  paperId: string
  marker: string
  startOffset: number
  endOffset: number
  verified: boolean 
}>> {
  const results = await Promise.all(
    citations.map(async (citation) => {
      // Extract text being cited (before the citation marker)
      const textBeforeCitation = suggestionText.slice(
        Math.max(0, citation.startOffset - 200),
        citation.startOffset
      ).trim()

      // Get the sentence containing the citation
      const sentences = textBeforeCitation.split(/[.!?]+/)
      const relevantSentence = sentences[sentences.length - 1]?.trim() || textBeforeCitation

      const verification = await verifyCitation(
        relevantSentence,
        citation.paperId,
        context,
        threshold
      )

      return {
        ...citation,
        verified: verification.verified
      }
    })
  )

  return results
}

// Note: Base utilities (cosineSimilarity, getFirstAuthorLastName, etc.) 
// should be imported from './base-retrieval' or '../rag' index directly
