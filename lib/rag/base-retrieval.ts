import 'server-only'
import { getSB } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Base RAG Utilities
 * 
 * Shared types and utilities for RAG retrieval.
 * 
 * For retrieval, use:
 * - ChunkRetriever: Focused retrieval with reranking and multi-query support
 * - ContextBuilder: Context compression and formatting
 * - GenerationContextService: High-level API with caching for generation pipeline
 */

// =============================================================================
// SHARED TYPES
// =============================================================================

export type SearchMode = 'hybrid' | 'vector' | 'keyword'

/** Evidence quality indicator for distinguishing source types */
export type EvidenceStrength = 'full_text' | 'abstract' | 'title_only'

export interface RetrievedChunk {
  id?: string
  paper_id: string
  content: string
  score: number
  chunk_index?: number
  metadata?: Record<string, unknown>
  /** Vector similarity score (0-1) */
  vector_score?: number
  /** Keyword/BM25 score */
  keyword_score?: number
  /** 
   * Evidence quality indicator - helps LLM weight citations appropriately
   * - 'full_text': From PDF/full paper content (strongest)
   * - 'abstract': From paper abstract only (weaker)  
   * - 'title_only': Just title available (weakest, avoid strong claims)
   */
  evidence_strength?: EvidenceStrength
}

export interface PaperMetadata {
  id: string
  title: string
  authors: string[]
  year: number
  doi?: string
  venue?: string
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

/**
 * Reciprocal Rank Fusion for combining multiple result sets.
 * Used for multi-query RAG or client-side result merging.
 * 
 * @param resultSets - Array of result sets to merge
 * @param k - RRF constant (default 60)
 * @returns Merged and re-ranked chunks
 */
export function reciprocalRankFusion(
  resultSets: RetrievedChunk[][],
  k: number = 60
): RetrievedChunk[] {
  const scoreMap = new Map<string, { chunk: RetrievedChunk; rrfScore: number }>()
  
  for (const results of resultSets) {
    for (let rank = 0; rank < results.length; rank++) {
      const chunk = results[rank]
      const key = chunk.id || `${chunk.paper_id}:${chunk.content.slice(0, 50)}`
      
      const existing = scoreMap.get(key)
      const rrfContribution = 1 / (k + rank + 1)
      
      if (existing) {
        existing.rrfScore += rrfContribution
        // Keep the higher individual score
        if (chunk.score > existing.chunk.score) {
          existing.chunk = chunk
        }
      } else {
        scoreMap.set(key, { 
          chunk: { ...chunk }, 
          rrfScore: rrfContribution 
        })
      }
    }
  }
  
  // Sort by RRF score and return
  return Array.from(scoreMap.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .map(({ chunk, rrfScore }) => ({
      ...chunk,
      score: rrfScore // Replace score with RRF score
    }))
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
