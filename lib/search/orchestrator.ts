import { hybridSearchPapers } from '@/lib/db/papers'
import { parallelSearch } from '@/lib/services/paper-aggregation'
import type { PaperWithAuthors, PaperSource } from '@/types/simplified'
import type { AggregatedSearchOptions } from '@/lib/services/paper-aggregation'
import { getSB } from '@/lib/supabase/server'
import { AsyncLocalStorage } from 'node:async_hooks'
import pLimit from 'p-limit'
import { WordTokenizer, PorterStemmer } from 'natural'
import { generateDeterministicAuthorId } from '@/lib/utils/deterministic-id'
import { generatePaperUUID } from '@/lib/db/papers'
import { adapters as defaultAdapters } from '@/lib/services/academic-apis'
import type { SourceAdapter, AcademicPaper, SearchOptions } from '@/contracts/search-sources'
import QuickLRU from 'quick-lru'
import { deduplicate } from '@/lib/utils/paper-id'

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
  forceIngest?: boolean
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

function getCachedResult(key: string): PaperWithAuthors[] | null {
  const cache = searchCacheALS.getStore()
  if (!cache) return null
  
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
  if (!cache) return
  
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
 * Extra options on top of the per-adapter SearchOptions contract
 */
export interface OrchestratorOptions extends SearchOptions {
  /** Target total papers before early-exit (default 60) */
  desired?: number
  /** Max parallel adapter calls */
  concurrency?: number
  /** Provide your own list of adapters – defaults to academic-apis.ts exports */
  adapters?: readonly SourceAdapter[]
  /** Disable specific adapters by id – also honoured via env SEARCH__DISABLE */
  disabled?: string[]
}

/** In-memory shared LRU to avoid redundant adapter hits within short window */
const lru = new QuickLRU<string, AcademicPaper[]>({ maxSize: 3000, ttl: 60_000 })

function logAdapter(id: string, msg: string, extra?: object) {
  // simple structured log – downstream can parse as logfmt
  const payload = { src: id, ...extra }
  console.log(`[adapter:${id}] ${msg}`, Object.keys(payload).length ? payload : '')
}

function buildCacheKey(id: string, q: string, opts: SearchOptions) {
  return `${id}|${q.toLowerCase()}|${JSON.stringify({ ...opts, limit: undefined })}`
}

// Harmonic mean score of citations and freshness
function paperScore(p: AcademicPaper): number {
  const citeZ = Math.log1p(p.citationCount || 0)
  const year = p.year || 0
  const yearZ = 1 + Math.max(0, year - 2015) // boost last 10 years (0-10)
  return citeZ && yearZ ? (2 * citeZ * yearZ) / (citeZ + yearZ) : citeZ + yearZ
}

export async function unifiedSearch(
  query: string,
  options: OrchestratorOptions = {}
): Promise<AcademicPaper[]> {
  const {
    desired = 60,
    concurrency = 3,
    adapters = defaultAdapters,
    disabled = []
  } = options

  const disabledSet = new Set(
    [
      ...disabled,
      ...(process.env.SEARCH__DISABLE?.split(',').map((s) => s.trim()) || [])
    ].filter(Boolean)
  )

  // Filter + reliability order (high → medium → low)
  const ordered = adapters
    .filter((a) => !disabledSet.has(a.id))
    .sort((a, b) => {
      const relRank = (r: string) => (r === 'high' ? 0 : r === 'medium' ? 1 : 2)
      const diff = relRank(a.reliability) - relRank(b.reliability)
      if (diff !== 0) return diff
      return b.rateLimitRps - a.rateLimitRps // faster first if reliability equal
    })

  const limit = pLimit(concurrency)
  const collected: AcademicPaper[] = []
  const seenAdapters: string[] = []

  for (const adapter of ordered) {
    if (collected.length >= desired) break // early-exit

    seenAdapters.push(adapter.id)

    const cachedKey = buildCacheKey(adapter.id, query, options)
    if (lru.has(cachedKey)) {
      const hit = lru.get(cachedKey) as AcademicPaper[]
      logAdapter(adapter.id, 'cache hit', { count: hit.length })
      collected.push(...hit)
      continue
    }

    try {
      const papers = await limit(() => adapter.search(query, { ...options, limit: desired }))
      logAdapter(adapter.id, 'fetched', { count: papers.length })
      lru.set(cachedKey, papers)
      collected.push(...papers)
    } catch (err) {
      logAdapter(adapter.id, 'error', { err: err instanceof Error ? err.message : err })
    }
  }

  const deduped = deduplicate(collected)
  deduped.sort((a, b) => paperScore(b) - paperScore(a))
  const top = deduped.slice(0, desired)
  console.log(`[orchestrator] query="${query}" adapters=[${seenAdapters.join(',')}] result=${top.length}`)
  return top
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