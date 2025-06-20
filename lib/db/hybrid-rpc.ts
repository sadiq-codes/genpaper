import { getSB } from '@/lib/supabase/server'
import type { PaperWithAuthors } from '@/types/simplified'
import { ai } from '@/lib/ai/vercel-client'
import { embedMany } from 'ai'

export interface HybridRpcOptions {
  limit?: number
  minYear?: number
  semanticWeight?: number
  textWeight?: number
}

/**
 * Lightweight wrapper around the Postgres function `search_papers_hybrid`.
 * Returns papers ranked by blended vector + text similarity.
 */
export async function hybridSearchPapersRPC(
  query: string,
  opts: HybridRpcOptions = {}
): Promise<PaperWithAuthors[]> {
  const supabase = await getSB()
  const {
    limit = 25,
    minYear = 1900,
    semanticWeight = 0.5,
    textWeight = 0.5
  } = opts

  // Generate embedding for the query phrase using OpenAI embeddings
  const { embeddings } = await embedMany({
    model: ai.embedding('text-embedding-3-small', { dimensions: 384 }),
    values: [query],
    maxRetries: 3
  })
  const embedding = embeddings[0]

  const { data, error } = await supabase.rpc('search_papers_hybrid', {
    p_query: query,
    p_query_embedding: embedding,
    p_limit: limit,
    p_min_year: minYear,
    p_semantic_weight: semanticWeight,
    p_text_weight: textWeight
  })

  if (error) throw error
  return (data || []) as PaperWithAuthors[]
} 