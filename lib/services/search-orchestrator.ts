import 'server-only'

import { hybridSearchPapers } from '@/lib/db/papers'
import { getSB } from '@/lib/supabase/client'
import type { PaperWithAuthors, PaperSource } from '@/types/simplified'
import type { AggregatedSearchOptions } from '@/lib/services/paper-aggregation'
import { AsyncLocalStorage } from 'node:async_hooks'
import pLimit from 'p-limit'
import { WordTokenizer, PorterStemmer } from 'natural'
import { generateDeterministicAuthorId, generateDeterministicPaperId } from '@/lib/utils/deterministic-id'
import { searchAndIngestPapers } from '@/lib/services/paper-aggregation'
import { ContextRetrievalService } from '@/lib/generation/context-retrieval-service'

/**
 * @services/search-orchestrator
 * 
 * Single hub for Library/Hybrid/Academic search with unified results + provenance.
 * Provides clean API: search({query, projectId}) returning unified results.
 */

const tokenizer = new WordTokenizer()

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
  fastMode?: boolean
  
  // Sources and weights
  sources?: PaperSource[]
  semanticWeight?: number
  authorityWeight?: number
  recencyWeight?: number
  vectorWeight?: number
  academicWeight?: number
  
  // Performance options
  timeoutMs?: number
  concurrencyLimit?: number
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
    errors: string[]
    vectorIndexEmpty?: boolean // For debugging vector search issues
  }
}

// Cache entry interface
interface CacheEntry {
  papers: PaperWithAuthors[]
  timestamp: number
}

// Request-scoped cache using AsyncLocalStorage
const searchCacheALS = new AsyncLocalStorage<Map<string, CacheEntry>>()
const TTL_MS = 60000 // 1 minute TTL

// Debug logging helper
function debugLog(message: string, ...args: unknown[]) {
  if (process.env.LOG_LEVEL === 'debug' || process.env.NODE_ENV === 'development') {
    console.log(message, ...args)
  }
}

// Timeout helper
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutValue: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(timeoutValue), timeoutMs))
  ])
}

// Cache utilities
function getCacheKey(query: string, options: Partial<UnifiedSearchOptions>): string {
  const keyData = {
    query: query.toLowerCase().trim(),
    maxResults: options.maxResults,
    fromYear: options.fromYear,
    semanticWeight: options.semanticWeight,
    excludeIds: options.excludePaperIds?.sort().join(',') || ''
  }
  return JSON.stringify(keyData)
}

// Global LRU cache fallback when ALS is not available
const globalCache = new Map<string, CacheEntry>()
const MAX_GLOBAL_CACHE_SIZE = 100

function getCachedResult(key: string): PaperWithAuthors[] | null {
  const cache = searchCacheALS.getStore()
  
  if (!cache) {
    // Fallback to global cache when not in request context (e.g., CLI scripts)
    if (process.env.NODE_ENV === 'development') {
      console.log('⚠️ Search cache ALS not available, using global fallback')
    }
    
    const cached = globalCache.get(key)
    if (!cached) return null
    
    if (Date.now() - cached.timestamp > TTL_MS) {
      globalCache.delete(key)
      return null
    }
    
    return cached.papers
  }
  
  const cached = cache.get(key)
  if (!cached) return null
  
  if (Date.now() - cached.timestamp > TTL_MS) {
    cache.delete(key)
    return null
  }
  
  return cached.papers
}

function setCachedResult(key: string, papers: PaperWithAuthors[]): void {
  const cache = searchCacheALS.getStore()
  
  if (!cache) {
    // Fallback to global cache with LRU eviction
    if (globalCache.size >= MAX_GLOBAL_CACHE_SIZE) {
      const oldestKey = globalCache.keys().next().value
      if (oldestKey) {
        globalCache.delete(oldestKey)
      }
    }
    globalCache.set(key, { papers, timestamp: Date.now() })
    return
  }
  
  cache.set(key, { papers, timestamp: Date.now() })
}

// Deduplication helper
function dedupePapers(papers: PaperWithAuthors[]): PaperWithAuthors[] {
  const seen = new Set<string>()
  const deduped: PaperWithAuthors[] = []
  
  for (const paper of papers) {
    const key = paper.id || paper.doi || `${paper.title}-${paper.publication_date}`
    if (!seen.has(key)) {
      seen.add(key)
      deduped.push(paper)
    }
  }
  
  return deduped
}

/**
 * Request-scoped cache wrapper
 */
export function withSearchCache<T>(fn: () => Promise<T>): Promise<T> {
  return searchCacheALS.run(new Map(), fn)
}

/**
 * Enhanced tokenization using natural library with stemming
 */
function enhancedTokenize(text: string): string[] {
  // Handle hyphenated terms and camelCase
  const preprocessed = text
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase -> camel Case
    .replace(/[-_]/g, ' ') // hyphens and underscores to spaces
    .toLowerCase()
  
  const tokens = tokenizer.tokenize(preprocessed) || []
  
  // Use natural's stemming for better term matching
  return tokens
    .filter((token: string) => {
      // Always include long technical terms (likely domain-specific)
      if (token.length > 5) return /^[a-zA-Z]/.test(token)
      
      // For shorter terms, use minimal stop word filtering
      // Let TF-IDF handle significance scoring instead
      return token.length > 2 && /^[a-zA-Z]/.test(token)
    })
    .map((token: string) => PorterStemmer.stem(token)) // Apply stemming
}

/**
 * Unified Search Orchestrator with parallel execution and proper error handling
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
    fastMode = false,
    sources = ['openalex', 'crossref', 'semantic_scholar'],
    semanticWeight = 0.7,
    authorityWeight = 0.5,
    recencyWeight = 0.1,
    timeoutMs = fastMode ? 8000 : 15000,
    concurrencyLimit = fastMode ? 3 : 5
  } = options

  debugLog(`🎯 Unified Search Starting: "${query}"`)
  debugLog(`   📊 Target: ${maxResults} results (min: ${minResults})`)
  debugLog(`   🌍 Local region: ${localRegion || 'none'}`)
  debugLog(`   🚫 Excluded: ${excludePaperIds.length} papers`)
  debugLog(`   ⏱️  Timeout: ${timeoutMs}ms`)

  const limit = pLimit(concurrencyLimit)
  const searchStrategies: string[] = []
  const errors: string[] = []
  let cacheHits = 0
  let vectorIndexEmpty = false

  // Strategy factories for parallel execution
  const hybridSearchStrategy = async (): Promise<{ papers: PaperWithAuthors[], strategy: string, error?: string }> => {
    if (!useHybridSearch) return { papers: [], strategy: 'hybrid' }
    
    const cacheKey = getCacheKey(query, { maxResults, fromYear, semanticWeight, excludePaperIds })
    let hybridPapers = getCachedResult(cacheKey)
    
    if (hybridPapers) {
      debugLog(`✅ Cache hit for hybrid search`)
      cacheHits++
      return { papers: hybridPapers, strategy: 'hybrid' }
    }

    try {
      debugLog(`🧠 Executing hybrid search...`)
      hybridPapers = await withTimeout(
        hybridSearchPapers(query, {
          limit: maxResults * 2,
          excludePaperIds,
          minYear: fromYear,
          semanticWeight
        }),
        timeoutMs,
        []
      )
      
      if (hybridPapers.length > 0) {
        setCachedResult(cacheKey, hybridPapers)
      }
      
      debugLog(`✅ Hybrid search: ${hybridPapers.length} papers`)
      return { papers: hybridPapers, strategy: 'hybrid' }
    } catch (error) {
      const errorMsg = `Hybrid search failed: ${error instanceof Error ? error.message : String(error)}`
      debugLog(`⚠️ ${errorMsg}`)
      
      // Add telemetry for vector search failures
      if (hybridPapers && hybridPapers.length === 0) {
        debugLog('🛑 Vector index empty – possible cold start or RLS')
        vectorIndexEmpty = true
        
        // Emit warning for ops monitoring
        console.warn(`🚨 Vector search returned empty results - possible index issue or cold start. Query: "${query}"`)
        
        return { papers: [], strategy: 'hybrid', error: errorMsg + ' (vector_index_empty)' }
      }
      
      return { papers: [], strategy: 'hybrid', error: errorMsg }
    }
  }

  const academicAPIStrategy = async (): Promise<{ papers: PaperWithAuthors[], strategy: string, error?: string }> => {
    if (!useAcademicAPIs) return { papers: [], strategy: 'academic_apis' }
    
    try {
      debugLog(`🌐 Executing academic API search...`)
      const academicOptions: AggregatedSearchOptions = {
        maxResults: maxResults * 2,
        sources,
        fastMode,
        semanticWeight,
        authorityWeight,
        recencyWeight
      }

      const { papers: rankedPapers } = await withTimeout(
        searchAndIngestPapers(query, academicOptions),
        timeoutMs,
        { papers: [], ingestedIds: [] }
      )
      
      debugLog(`🔍 Academic API search returned ${rankedPapers.length} papers`)
      
      if (rankedPapers.length === 0) {
        debugLog(`⚠️ No papers returned from academic API search`)
        return { papers: [], strategy: 'academic_apis' }
      }

      // Convert RankedPaper to PaperWithAuthors format with deterministic IDs
      const convertedPapers: PaperWithAuthors[] = rankedPapers.map(paper => {
        // Build a deterministic UUID based on DOI when available, otherwise title/author/year.
        const uuidInput = paper.doi && paper.doi.trim() !== ''
          ? paper.doi
          : `${paper.title}|${Array.isArray(paper.authors) && paper.authors.length > 0 ? (typeof paper.authors[0] === 'string' ? paper.authors[0] : (paper.authors[0] as { name: string }).name) : ''}|${paper.year || ''}`

        // DEBUG: Log the exact input being used for ID generation during DISCOVERY
        if (process.env.LOG_LEVEL === 'debug') {
          console.log(`🔍 DISCOVERY ID Generation for "${paper.title}":`)
          console.log(`   DOI: "${paper.doi || 'NONE'}"`)
          console.log(`   UUID Input: "${uuidInput}"`)
          console.log(`   Full Paper Object:`, JSON.stringify({
            title: paper.title,
            doi: paper.doi,
            authors: paper.authors,
            year: paper.year,
            venue: paper.venue
          }, null, 2))
        }

        // Use the canonical_id from ingested paper (this is the database ID)
        // If canonical_id is not available, generate deterministic ID as fallback
        const paperId = paper.canonical_id || generateDeterministicPaperId({
          doi: paper.doi,
          title: paper.title,
          authors: paper.authors,
          year: paper.year
        })
        
        return {
          id: paperId,
          title: paper.title,
          abstract: paper.abstract || '',
          publication_date: paper.year ? `${paper.year}-01-01` : new Date().toISOString(),
          venue: paper.venue || '',
          doi: paper.doi || '',
          url: paper.url || '',
          pdf_url: paper.pdf_url || '', // 🎯 Preserve PDF URL at top level
          metadata: {
            api_source: paper.source,
            relevance_score: paper.relevanceScore,
            combined_score: paper.combinedScore,
            authority_score: paper.authorityScore,
            recency_score: paper.recencyScore,
            canonical_id: paper.canonical_id,
            pdf_url: paper.pdf_url || '' // Also keep in metadata for compatibility
          },
          created_at: new Date().toISOString(),
          authors: paper.authors?.map((author: unknown) => {
            const authorName = typeof author === 'string' ? author : 
                             (typeof author === 'object' && author && 'name' in author ? (author as { name: string }).name : 'Unknown')
            const authorAffiliation = typeof author === 'object' && author && 'affiliation' in author ? 
                                    (author as { affiliation?: string }).affiliation : undefined
            
            return {
              id: generateDeterministicAuthorId({
                name: authorName,
                affiliation: authorAffiliation
              }),
              name: authorName,
              affiliation: authorAffiliation
            }
          }) || [],
          author_names: paper.authors?.map((author: unknown) => 
            typeof author === 'string' ? author : 
            (typeof author === 'object' && author && 'name' in author ? (author as { name: string }).name : 'Unknown')
          ) || []
        }
      })

      debugLog(`✅ Academic APIs: ${convertedPapers.length} papers`)
      return { papers: convertedPapers, strategy: 'academic_apis' }
    } catch (error) {
      const errorMsg = `Academic API search failed: ${error instanceof Error ? error.message : String(error)}`
      debugLog(`⚠️ ${errorMsg}`)
      return { papers: [], strategy: 'academic_apis', error: errorMsg }
    }
  }

  // Execute primary strategies in parallel
  const [hybridResult, academicResult] = await Promise.all([
    limit(hybridSearchStrategy),
    limit(academicAPIStrategy)
  ])

  // Collect results and errors
  let allPapers = dedupePapers([...hybridResult.papers, ...academicResult.papers])
  
  if (hybridResult.papers.length > 0) searchStrategies.push('hybrid')
  if (academicResult.papers.length > 0) searchStrategies.push('academic_apis')
  if (hybridResult.error) errors.push(hybridResult.error)
  if (academicResult.error) errors.push(academicResult.error)

     const hybridResults = hybridResult.papers.length
   const academicResults = academicResult.papers.length
  let keywordResults = 0
  let broaderSearchResults = 0

  // Keyword search fallback if still insufficient results
  if (useKeywordSearch && allPapers.length < minResults) {
    try {
      debugLog(`🔤 Executing enhanced keyword search fallback...`)
      const supabase = await getSB()
      
      // Enhanced keyword search covering title, abstract, and venue
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
        .or(`title.fts.${query},abstract.fts.${query},venue.fts.${query}`)
        .not('id', 'in', `(${[...excludePaperIds, ...allPapers.map(p => p.id)].join(',') || 'null'})`)
        .order('created_at', { ascending: false })
        .limit(maxResults)

      if (!error && keywordPapers && keywordPapers.length > 0) {
        const formattedKeywordPapers: PaperWithAuthors[] = keywordPapers.map(paper => ({
          ...paper,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          authors: paper.authors?.map((pa: any) => pa.author).filter(Boolean) || [],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          author_names: paper.authors?.map((pa: any) => pa.author?.name).filter(Boolean) || []
        }))

        const existingIds = new Set(allPapers.map(p => p.id))
        const newKeywordPapers = formattedKeywordPapers.filter(p => !existingIds.has(p.id))
        
        allPapers = [...allPapers, ...newKeywordPapers]
        keywordResults = newKeywordPapers.length
        searchStrategies.push('keyword')
        debugLog(`✅ Enhanced keyword search: ${newKeywordPapers.length} papers`)
      }
    } catch (error) {
      const errorMsg = `Keyword search failed: ${error instanceof Error ? error.message : String(error)}`
      debugLog(`⚠️ ${errorMsg}`)
      errors.push(errorMsg)
    }
  }

  // Broader search strategy if still insufficient
  if (allPapers.length < minResults) {
    debugLog(`🔄 Executing enhanced broader search strategy...`)
    try {
      const broaderPapers = await performEnhancedBroaderSearch(
        query, 
        maxResults - allPapers.length,
        [...excludePaperIds, ...allPapers.map(p => p.id)],
        { fromYear, semanticWeight, timeoutMs }
      )
      
      allPapers = [...allPapers, ...broaderPapers]
      broaderSearchResults = broaderPapers.length
      if (broaderPapers.length > 0) {
        searchStrategies.push('broader_search')
        debugLog(`✅ Enhanced broader search: ${broaderPapers.length} papers`)
      }
    } catch (error) {
      const errorMsg = `Broader search failed: ${error instanceof Error ? error.message : String(error)}`
      debugLog(`⚠️ ${errorMsg}`)
      errors.push(errorMsg)
    }
  }

  // Regional boosting (reorder results)
  let localPapersCount = 0
  let localRegionBoost = false

  if (localRegion && allPapers.length > 0) {
    debugLog(`🌍 Applying regional boosting for: ${localRegion}`)
    
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
      debugLog(`✅ Regional boost: ${localPapers.length} local papers moved to front`)
    }
  }

  // Final result preparation
  const finalPapers = allPapers.slice(0, maxResults)
  const searchTimeMs = Date.now() - startTime

  debugLog(`🎯 Unified search completed in ${searchTimeMs}ms:`)
  debugLog(`   📊 Total found: ${finalPapers.length}`)
  debugLog(`   🔍 Strategies: ${searchStrategies.join(', ')}`)
  debugLog(`   💾 Cache hits: ${cacheHits}`)
  debugLog(`   ⚠️  Errors: ${errors.length}`)

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
      searchTimeMs,
      errors,
      vectorIndexEmpty
    }
  }
}

/**
 * Enhanced broader search with better tokenization and parallel execution
 */
async function performEnhancedBroaderSearch(
  topic: string,
  remainingSlots: number,
  excludeIds: string[],
  options: { fromYear?: number, semanticWeight?: number, timeoutMs?: number } = {}
): Promise<PaperWithAuthors[]> {
  if (remainingSlots <= 0) return []

  const { fromYear = 2000, semanticWeight = 0.6, timeoutMs = 10000 } = options
  
  // Enhanced tokenization
  const keyTerms = enhancedTokenize(topic)
  
  if (keyTerms.length < 2) return []

  debugLog(`🔍 Enhanced broader search terms: [${keyTerms.join(', ')}]`)
  
  // Create search combinations (limit to 4 to avoid too many calls)
  const searchCombinations: string[] = []
  for (let i = 0; i < keyTerms.length && searchCombinations.length < 4; i++) {
    for (let j = i + 1; j < keyTerms.length && searchCombinations.length < 4; j++) {
      searchCombinations.push(`${keyTerms[i]} ${keyTerms[j]}`)
    }
  }

  // Add single high-value terms if we have few combinations
  if (searchCombinations.length < 3 && keyTerms.length > 0) {
    searchCombinations.push(keyTerms[0])
  }

  const limit = pLimit(3) // Limit concurrent broader searches
  const slotsPerQuery = Math.ceil(remainingSlots / searchCombinations.length)

  // Execute searches in parallel with timeout
  const searchPromises = searchCombinations.map(searchTerm => 
    limit(async () => {
      const cacheKey = getCacheKey(searchTerm, { 
        maxResults: slotsPerQuery, 
        fromYear, 
        semanticWeight, 
        excludePaperIds: excludeIds 
      })
      
      let termResults = getCachedResult(cacheKey)
      
      if (!termResults) {
        try {
          termResults = await withTimeout(
            hybridSearchPapers(searchTerm, {
              limit: slotsPerQuery,
              excludePaperIds: excludeIds,
              minYear: fromYear,
              semanticWeight
            }),
            timeoutMs / 2, // Half timeout for individual searches
            []
          )
          
          if (termResults && termResults.length > 0) {
            setCachedResult(cacheKey, termResults)
          }
        } catch (error) {
          debugLog(`⚠️ Broader search for "${searchTerm}" failed:`, error)
          return { searchTerm, papers: [] }
        }
      }

      return { searchTerm, papers: termResults || [] }
    })
  )

  const results = await Promise.all(searchPromises)
  
  // Combine and dedupe results
  const allResults: PaperWithAuthors[] = []
  const seenIds = new Set([...excludeIds])
  
  for (const { searchTerm, papers } of results) {
    if (papers.length > 0) {
      const newPapers = papers.filter(p => {
        const id = p.id || p.doi || `${p.title}-${p.publication_date}`
        if (seenIds.has(id)) return false
        seenIds.add(id)
        return true
      })
      
      allResults.push(...newPapers.slice(0, remainingSlots - allResults.length))
      debugLog(`   🔍 "${searchTerm}": ${newPapers.length} new papers`)
      
      if (allResults.length >= remainingSlots) break
    }
  }

  return allResults
}

/**
 * Clear the search cache (useful for testing)
 */
export function clearSearchCache(): void {
  const cache = searchCacheALS.getStore()
  if (cache) {
    cache.clear()
  }
}

/**
 * SearchOrchestrator Service Interface
 * 
 * Clean API for unified search operations
 */
export class SearchOrchestrator {
  private constructor() {}

  /**
   * Main search method - unified Library/Hybrid/Academic search
   */
  static async search(params: {
    query: string
    projectId?: string
    maxResults?: number
    includeLibraryOnly?: boolean
  }): Promise<UnifiedSearchResult> {
    const { query, projectId, maxResults = 20, includeLibraryOnly = false } = params

    // Use unifiedSearch as the implementation
    const options: UnifiedSearchOptions = {
      maxResults,
      useAcademicAPIs: !includeLibraryOnly,
      useHybridSearch: true,
      useKeywordSearch: true
    }

    // Ensure per-request cache is active for this call
    return withSearchCache(() => unifiedSearch(query, options))
  }

  /**
   * Library-only search for project context
   */
  static async searchLibrary(params: {
    query: string
    projectId: string
    maxResults?: number
  }): Promise<UnifiedSearchResult> {
    return this.search({
      ...params,
      includeLibraryOnly: true
    })
  }

  /**
   * Get search capabilities info
   */
  static getCapabilities() {
    return {
      sources: ['hybrid', 'academic_apis', 'library'],
      maxResults: 100,
      supportsFiltering: true,
      supportsCaching: true
    }
  }

  /**
   * Expose chunk retrieval via ContextRetrievalService for unified primitives
   */
  static async retrieveChunks(params: { query: string; projectId?: string; k?: number }) {
    const { query, projectId, k = 20 } = params
    return ContextRetrievalService.retrieve({ query, projectId, k })
  }
}

// Default export for convenience
export default SearchOrchestrator 