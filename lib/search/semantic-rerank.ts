/**
 * Semantic Re-ranking Module
 * 
 * Uses embeddings to re-rank search results by semantic similarity to the query.
 * This provides much better relevance than keyword-only matching (BM25).
 * 
 * PERFORMANCE OPTIMIZATION:
 * To avoid slow embedding generation for large result sets, we use a 2-stage approach:
 * 1. BM25 pre-filter: Quickly rank all papers using keyword matching
 * 2. Semantic re-rank: Only embed the top N papers (default 50)
 * 
 * This reduces embedding calls from 2N+1 to 2*50+1 = 101 (87% reduction for 400 papers)
 */

import { generateEmbeddings } from '@/lib/utils/embedding'
import { cosineSimilarity } from '@/lib/rag/base-retrieval'
import { stemWords } from '@/lib/utils/stemmer'

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

// Maximum papers to embed (performance optimization)
const MAX_PAPERS_TO_EMBED = 50

/**
 * BM25 parameters for quick ranking
 */
interface BM25Params {
  k1: number
  b: number
  avgDocLen: number
  idf: Map<string, number>
  queryTerms: string[]
}

/**
 * Build BM25 environment for quick ranking
 */
function buildBM25Params(query: string, items: RerankableItem[]): BM25Params {
  const k1 = 1.2
  const b = 0.75
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2)
  const N = items.length

  // Compute document frequencies
  const dfCounts = new Map<string, number>()
  for (const term of queryTerms) {
    dfCounts.set(term, 0)
  }

  let totalDocLength = 0
  for (const item of items) {
    const text = `${item.title} ${item.abstract || ''}`.toLowerCase()
    const tokens = text.split(/\s+/)
    totalDocLength += tokens.length
    
    const seenTerms = new Set<string>()
    for (const token of tokens) {
      for (const term of queryTerms) {
        if (token.includes(term) && !seenTerms.has(term)) {
          dfCounts.set(term, (dfCounts.get(term) || 0) + 1)
          seenTerms.add(term)
        }
      }
    }
  }

  const idf = new Map<string, number>()
  for (const term of queryTerms) {
    const df = dfCounts.get(term) || 0
    const idfVal = df === 0 ? 0 : Math.log((N - df + 0.5) / (df + 0.5))
    idf.set(term, idfVal)
  }

  return {
    k1,
    b,
    avgDocLen: totalDocLength / Math.max(1, N),
    idf,
    queryTerms
  }
}

/**
 * Calculate BM25 score for a single item
 */
function calculateBM25Score(params: BM25Params, title: string, abstract: string): number {
  const { idf, avgDocLen, k1, b, queryTerms } = params

  const titleTerms = title.toLowerCase().split(/\s+/)
  const abstractTerms = abstract.toLowerCase().split(/\s+/)
  const docLength = titleTerms.length + abstractTerms.length

  let score = 0
  for (const term of queryTerms) {
    const idfVal = idf.get(term) || 0
    if (idfVal === 0) continue

    // Title terms weighted 2x
    const tf = titleTerms.filter(t => t.includes(term)).length * 2 +
               abstractTerms.filter(t => t.includes(term)).length

    if (tf === 0) continue

    const numerator = tf * (k1 + 1)
    const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLen))
    score += idfVal * (numerator / denominator)
  }

  return score
}

/**
 * Quick BM25 pre-filter to select top candidates before expensive embedding
 */
function bm25PreFilter<T extends RerankableItem>(
  query: string, 
  items: T[], 
  maxItems: number
): T[] {
  if (items.length <= maxItems) {
    return items
  }

  const params = buildBM25Params(query, items)
  
  const scored = items.map((item, index) => ({
    item,
    score: calculateBM25Score(params, item.title, item.abstract || ''),
    originalIndex: index
  }))

  // Sort by BM25 score descending
  scored.sort((a, b) => b.score - a.score)

  // Return top items
  return scored.slice(0, maxItems).map(s => s.item)
}

/**
 * Re-rank items by semantic similarity to a query
 * 
 * PERFORMANCE: Uses 2-stage ranking:
 * 1. BM25 pre-filter to top 50 papers (fast, keyword-based)
 * 2. Semantic re-rank on filtered set (slow, embedding-based)
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
    /** Maximum items to embed (for performance), default 50 */
    maxItemsToEmbed?: number
  } = {}
): Promise<RerankedItem<T>[]> {
  const {
    minScore = 0.25,
    titleWeight = 0.6,
    maxResults,
    boostExactMatch = true,
    maxItemsToEmbed = MAX_PAPERS_TO_EMBED
  } = options

  if (items.length === 0) {
    return []
  }

  console.log(`🧠 Semantic re-ranking ${items.length} items for query: "${query}"`)
  const startTime = Date.now()

  try {
    // STAGE 1: BM25 pre-filter for large result sets
    let itemsToEmbed: T[]
    let preFilterApplied = false
    
    if (items.length > maxItemsToEmbed) {
      console.log(`📊 Pre-filtering ${items.length} items to top ${maxItemsToEmbed} using BM25...`)
      const preFilterStart = Date.now()
      itemsToEmbed = bm25PreFilter(query, items, maxItemsToEmbed)
      preFilterApplied = true
      console.log(`   BM25 pre-filter completed in ${Date.now() - preFilterStart}ms`)
    } else {
      itemsToEmbed = items
    }

    // STAGE 2: Semantic re-ranking on filtered set
    // Prepare texts for embedding
    // We embed: query, all titles, all abstracts (if available)
    const queryNormalized = query.toLowerCase().trim()
    const titles = itemsToEmbed.map(item => item.title || '')
    const abstracts = itemsToEmbed.map(item => item.abstract || item.title || '') // Fallback to title if no abstract
    
    // Generate all embeddings in one batch for efficiency
    const allTexts = [query, ...titles, ...abstracts]
    console.log(`🔢 Generating ${allTexts.length} embeddings (1 query + ${titles.length} titles + ${abstracts.length} abstracts)...`)
    const embedStart = Date.now()
    const embeddings = await generateEmbeddings(allTexts)
    console.log(`   Embeddings generated in ${Date.now() - embedStart}ms`)
    
    const queryEmbedding = embeddings[0]
    const titleEmbeddings = embeddings.slice(1, itemsToEmbed.length + 1)
    const abstractEmbeddings = embeddings.slice(itemsToEmbed.length + 1)

    // Calculate semantic scores
    const scored: RerankedItem<T>[] = itemsToEmbed.map((item, index) => {
      const titleSimilarity = cosineSimilarity(queryEmbedding, titleEmbeddings[index])
      const abstractSimilarity = cosineSimilarity(queryEmbedding, abstractEmbeddings[index])
      
      // Weighted combination of title and abstract similarity
      let semanticScore = titleSimilarity * titleWeight + abstractSimilarity * (1 - titleWeight)
      
      // Boost for exact phrase match in title (more conservative)
      if (boostExactMatch) {
        const titleLower = item.title.toLowerCase()
        if (titleLower.includes(queryNormalized)) {
          // Only boost if the base score indicates relevance (>0.5)
          // This prevents irrelevant papers from getting boosted to 1.0
          if (semanticScore > 0.5) {
            semanticScore = Math.min(0.95, semanticScore * 1.15) // 15% boost, capped at 0.95
          }
        }
        // Smaller boost for partial word matches (only if moderately relevant)
        const queryWords = queryNormalized.split(/\s+/).filter(w => w.length > 3)
        const matchingWords = queryWords.filter(word => titleLower.includes(word))
        if (matchingWords.length > 0 && semanticScore > 0.4) {
          const wordMatchRatio = matchingWords.length / queryWords.length
          semanticScore = Math.min(0.95, semanticScore * (1 + wordMatchRatio * 0.08))
        }
      }

      // Find original rank (before BM25 pre-filter)
      const originalRank = preFilterApplied 
        ? items.findIndex(orig => orig.id === item.id)
        : index

      return {
        ...item,
        semanticScore,
        originalRank: originalRank >= 0 ? originalRank : index
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
    if (preFilterApplied) {
      console.log(`   (Pre-filtered to ${itemsToEmbed.length} before embedding)`)
    }
    console.log(`   Top 3 scores: ${results.slice(0, 3).map(r => r.semanticScore.toFixed(3)).join(', ')}`)

    return results

  } catch (error) {
    console.error('Semantic re-ranking failed:', error)
    // Don't return fabricated scores - let the error propagate
    // Caller should handle this by falling back to BM25 or failing gracefully
    throw error
  }
}

/**
 * Quick relevance check - returns true if query seems relevant to text
 * Uses stemming for better matching of related words (e.g., "religion" matches "religious")
 * 
 * Discipline filtering is now handled through:
 * 1. OpenAlex concept filtering at the API level (most effective)
 * 2. LLM-based query rewriting with discipline context
 * 3. Semantic similarity scoring during re-ranking
 * 
 * @param query - The search query
 * @param title - Paper title
 * @param abstract - Paper abstract (optional)
 * @param _discipline - Unused, kept for backward compatibility
 * @returns true if the paper passes the relevance threshold
 * 
 * @example
 * quickRelevanceCheck("Religion in American literature", "Religious themes in American novels")
 * // → true (stems: "religi" matches "religi", "american" matches "american", "literatur" matches)
 */
export function quickRelevanceCheck(query: string, title: string, abstract?: string, _discipline?: string): boolean {
  const q = query.toLowerCase()
  const t = title.toLowerCase()
  const a = (abstract || '').toLowerCase()
  const combinedText = t + ' ' + a
  
  // Discipline-based filtering is now handled by:
  // 1. OpenAlex concept IDs in buildOpenAlexFilter()
  // 2. Discipline-aware query expansion in generateQueryRewrites()
  // 3. Semantic similarity thresholds in semanticRerank()
  // No hardcoded keyword lists needed.
  
  // Check for exact phrase match (fast path)
  if (t.includes(q) || a.includes(q)) {
    return true
  }
  
  // Use stemming for word overlap check
  // This allows "religion" to match "religious", "literature" to match "literary", etc.
  const queryStemsSet = stemWords(q)
  const textStemsSet = stemWords(combinedText)
  
  // Count how many query stems appear in the text
  const matchCount = [...queryStemsSet].filter(stem => textStemsSet.has(stem)).length
  const matchRatio = queryStemsSet.size > 0 ? matchCount / queryStemsSet.size : 0
  
  // TIGHTER threshold: Require at least 2 meaningful stems AND 25% ratio
  // This prevents single-word matches (e.g., "cancer" alone) from passing
  // Papers must have genuine topical overlap, not just one common term
  // For a 5-word query like "hormone therapy on cancer", need 2+ stems (e.g., "hormone" + "cancer")
  return matchRatio >= 0.25 && matchCount >= 2
}
