import 'server-only'
import { getSB } from '@/lib/supabase/server'
import { generateEmbeddings } from '@/lib/utils/embedding'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Base RAG Retrieval Service
 * 
 * Provides shared utilities for RAG retrieval used by both
 * paper generation and editor autocomplete contexts.
 * 
 * Specialized services extend this with:
 * - GenerationContext: Caching, batch processing for multi-section generation
 * - EditorContext: Claims retrieval, citation verification for autocomplete
 */

// =============================================================================
// SHARED TYPES
// =============================================================================

export interface RetrievedChunk {
  id?: string
  paper_id: string
  content: string
  score: number
  chunk_index?: number
  metadata?: Record<string, unknown>
}

export interface PaperMetadata {
  id: string
  title: string
  authors: string[]
  year: number
  doi?: string
  venue?: string
}

export interface BaseRetrievalOptions {
  paperIds: string[]
  limit?: number
  minScore?: number
}

export interface BaseRetrievalResult {
  chunks: RetrievedChunk[]
  papers: Map<string, PaperMetadata>
  hasContent: boolean
}

// =============================================================================
// SHARED UTILITIES
// =============================================================================

/**
 * Cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  
  let dotProduct = 0
  let normA = 0
  let normB = 0
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB)
  return magnitude === 0 ? 0 : dotProduct / magnitude
}

/**
 * Extract first author's last name from authors array
 * Handles compound names like "van Gogh", "de Silva"
 */
export function getFirstAuthorLastName(authors: string[]): string {
  if (!authors || authors.length === 0) return 'Unknown'
  
  const firstAuthor = authors[0]
  const parts = firstAuthor.trim().split(/\s+/)
  
  if (parts.length === 0) return 'Unknown'
  if (parts.length === 1) return parts[0]
  
  const prefixes = ['van', 'von', 'de', 'del', 'della', 'di', 'da', 'le', 'la', 'el', 'al', 'bin', 'ibn']
  const lastWord = parts[parts.length - 1]
  const secondLastWord = parts.length > 1 ? parts[parts.length - 2].toLowerCase() : ''
  
  if (prefixes.includes(secondLastWord)) {
    return `${parts[parts.length - 2]} ${lastWord}`
  }
  
  return lastWord
}

/**
 * Normalize score value (handles undefined/null)
 */
export function normalizeScore(score: number | undefined | null): number {
  return score ?? 0
}

/**
 * Create empty retrieval result
 */
export function createEmptyResult(): BaseRetrievalResult {
  return {
    chunks: [],
    papers: new Map(),
    hasContent: false
  }
}

// =============================================================================
// BASE RETRIEVAL FUNCTIONS
// =============================================================================

/**
 * Search paper chunks using vector similarity
 */
export async function searchChunks(
  query: string,
  options: BaseRetrievalOptions
): Promise<RetrievedChunk[]> {
  const { paperIds, limit = 20, minScore = 0.2 } = options
  
  if (!query.trim() || paperIds.length === 0) {
    return []
  }
  
  const supabase = await getSB()
  
  // Generate embedding for query
  const [queryEmbedding] = await generateEmbeddings([query])
  
  // Search using RPC
  const { data, error } = await supabase.rpc('match_paper_chunks', {
    query_embedding: queryEmbedding,
    match_count: limit * 2, // Fetch extra to filter
    min_score: minScore,
    paper_ids: paperIds
  })
  
  if (error) {
    console.warn('Chunk search failed:', error)
    return []
  }
  
  // Process and filter results
  const chunks: RetrievedChunk[] = (data || [])
    .filter((c: { score: number }) => c.score >= minScore)
    .slice(0, limit)
    .map((c: { id?: string; paper_id: string; content: string; score: number; chunk_index?: number }) => ({
      id: c.id,
      paper_id: c.paper_id,
      content: c.content,
      score: normalizeScore(c.score),
      chunk_index: c.chunk_index
    }))
  
  return chunks
}

/**
 * Fetch paper metadata for given IDs
 */
export async function fetchPaperMetadata(
  paperIds: string[],
  supabase?: SupabaseClient
): Promise<Map<string, PaperMetadata>> {
  const papers = new Map<string, PaperMetadata>()
  
  if (paperIds.length === 0) return papers
  
  const sb = supabase || await getSB()
  
  const { data, error } = await sb
    .from('papers')
    .select('id, title, authors, publication_date, doi, venue')
    .in('id', paperIds)
  
  if (error) {
    console.warn('Failed to fetch paper metadata:', error)
    return papers
  }
  
  for (const p of data || []) {
    const year = p.publication_date 
      ? new Date(p.publication_date).getFullYear() 
      : 0
    papers.set(p.id, {
      id: p.id,
      title: p.title || 'Unknown',
      authors: Array.isArray(p.authors) ? p.authors : [],
      year,
      doi: p.doi,
      venue: p.venue
    })
  }
  
  return papers
}

/**
 * Format chunks for prompt inclusion
 */
export function formatChunksForPrompt(
  chunks: RetrievedChunk[],
  papers: Map<string, PaperMetadata>
): string {
  if (chunks.length === 0) {
    return 'No relevant content found in papers.'
  }
  
  return chunks.map(c => {
    const paper = papers.get(c.paper_id)
    const citation = paper 
      ? `(${getFirstAuthorLastName(paper.authors)}, ${paper.year})`
      : '(Unknown source)'
    return `[Source: ${citation}]\n${c.content.trim()}`
  }).join('\n\n')
}

/**
 * Format paper list for prompt
 */
export function formatPapersForPrompt(papers: Map<string, PaperMetadata>): string {
  if (papers.size === 0) {
    return 'No papers available.'
  }
  
  return Array.from(papers.values()).map(p => {
    const firstAuthor = getFirstAuthorLastName(p.authors)
    return `- ${firstAuthor} (${p.year}): "${p.title}" [ID: ${p.id}]`
  }).join('\n')
}

/**
 * Deduplicate chunks by content hash
 */
export function deduplicateChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const seen = new Set<string>()
  return chunks.filter(chunk => {
    const hash = chunk.content.trim().toLowerCase().slice(0, 100)
    if (seen.has(hash)) return false
    seen.add(hash)
    return true
  })
}

/**
 * Balance chunks across papers to ensure diversity
 */
export function balanceChunks(
  chunks: RetrievedChunk[],
  maxPerPaper: number,
  totalLimit: number
): RetrievedChunk[] {
  const byPaper = new Map<string, RetrievedChunk[]>()
  
  for (const chunk of chunks) {
    const existing = byPaper.get(chunk.paper_id) || []
    if (existing.length < maxPerPaper) {
      existing.push(chunk)
      byPaper.set(chunk.paper_id, existing)
    }
  }
  
  // Flatten and limit
  const balanced: RetrievedChunk[] = []
  for (const paperChunks of byPaper.values()) {
    balanced.push(...paperChunks)
  }
  
  // Sort by score and limit
  return balanced
    .sort((a, b) => b.score - a.score)
    .slice(0, totalLimit)
}
