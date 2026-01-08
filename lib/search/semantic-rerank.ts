/**
 * Semantic Re-ranking Module
 * 
 * Uses embeddings to re-rank search results by semantic similarity to the query.
 * This provides much better relevance than keyword-only matching (BM25).
 */

import { generateEmbeddings } from '@/lib/utils/embedding'
import { cosineSimilarity } from '@/lib/rag/base-retrieval'

export interface RerankableItem {
  id: string
  title: string
  abstract?: string
  [key: string]: unknown
}

export type RerankedItem<T extends RerankableItem> = T & {
  semanticScore: number
  originalRank: number
}

/**
 * Re-rank items by semantic similarity to a query
 * 
 * @param query - The search query
 * @param items - Items to re-rank (must have title and optionally abstract)
 * @param options - Configuration options
 * @returns Re-ranked items with semantic scores
 */
export async function semanticRerank<T extends RerankableItem>(
  query: string,
  items: T[],
  options: {
    /** Minimum semantic score to include (0-1), default 0.3 */
    minScore?: number
    /** Weight for title vs abstract (0-1, higher = more title weight), default 0.6 */
    titleWeight?: number
    /** Maximum items to return, default all */
    maxResults?: number
    /** Whether to boost exact phrase matches, default true */
    boostExactMatch?: boolean
  } = {}
): Promise<RerankedItem<T>[]> {
  const {
    minScore = 0.25,
    titleWeight = 0.6,
    maxResults,
    boostExactMatch = true
  } = options

  if (items.length === 0) {
    return []
  }

  console.log(`🧠 Semantic re-ranking ${items.length} items for query: "${query}"`)
  const startTime = Date.now()

  try {
    // Prepare texts for embedding
    // We embed: query, all titles, all abstracts (if available)
    const queryNormalized = query.toLowerCase().trim()
    const titles = items.map(item => item.title || '')
    const abstracts = items.map(item => item.abstract || item.title || '') // Fallback to title if no abstract
    
    // Generate all embeddings in one batch for efficiency
    const allTexts = [query, ...titles, ...abstracts]
    const embeddings = await generateEmbeddings(allTexts)
    
    const queryEmbedding = embeddings[0]
    const titleEmbeddings = embeddings.slice(1, items.length + 1)
    const abstractEmbeddings = embeddings.slice(items.length + 1)

    // Calculate semantic scores
    const scored: RerankedItem<T>[] = items.map((item, index) => {
      const titleSimilarity = cosineSimilarity(queryEmbedding, titleEmbeddings[index])
      const abstractSimilarity = cosineSimilarity(queryEmbedding, abstractEmbeddings[index])
      
      // Weighted combination of title and abstract similarity
      let semanticScore = titleSimilarity * titleWeight + abstractSimilarity * (1 - titleWeight)
      
      // Boost for exact phrase match in title
      if (boostExactMatch) {
        const titleLower = item.title.toLowerCase()
        if (titleLower.includes(queryNormalized)) {
          semanticScore = Math.min(1, semanticScore * 1.3) // 30% boost, capped at 1
        }
        // Smaller boost for partial word matches
        const queryWords = queryNormalized.split(/\s+/).filter(w => w.length > 3)
        const matchingWords = queryWords.filter(word => titleLower.includes(word))
        if (matchingWords.length > 0) {
          const wordMatchRatio = matchingWords.length / queryWords.length
          semanticScore = Math.min(1, semanticScore * (1 + wordMatchRatio * 0.15))
        }
      }

      return {
        ...item,
        semanticScore,
        originalRank: index
      }
    })

    // Filter by minimum score
    const filtered = scored.filter(item => item.semanticScore >= minScore)

    // Sort by semantic score descending
    filtered.sort((a, b) => b.semanticScore - a.semanticScore)

    // Apply max results limit
    const results = maxResults ? filtered.slice(0, maxResults) : filtered

    const elapsed = Date.now() - startTime
    console.log(`✅ Semantic re-ranking complete: ${items.length} → ${results.length} items in ${elapsed}ms`)
    console.log(`   Top 3 scores: ${results.slice(0, 3).map(r => r.semanticScore.toFixed(3)).join(', ')}`)

    return results

  } catch (error) {
    console.error('Semantic re-ranking failed, returning original order:', error)
    // Return original items with default scores on failure
    return items.map((item, index) => ({
      ...item,
      semanticScore: 0.5, // Neutral score
      originalRank: index
    }))
  }
}

/**
 * Quick relevance check - returns true if query seems relevant to text
 * Uses simple heuristics, no embeddings (fast)
 */
export function quickRelevanceCheck(query: string, title: string, abstract?: string): boolean {
  const q = query.toLowerCase()
  const t = title.toLowerCase()
  const a = (abstract || '').toLowerCase()
  
  // Check for exact phrase match
  if (t.includes(q) || a.includes(q)) {
    return true
  }
  
  // Check for word overlap
  const queryWords = q.split(/\s+/).filter(w => w.length > 3)
  const textWords = new Set((t + ' ' + a).split(/\s+/))
  
  const matchCount = queryWords.filter(w => textWords.has(w)).length
  const matchRatio = queryWords.length > 0 ? matchCount / queryWords.length : 0
  
  return matchRatio >= 0.5 // At least 50% of query words present
}
