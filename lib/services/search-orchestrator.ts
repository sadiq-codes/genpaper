import { hybridSearchPapers } from '@/lib/db/papers'
import { parallelSearch } from './paper-aggregation'
import type { PaperWithAuthors, PaperSource } from '@/types/simplified'
import type { AggregatedSearchOptions } from './paper-aggregation'
import { getSB } from '@/lib/supabase/server'

// Unified search options combining all search strategies
export interface UnifiedSearchOptions {
  // Core options
  maxResults?: number
  minResults?: number
  excludePaperIds?: string[]
  fromYear?: number
  toYear?: number
  
  // Regional boosting
  localRegion?: string
  
  // Search strategy control
  useHybridSearch?: boolean
  useKeywordSearch?: boolean
  useAcademicAPIs?: boolean
  combineResults?: boolean
  forceIngest?: boolean
  fastMode?: boolean
  
  // Sources and weights
  sources?: PaperSource[]
  semanticWeight?: number
  authorityWeight?: number
  recencyWeight?: number
  vectorWeight?: number
  academicWeight?: number
}

export interface UnifiedSearchResult {
  papers: PaperWithAuthors[]
  metadata: {
    totalFound: number
    searchStrategies: string[]
    hybridResults: number
    keywordResults: number
    academicResults: number
    broaderSearchResults: number
    localRegionBoost: boolean
    localPapersCount: number
    cacheHits: number
    searchTimeMs: number
  }
}

// In-memory cache for search results within a single request
class SearchCache {
  private cache = new Map<string, { papers: PaperWithAuthors[], timestamp: number }>()
  private readonly TTL_MS = 60000 // 1 minute TTL

  getCacheKey(query: string, options: Partial<UnifiedSearchOptions>): string {
    const keyData = {
      query: query.toLowerCase().trim(),
      maxResults: options.maxResults,
      fromYear: options.fromYear,
      semanticWeight: options.semanticWeight,
      excludeIds: options.excludePaperIds?.sort().join(',') || ''
    }
    return JSON.stringify(keyData)
  }

  get(key: string): PaperWithAuthors[] | null {
    const cached = this.cache.get(key)
    if (!cached) return null
    
    if (Date.now() - cached.timestamp > this.TTL_MS) {
      this.cache.delete(key)
      return null
    }
    
    return cached.papers
  }

  set(key: string, papers: PaperWithAuthors[]): void {
    this.cache.set(key, { papers, timestamp: Date.now() })
  }

  clear(): void {
    this.cache.clear()
  }
}

// Global cache instance for the request lifecycle
const searchCache = new SearchCache()

/**
 * Unified Search Orchestrator
 * Eliminates redundant hybridSearchPapers calls and provides intelligent fallback strategies
 */
export async function unifiedSearch(
  query: string,
  options: UnifiedSearchOptions = {}
): Promise<UnifiedSearchResult> {
  const startTime = Date.now()
  const {
    maxResults = 20,
    minResults = 5,
    excludePaperIds = [],
    fromYear = 2000,
    localRegion,
    useHybridSearch = true,
    useKeywordSearch = true,
    useAcademicAPIs = true,
    combineResults = true,
    forceIngest = false,
    fastMode = false,
    sources = ['openalex', 'crossref', 'semantic_scholar'],
    semanticWeight = 0.7,
    authorityWeight = 0.5,
    recencyWeight = 0.1
  } = options

  console.log(`🎯 Unified Search Starting: "${query}"`)
  console.log(`   📊 Target: ${maxResults} results (min: ${minResults})`)
  console.log(`   🌍 Local region: ${localRegion || 'none'}`)
  console.log(`   🚫 Excluded: ${excludePaperIds.length} papers`)

  let allPapers: PaperWithAuthors[] = []
  const searchStrategies: string[] = []
  let hybridResults = 0
  let keywordResults = 0
  let academicResults = 0
  let broaderSearchResults = 0
  let cacheHits = 0

  // Strategy 1: Hybrid Search (Vector + Keyword combined)
  if (useHybridSearch) {
    const cacheKey = searchCache.getCacheKey(query, { maxResults, fromYear, semanticWeight, excludePaperIds })
    let hybridPapers = searchCache.get(cacheKey)
    
    if (hybridPapers) {
      console.log(`✅ Cache hit for hybrid search`)
      cacheHits++
    } else {
      try {
        console.log(`🧠 Executing hybrid search...`)
        hybridPapers = await hybridSearchPapers(query, {
          limit: maxResults * 2, // Get more to account for filtering
          excludePaperIds,
          minYear: fromYear,
          semanticWeight
        })
        
        if (hybridPapers.length > 0) {
          searchCache.set(cacheKey, hybridPapers)
        }
      } catch (error) {
        console.warn(`⚠️ Hybrid search failed:`, error)
        hybridPapers = []
      }
    }

    if (hybridPapers && hybridPapers.length > 0) {
      allPapers = hybridPapers
      hybridResults = hybridPapers.length
      searchStrategies.push('hybrid')
      console.log(`✅ Hybrid search: ${hybridPapers.length} papers`)
    }
  }

  // Strategy 2: Keyword Search Fallback (only if not enough results)
  if (useKeywordSearch && allPapers.length < minResults) {
    try {
      console.log(`🔤 Executing keyword search fallback...`)
      const supabase = await getSB()
      
      const { data: keywordPapers, error } = await supabase
        .from('papers')
        .select(`
          id,
          title,
          abstract,
          publication_date,
          venue,
          doi,
          url,
          metadata,
          created_at,
          authors:paper_authors(
            author:authors(id, name, affiliation)
          )
        `)
        .textSearch('title', query)
        .not('id', 'in', `(${[...excludePaperIds, ...allPapers.map(p => p.id)].join(',')})`)
        .order('created_at', { ascending: false })
        .limit(maxResults)

      if (!error && keywordPapers && keywordPapers.length > 0) {
        const formattedKeywordPapers: PaperWithAuthors[] = keywordPapers.map(paper => ({
          ...paper,
          authors: paper.authors?.map((pa: any) => pa.author).filter(Boolean) || [],
          author_names: paper.authors?.map((pa: any) => pa.author?.name).filter(Boolean) || []
        }))

        if (combineResults) {
          const existingIds = new Set(allPapers.map(p => p.id))
          const newKeywordPapers = formattedKeywordPapers.filter(p => !existingIds.has(p.id))
          allPapers = [...allPapers, ...newKeywordPapers]
        } else if (allPapers.length === 0) {
          allPapers = formattedKeywordPapers
        }

        keywordResults = formattedKeywordPapers.length
        searchStrategies.push('keyword')
        console.log(`✅ Keyword search: ${formattedKeywordPapers.length} papers`)
      }
    } catch (error) {
      console.warn(`⚠️ Keyword search failed:`, error)
    }
  }

  // Strategy 3: Academic APIs (only if still not enough results)
  if (useAcademicAPIs && allPapers.length < minResults) {
    try {
      console.log(`🌐 Executing academic API search...`)
      const academicOptions: AggregatedSearchOptions = {
        maxResults: maxResults - allPapers.length,
        sources,
        fastMode,
        semanticWeight,
        authorityWeight,
        recencyWeight
      }

      const rankedPapers = await parallelSearch(query, academicOptions)
      
      if (rankedPapers.length > 0) {
        // Convert RankedPaper to PaperWithAuthors format
        const convertedPapers: PaperWithAuthors[] = rankedPapers.map(paper => ({
          id: paper.canonical_id || `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          title: paper.title,
          abstract: paper.abstract || '',
          publication_date: paper.year ? `${paper.year}-01-01` : new Date().toISOString(),
          venue: paper.venue || '',
          doi: paper.doi || '',
          url: paper.url || '',
          metadata: {
            api_source: paper.source,
            relevance_score: paper.relevanceScore,
            combined_score: paper.combinedScore,
            authority_score: paper.authorityScore,
            recency_score: paper.recencyScore,
            canonical_id: paper.canonical_id
          },
          created_at: new Date().toISOString(),
          authors: paper.authors?.map((author: any) => ({
            id: `temp-author-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: typeof author === 'string' ? author : (author.name || 'Unknown'),
            affiliation: typeof author === 'object' ? author.affiliation : undefined
          })) || [],
          author_names: paper.authors?.map((author: any) => 
            typeof author === 'string' ? author : (author.name || 'Unknown')
          ) || []
        }))

        if (combineResults) {
          const existingIds = new Set(allPapers.map(p => p.id))
          const newAcademicPapers = convertedPapers.filter(p => !existingIds.has(p.id))
          allPapers = [...allPapers, ...newAcademicPapers]
        } else if (allPapers.length === 0) {
          allPapers = convertedPapers
        }

        academicResults = convertedPapers.length
        searchStrategies.push('academic_apis')
        console.log(`✅ Academic APIs: ${convertedPapers.length} papers`)
      }
    } catch (error) {
      console.warn(`⚠️ Academic API search failed:`, error)
    }
  }

  // Strategy 4: Broader Search (only if still insufficient results)
  if (allPapers.length < minResults) {
    console.log(`🔄 Executing broader search strategy...`)
    const broaderPapers = await performBroaderSearchOptimized(
      query, 
      maxResults - allPapers.length,
      [...excludePaperIds, ...allPapers.map(p => p.id)],
      { fromYear, semanticWeight }
    )
    
    allPapers = [...allPapers, ...broaderPapers]
    broaderSearchResults = broaderPapers.length
    if (broaderPapers.length > 0) {
      searchStrategies.push('broader_search')
      console.log(`✅ Broader search: ${broaderPapers.length} papers`)
    }
  }

  // Strategy 5: Regional Boosting (reorder results)
  let localPapersCount = 0
  let localRegionBoost = false

  if (localRegion && allPapers.length > 0) {
    console.log(`🌍 Applying regional boosting for: ${localRegion}`)
    
    const localPapers: PaperWithAuthors[] = []
    const otherPapers: PaperWithAuthors[] = []

    for (const paper of allPapers) {
      const paperRegion = paper.metadata?.region
      if (paperRegion === localRegion) {
        localPapers.push(paper)
      } else {
        otherPapers.push(paper)
      }
    }

    if (localPapers.length > 0) {
      allPapers = [...localPapers, ...otherPapers]
      localPapersCount = localPapers.length
      localRegionBoost = true
      console.log(`✅ Regional boost: ${localPapers.length} local papers moved to front`)
    }
  }

  // Final result preparation
  const finalPapers = allPapers.slice(0, maxResults)
  const searchTimeMs = Date.now() - startTime

  console.log(`🎯 Unified search completed in ${searchTimeMs}ms:`)
  console.log(`   📊 Total found: ${finalPapers.length}`)
  console.log(`   🔍 Strategies: ${searchStrategies.join(', ')}`)
  console.log(`   💾 Cache hits: ${cacheHits}`)

  return {
    papers: finalPapers,
    metadata: {
      totalFound: finalPapers.length,
      searchStrategies,
      hybridResults,
      keywordResults,
      academicResults,
      broaderSearchResults,
      localRegionBoost,
      localPapersCount,
      cacheHits,
      searchTimeMs
    }
  }
}

/**
 * Optimized broader search that reuses cached embeddings and avoids redundant calls
 */
async function performBroaderSearchOptimized(
  topic: string,
  remainingSlots: number,
  excludeIds: string[],
  options: { fromYear?: number, semanticWeight?: number } = {}
): Promise<PaperWithAuthors[]> {
  if (remainingSlots <= 0) return []

  const { fromYear = 2000, semanticWeight = 0.6 } = options
  
  // Extract key terms for broader search
  const keyTerms = topic.toLowerCase().split(/\s+/).filter(term => 
    term.length > 3 && !['and', 'the', 'for', 'with', 'from', 'using', 'based'].includes(term)
  )

  if (keyTerms.length < 2) return []

  console.log(`🔍 Broader search terms: [${keyTerms.join(', ')}]`)
  
  // Create search combinations (limit to 3 to avoid too many calls)
  const searchCombinations: string[] = []
  for (let i = 0; i < keyTerms.length && searchCombinations.length < 3; i++) {
    for (let j = i + 1; j < keyTerms.length && searchCombinations.length < 3; j++) {
      searchCombinations.push(`${keyTerms[i]} ${keyTerms[j]}`)
    }
  }

  const additionalPapers: PaperWithAuthors[] = []
  const slotsPerQuery = Math.ceil(remainingSlots / searchCombinations.length)

  // Execute searches with caching
  for (const searchTerm of searchCombinations) {
    if (additionalPapers.length >= remainingSlots) break

    const cacheKey = searchCache.getCacheKey(searchTerm, { 
      maxResults: slotsPerQuery, 
      fromYear, 
      semanticWeight, 
      excludePaperIds: excludeIds 
    })
    
    let termResults = searchCache.get(cacheKey)
    
    if (!termResults) {
      try {
        termResults = await hybridSearchPapers(searchTerm, {
          limit: slotsPerQuery,
          excludePaperIds: [...excludeIds, ...additionalPapers.map(p => p.id)],
          minYear: fromYear,
          semanticWeight
        })
        
        if (termResults.length > 0) {
          searchCache.set(cacheKey, termResults)
        }
      } catch (error) {
        console.warn(`⚠️ Broader search for "${searchTerm}" failed:`, error)
        continue
      }
    }

    if (termResults && termResults.length > 0) {
      // Filter out already found papers
      const existingIds = new Set([...excludeIds, ...additionalPapers.map(p => p.id)])
      const newPapers = termResults.filter(p => !existingIds.has(p.id))
      
      additionalPapers.push(...newPapers.slice(0, remainingSlots - additionalPapers.length))
      console.log(`   🔍 "${searchTerm}": ${newPapers.length} new papers`)
    }
  }

  return additionalPapers
}

/**
 * Clear the search cache (useful for testing or memory management)
 */
export function clearSearchCache(): void {
  searchCache.clear()
} 