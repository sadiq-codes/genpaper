import { 
  AcademicPaper, 
  SearchOptions,
  searchOpenAlex,
  searchCrossref,
  searchSemanticScholar,
  searchArxiv,
  searchCore,
  searchPubMedCentral,
  searchEuropePMC,
  enhancePdfUrls
} from './academic-apis'
import pLimit from 'p-limit'
import { normalizeDoiForLookup } from '@/lib/content/html-extractor'
import { PaperSources } from '@/types/simplified'
import { generateQueryRewrites } from '@/lib/search/query-rewrite'
import { semanticRerank, quickRelevanceCheck } from '@/lib/search/semantic-rerank'
import { deduplicatePapers, normalizeTitle } from '@/lib/search/deduplication'
import { 
  isSourceAvailable, 
  recordSuccess, 
  recordFailure
} from '@/lib/search/circuit-breaker'
import { getCached, setCached } from '@/lib/search/source-cache'

// Enhanced paper type with ranking metadata
export interface RankedPaper extends AcademicPaper {
  relevanceScore: number
  combinedScore: number
  bm25Score?: number
  authorityScore?: number
  recencyScore?: number
  preprint_id?: string // For linking arXiv preprints to journal versions
  siblings?: string[] // Related papers (e.g., preprint and journal version)
}

// Default weights for scoring
export const DEFAULT_WEIGHTS = {
  semanticWeight: 1.0,
  authorityWeight: 0.5,
  recencyWeight: 0.1
} as const

// Search configuration
export interface AggregatedSearchOptions extends SearchOptions {
  maxResults?: number
  includePreprints?: boolean
  semanticWeight?: number
  authorityWeight?: number
  recencyWeight?: number
  sources?: PaperSources
  // discipline is inherited from SearchOptions
  
  // Fast mode options for two-phase search
  /** Skip LLM-based query rewrites (use original query only) */
  skipQueryRewrites?: boolean
  /** Skip semantic re-ranking (return BM25-ranked results only) */
  skipSemanticRerank?: boolean
}

// ---------- Enhanced BM25 utilities with proper tf-idf calculation ----------

interface BM25Env {
  idf: Map<string, number>
  avgDocLen: number
  k1: number
  b: number
  queryTerms: string[]
}

function buildBM25Environment(query: string, papers: AcademicPaper[]): BM25Env {
  const k1 = 1.2
  const b = 0.75

  const queryTerms = query.toLowerCase().split(/\s+/)
  const N = papers.length

  // Compute document frequencies for each query term in one sweep
  const dfCounts = new Map<string, number>()
  for (const term of queryTerms) {
    dfCounts.set(term, 0)
  }

  let totalDocLength = 0
  for (const paper of papers) {
    const tokens = `${paper.title} ${paper.abstract}`.toLowerCase().split(/\s+/)
    totalDocLength += tokens.length
    
    // Track which terms we've seen in this document to avoid double-counting
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
    // Avoid division by zero; if df==0 we treat idf as 0 (term not present anywhere)
    const idfVal = df === 0 ? 0 : Math.log((N - df + 0.5) / (df + 0.5))
    idf.set(term, idfVal)
  }

  return {
    idf,
    avgDocLen: totalDocLength / Math.max(1, N),
    k1,
    b,
    queryTerms
  }
}

function calculateBM25Score(env: BM25Env, title: string, abstract: string): number {
  const { idf, avgDocLen, k1, b, queryTerms } = env

  const titleTerms = title.toLowerCase().split(/\s+/)
  const abstractTerms = abstract.toLowerCase().split(/\s+/)
  const docLength = titleTerms.length + abstractTerms.length

  let score = 0
  for (const term of queryTerms) {
    const idfVal = idf.get(term) || 0
    if (idfVal === 0) continue // term never appears in corpus

    // Calculate actual term frequency (not just presence)
    const tf = titleTerms.filter(t => t === term).length * 2 + // Title terms weighted 2x
               abstractTerms.filter(t => t === term).length

    if (tf === 0) continue

    const numerator = tf * (k1 + 1)
    const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLen))
    score += idfVal * (numerator / denominator)
  }

  return score
}

// Calculate authority score based on citations  
function calculateAuthorityScore(citationCount: number): number {
  return Math.log10(citationCount + 1)
}

// Calculate recency score with BCE edge-case protection
// Returns a 0-1 normalized score based on publication year
// The score is adjusted by recencyWeight during ranking, so this just provides
// a relative measure of how recent the paper is
function calculateRecencyScore(year: number): number {
  // Guard against negative years producing positives in BCE edge-case
  if (year < 1900) {
    return 0
  }
  
  const currentYear = new Date().getFullYear()
  const age = currentYear - year
  
  // Exponential decay: papers lose relevance over time
  // This produces scores roughly:
  // - Current year: ~1.0
  // - 5 years ago: ~0.6
  // - 10 years ago: ~0.37
  // - 20 years ago: ~0.14
  // - 50 years ago: ~0.007
  // The recencyWeight parameter controls how much this score matters in final ranking
  return Math.exp(-0.1 * age)
}

// deduplicatePapers and normalizeTitle are now imported from @/lib/search/deduplication

// Rank papers using corrected scoring (no double authority weighting)
function rankPapers(
  papers: AcademicPaper[], 
  query: string, 
  options: AggregatedSearchOptions = {}
): RankedPaper[] {
  const {
    semanticWeight = DEFAULT_WEIGHTS.semanticWeight,
    authorityWeight = DEFAULT_WEIGHTS.authorityWeight,
    recencyWeight = DEFAULT_WEIGHTS.recencyWeight
  } = options
  
  const bm25Env = buildBM25Environment(query, papers)

  return papers.map(paper => {
    const bm25Score = calculateBM25Score(bm25Env, paper.title, paper.abstract)
    const authorityScore = calculateAuthorityScore(paper.citationCount)
    const recencyScore = calculateRecencyScore(paper.year)
    
    // Fixed: Apply authority weight only once, not double
    const combinedScore = 
      bm25Score * semanticWeight +
      authorityScore * authorityWeight +
      recencyScore * recencyWeight
    
    return {
      ...paper,
      relevanceScore: bm25Score,
      combinedScore,
      bm25Score,
      authorityScore,
      recencyScore
    } as RankedPaper
  }).sort((a, b) => b.combinedScore - a.combinedScore)
}

// Timeout wrapper with AbortController for proper cancellation
async function withAbortableTimeout<T>(
  promiseFactory: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort()
  }, timeoutMs)
  
  try {
    return await promiseFactory(controller.signal)
  } finally {
    clearTimeout(timeoutId)
  }
}

// Parallel search across all APIs with smart source prioritization and proper timeout handling
export async function parallelSearch(
  query: string, 
  options: AggregatedSearchOptions = {}
): Promise<RankedPaper[]> {
  const {
    limit = 50,
    maxResults = 25,
    includePreprints = true,
    // All sources active by default, prioritized by OA/full-text availability
    sources = ['europe_pmc', 'pubmed_central', 'openalex', 'core', 'arxiv', 'crossref', 'semantic_scholar'],
    fastMode = false,
    discipline,
    skipQueryRewrites = false,
    skipSemanticRerank = false
  } = options
  
  // Filter to only supported sources to prevent pubmed config mismatch
  // Added pubmed_central and europe_pmc for better open access coverage
  const SUPPORTED_SOURCES = ['openalex', 'crossref', 'semantic_scholar', 'arxiv', 'core', 'pubmed_central', 'europe_pmc'] as const
  type SupportedSource = typeof SUPPORTED_SOURCES[number]
  const requestedSources = sources.filter((s): s is SupportedSource => SUPPORTED_SOURCES.includes(s as SupportedSource))
  
  // Ensure we have at least one source to search
  if (requestedSources.length === 0) {
    console.warn('No supported sources provided, falling back to all default sources')
    requestedSources.push(...SUPPORTED_SOURCES)
  }
  
  // **SMART PRIORITIZATION**: Order sources by speed/reliability and PDF coverage
  // Preprint servers (arxiv) and open access (europe_pmc, pubmed_central, core) prioritized for full-text access
  const sourcesByPriority: SupportedSource[] = []
  const priorityOrder: SupportedSource[] = ['europe_pmc', 'pubmed_central', 'openalex', 'core', 'arxiv', 'crossref', 'semantic_scholar']
  
  // Add requested sources in priority order
  for (const source of priorityOrder) {
    if (requestedSources.includes(source)) {
      sourcesByPriority.push(source)
    }
  }
  
  // Generate embedding-based query rewrites (async) with discipline context
  // Skip query rewrites in fast mode for immediate results
  let expandedQueries: string[]
  if (skipQueryRewrites) {
    expandedQueries = [query.trim()]
    console.log(`⚡ Fast mode: Skipping query rewrites, using original query only`)
  } else {
    expandedQueries = await generateQueryRewrites(query, 3, discipline)
  }
  const primaryQuery = expandedQueries[0]
  
  console.log(`Starting ${skipQueryRewrites ? 'fast' : 'multi-query'} parallel search`)
  if (!skipQueryRewrites) {
    console.log(`Query rewrites (${expandedQueries.length}): ${expandedQueries.map((q, i) => `\n  ${i + 1}. "${q}"`).join('')}`)
  }
  console.log(`Source priority order: ${sourcesByPriority.join(' → ')}`)
  console.log(`Fast mode: ${fastMode ? 'ON' : 'OFF'}, Skip rewrites: ${skipQueryRewrites}, Skip semantic: ${skipSemanticRerank}`)
  if (discipline) {
    console.log(`Discipline filter: ${discipline}`)
  }
  
  const allPapers: AcademicPaper[] = []
  // Increased from 250 to 400 to support multi-query search with more raw results
  const TARGET_PAPERS = Math.min(maxResults * 4, 400)
  
  console.log(`Parallel search target paper threshold set to ${TARGET_PAPERS}`)
  
  // **MULTI-QUERY PARALLEL SEARCH**: query each source with all query rewrites concurrently
  // This maximizes paper diversity by searching multiple phrasings of the same topic
  async function querySourceWithQuery(source: SupportedSource, searchQuery: string): Promise<AcademicPaper[]> {
    // Per-source limit increased from 25 to 50 to support higher search volumes for literature reviews
    const perSourceLimit = Math.min(limit, 50)
    const searchOptions = { ...options, limit: perSourceLimit, fastMode, discipline }
    const sourceTimeout = fastMode ? 10000 : 15000 // 10s vs 15s timeout

    // Circuit breaker check - skip unhealthy sources
    if (!isSourceAvailable(source)) {
      return []
    }

    // Check cache first
    const cacheKey = { ...searchOptions, includePreprints }
    const cached = getCached<AcademicPaper[]>(source, searchQuery, cacheKey)
    if (cached) {
      return cached
    }

    try {
      const results = await withAbortableTimeout(async (_signal) => {
        void _signal // reference to avoid unused variable lint error
        switch (source) {
          case 'openalex':
            return await searchOpenAlex(searchQuery, searchOptions)
          case 'crossref':
            return await searchCrossref(searchQuery, searchOptions)
          case 'semantic_scholar':
            return await searchSemanticScholar(searchQuery, searchOptions)
          case 'arxiv':
            return includePreprints ? await searchArxiv(searchQuery, searchOptions) : []
          case 'core':
            return await searchCore(searchQuery, searchOptions)
          case 'pubmed_central':
            return await searchPubMedCentral(searchQuery, searchOptions)
          case 'europe_pmc':
            return await searchEuropePMC(searchQuery, searchOptions)
          default:
            return []
        }
      }, sourceTimeout)
      
      // Record success and cache results
      recordSuccess(source)
      setCached(source, searchQuery, results, cacheKey)
      
      return results
      
    } catch (error) {
      // Record failure for circuit breaker
      recordFailure(source, error instanceof Error ? error : new Error(String(error)))
      return [] // Swallow individual failure but continue overall search
    }
  }

  // Phased discovery cap:
  // - Run high-yield sources first.
  // - Keep per-phase call volume bounded.
  // - Stop early once we have enough unique candidates.
  const phaseCutoff = Math.min(4, sourcesByPriority.length)
  const sourcePhases: SupportedSource[][] = [
    sourcesByPriority.slice(0, phaseCutoff),
    sourcesByPriority.slice(phaseCutoff)
  ].filter(phase => phase.length > 0)

  const SEARCH_TASK_CONCURRENCY = fastMode ? 4 : 6
  const MAX_TASKS_PER_PHASE = fastMode ? 8 : 12
  const sourceStats: Record<string, number> = {}

  for (let phaseIndex = 0; phaseIndex < sourcePhases.length; phaseIndex++) {
    const phaseSources = sourcePhases[phaseIndex]
    const phaseTasks: Array<{ source: SupportedSource; query: string }> = []

    for (const source of phaseSources) {
      if (!isSourceAvailable(source)) {
        console.log(`⚡ Skipping ${source} (circuit open)`)
        continue
      }
      for (const searchQuery of expandedQueries) {
        phaseTasks.push({ source, query: searchQuery })
      }
    }

    if (phaseTasks.length === 0) {
      continue
    }

    const cappedTasks = phaseTasks.slice(0, MAX_TASKS_PER_PHASE)
    console.log(
      `🔍 Discovery phase ${phaseIndex + 1}/${sourcePhases.length}: ` +
      `${cappedTasks.length}/${phaseTasks.length} source-query calls (cap ${MAX_TASKS_PER_PHASE})`
    )

    const runTask = pLimit(SEARCH_TASK_CONCURRENCY)
    const settledResults = await Promise.allSettled(
      cappedTasks.map(task => runTask(() => querySourceWithQuery(task.source, task.query)))
    )

    for (let i = 0; i < settledResults.length; i++) {
      const res = settledResults[i]
      const task = cappedTasks[i]
      if (res.status === 'fulfilled' && res.value.length > 0) {
        allPapers.push(...res.value)
        sourceStats[task.source] = (sourceStats[task.source] || 0) + res.value.length
      }
    }

    const uniqueSoFar = deduplicatePapers(allPapers).length
    console.log(`📊 Discovery phase ${phaseIndex + 1} complete: ${uniqueSoFar} unique candidates so far`)
    if (uniqueSoFar >= TARGET_PAPERS) {
      console.log(`✅ Discovery cap reached after phase ${phaseIndex + 1}; skipping later phases`)
      break
    }
  }

  // Log per-source results
  for (const [source, count] of Object.entries(sourceStats)) {
    console.log(`📚 ${source}: ${count} papers (across ${expandedQueries.length} queries)`)
  }

  console.log(`✅ Multi-query search completed: ${allPapers.length} raw papers collected`)
  
  console.log(`📊 Raw results: ${allPapers.length} papers from ${sourcesByPriority.length} sources`)
  
  // Deduplicate
  const deduplicated = deduplicatePapers(allPapers)
  console.log(`🔄 After deduplication: ${deduplicated.length} papers`)
  
  // Quick pre-filter: remove obviously irrelevant papers before expensive embedding
  // Pass discipline to filter out papers from wrong academic fields
  const preFiltered = deduplicated.filter(paper => 
    quickRelevanceCheck(primaryQuery, paper.title, paper.abstract, discipline)
  )
  console.log(`🔍 After quick relevance filter: ${preFiltered.length} papers`)
  
  // Trust the filter - don't fall back to unfiltered papers
  // If filter is too aggressive, it's better to return fewer relevant papers
  // than many irrelevant ones
  const papersToRank = preFiltered
  
  if (preFiltered.length === 0 && deduplicated.length > 0) {
    console.log(`⚠️ Quick filter removed all ${deduplicated.length} papers - query may be too specific or results are off-topic`)
  }
  
  // If we have enough papers after pre-filtering, use semantic re-ranking
  // This provides much better relevance than BM25 alone
  // Skip semantic reranking in fast mode for immediate results
  if (papersToRank.length >= 3 && !skipSemanticRerank) {
    try {
      // Prepare papers for semantic re-ranking
      const papersForRerank = papersToRank.map(p => ({
        ...p,
        id: p.canonical_id // semantic-rerank expects 'id' field
      }))
      
      // Re-rank using embeddings
      const reranked = await semanticRerank(primaryQuery, papersForRerank, {
        minScore: 0.35, // Minimum semantic similarity threshold (raised from 0.20 to filter weak matches)
        titleWeight: 0.65, // Slightly favor title matches
        maxResults: maxResults,
        boostExactMatch: true
      })
      
      // Convert back to RankedPaper format with combined scores
      const rankedResults: RankedPaper[] = reranked.map((paper, _index) => {
        const authorityScore = calculateAuthorityScore(paper.citationCount)
        const recencyScore = calculateRecencyScore(paper.year)
        
        // Combined score: semantic similarity (primary) + authority + recency
        const combinedScore = 
          paper.semanticScore * 1.0 + // Semantic is primary signal
          authorityScore * 0.15 +     // Small citation boost
          recencyScore * 0.05         // Tiny recency boost
        
        return {
          ...paper,
          relevanceScore: paper.semanticScore,
          combinedScore,
          bm25Score: 0, // Not using BM25 when semantic is available
          authorityScore,
          recencyScore
        } as RankedPaper
      })
      
      console.log(`🎯 Final results after semantic ranking: ${rankedResults.length} papers`)
      return rankedResults
      
    } catch (error) {
      console.warn('Semantic re-ranking failed, falling back to BM25:', error)
      // Fall through to BM25 ranking
    }
  } else if (skipSemanticRerank) {
    console.log(`⚡ Fast mode: Skipping semantic re-ranking`)
  }
  
  // BM25 ranking on filtered papers only - no fallback to unfiltered
  // If papersToRank is empty, return empty (don't bypass the relevance filter)
  if (papersToRank.length === 0) {
    console.log(`🎯 Final results: 0 papers (all filtered out as irrelevant)`)
    return []
  }
  
  const ranked = rankPapers(papersToRank, primaryQuery, options)
  
  // Return top results
  const topResults = ranked.slice(0, maxResults)
  console.log(`🎯 Final results: ${topResults.length} papers`)
  
  return topResults
}



function dedupeByIdentity(papers: RankedPaper[]): RankedPaper[] {
  const seen = new Set<string>()
  const unique: RankedPaper[] = []

  for (const paper of papers) {
    const key = normalizeDoiForLookup(paper.doi || undefined) || normalizeTitle(paper.title)
    if (seen.has(key)) {
      console.log(`📚 Skipping duplicate paper: ${paper.title}`)
      continue
    }
    seen.add(key)
    unique.push(paper)
  }

  return unique
}

/**
 * Search academic APIs and return ranked, de-duplicated paper metadata only.
 * No database writes, no PDF download, and no chunking are performed here.
 */
export async function searchAcademicPapers(
  query: string,
  options: AggregatedSearchOptions = {}
): Promise<RankedPaper[]> {
  console.log(`Starting academic metadata search for: "${query}"`)
  
  const rankedPapers = await parallelSearch(query, options)
  if (rankedPapers.length === 0) {
    console.log('No papers found for query')
    return []
  }
  
  console.log('🔍 Enhancing PDF URLs using multiple strategies...')
  const enhancedPapers = (await enhancePdfUrls(rankedPapers)) as RankedPaper[]
  const uniquePapers = dedupeByIdentity(enhancedPapers)
  
  console.log(`📊 Deduplicated ${enhancedPapers.length} papers to ${uniquePapers.length} unique papers`)
  return uniquePapers
}

// Smart batch delay with exponential backoff
async function smartDelay(previousHadRateLimit: boolean, iteration: number): Promise<void> {
  if (previousHadRateLimit) {
    // Exponential backoff if we hit rate limits
    const delay = Math.min(1000 * Math.pow(2, iteration), 10000) // Cap at 10s
    await new Promise(resolve => setTimeout(resolve, delay))
  } else {
    // Quick delay for normal operation
    await new Promise(resolve => setTimeout(resolve, 200))
  }
}

// Batch metadata search for multiple queries with smart delays
export async function batchSearchAcademicPapers(
  queries: string[],
  options: AggregatedSearchOptions = {}
): Promise<Array<{ query: string, papers: RankedPaper[] }>> {
  console.log(`Starting batch search for ${queries.length} queries`)
  
  const results: Array<{ query: string, papers: RankedPaper[] }> = []
  let previousHadRateLimit = false
  
  for (let i = 0; i < queries.length; i++) {
    const query = queries[i]
    
    try {
      const papers = await searchAcademicPapers(query, options)
      results.push({ query, papers })
      
      // Reset rate limit flag on success
      previousHadRateLimit = false
      
      // Smart delay before next query
      if (i < queries.length - 1) {
        await smartDelay(previousHadRateLimit, i)
      }
    } catch (error) {
      console.error(`Batch search failed for query "${query}":`, error)
      
      // Check if it was a rate limit error
      const errorMessage = error instanceof Error ? error.message.toLowerCase() : ''
      previousHadRateLimit = errorMessage.includes('rate limit') || errorMessage.includes('429')
      
      results.push({ query, papers: [] })
      
      // Longer delay if we hit rate limits
      if (i < queries.length - 1) {
        await smartDelay(previousHadRateLimit, i)
      }
    }
  }
  
  return results
}

export interface SearchConfig {
  sources?: PaperSources
  maxResults?: number
  includePreprints?: boolean
  fromYear?: number
  toYear?: number
  openAccessOnly?: boolean
  fastMode?: boolean // Add fast mode option
} 