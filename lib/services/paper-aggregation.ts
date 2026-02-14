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
  enhancePdfUrls,
  getPaperReferences
} from './academic-apis'
import pLimit from 'p-limit'
import { checkPaperExists, createPaperMetadata } from '@/lib/db/papers'
import { createChunksForPaper } from '@/lib/content/ingestion'
import { getOrExtractFullText } from '@/lib/services/pdf-processor'
import { tryHtmlFallbackFromDoi, tryEuropePmcFullText, normalizeDoiForLookup } from '@/lib/content/html-extractor'
import type { PaperDTO } from '@/lib/schemas/paper'
import { PaperSources } from '@/types/simplified'
import { getSB } from '@/lib/supabase/server'

import { createClient as createSB } from '@/lib/supabase/client'
import { generateQueryRewrites } from '@/lib/search/query-rewrite'
import { semanticRerank, quickRelevanceCheck } from '@/lib/search/semantic-rerank'
import { deduplicatePapers, normalizeTitle } from '@/lib/search/deduplication'
import { 
  isSourceAvailable, 
  recordSuccess, 
  recordFailure
} from '@/lib/search/circuit-breaker'
import { getCached, setCached } from '@/lib/search/source-cache'
import { getServiceClient } from '@/lib/supabase/service'
import { extractPaper, saveExtraction, hasExtraction } from '@/lib/extraction'

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

type PdfFailureType =
  | 'paywall-or-landing'
  | 'timeout'
  | 'http-4xx'
  | 'http-5xx'
  | 'invalid-pdf'
  | 'too-large'
  | 'network'
  | 'unknown'

function classifyPdfFailure(message: string): PdfFailureType {
  const msg = message.toLowerCase()
  if (msg.includes('html page') || msg.includes('landing page') || msg.includes('paywall') || msg.includes('forbidden')) {
    return 'paywall-or-landing'
  }
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('abort')) {
    return 'timeout'
  }
  if (msg.includes('http 4') || msg.includes('status 4')) {
    return 'http-4xx'
  }
  if (msg.includes('http 5') || msg.includes('status 5')) {
    return 'http-5xx'
  }
  if (msg.includes('invalid pdf')) {
    return 'invalid-pdf'
  }
  if (msg.includes('too large')) {
    return 'too-large'
  }
  if (msg.includes('socket') || msg.includes('fetch failed') || msg.includes('econnreset') || msg.includes('network')) {
    return 'network'
  }
  return 'unknown'
}

function shouldAttemptDoiRecovery(failureType: PdfFailureType): boolean {
  // DOI recovery is most effective for access/URL-shape failures.
  // For timeouts/network faults, retrying through DOI adds load without improving odds.
  return failureType === 'paywall-or-landing' || failureType === 'http-4xx'
}

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



// Convert AcademicPaper to PaperDTO for ingestion with proper guards
function convertToPaperDTO(paper: RankedPaper, searchQuery: string): PaperDTO {
  // Normalize impact score to 0-1 range with guard against exceeding 1.0
  const rawScore = paper.combinedScore || 0
  const _normalizedImpactScore = rawScore > 0 ? 
    Math.min(0.999, 1 - 1 / (rawScore + 1)) : 0 // Guard against floating point precision issues
  const normalizedDoi = normalizeDoiForLookup(paper.doi || undefined)

  return {
    title: paper.title,
    abstract: paper.abstract || undefined,
    publication_date: paper.year ? `${paper.year}-01-01` : undefined,
    venue: paper.venue || undefined,
    doi: normalizedDoi || undefined,
    pdf_url: paper.pdf_url || undefined,
    metadata: {
      search_query: searchQuery,
      found_at: new Date().toISOString(),
      relevance_score: paper.relevanceScore,
      combined_score: paper.combinedScore,
      authority_score: paper.authorityScore,
      recency_score: paper.recencyScore,
      bm25_score: paper.bm25Score,
      canonical_id: paper.canonical_id,
      api_source: paper.source,
      preprint_id: paper.preprint_id,
      siblings: paper.siblings
    },
    source: `academic_search_${paper.source}`,
    citation_count: paper.citationCount,
    authors: (paper.authors && paper.authors.length > 0) ? paper.authors : [],
    // Additional bibliographic fields for complete citations
    volume: paper.volume || undefined,
    issue: paper.issue || undefined,
    pages: paper.pages || undefined,
    publisher: paper.publisher || undefined,
    // Extended metadata
    paper_type: paper.paper_type || undefined,
    keywords: paper.keywords || undefined,
    fields_of_study: paper.fields_of_study || undefined,
    tldr: paper.tldr || undefined,
    is_open_access: paper.is_open_access,
    open_access_status: paper.open_access_status || undefined,
    license: paper.license || undefined,
    influential_citation_count: paper.influential_citation_count || undefined,
    references_count: paper.references_count || undefined,
    is_retracted: paper.is_retracted || undefined,
    external_ids: paper.external_ids || undefined,
    language: paper.language || undefined,
  }
}

// Main function to search and ingest papers
export async function searchAndIngestPapers(
  query: string,
  options: AggregatedSearchOptions = {}
): Promise<{ papers: RankedPaper[], ingestedIds: string[] }> {
  console.log(`Starting academic search and ingestion for: "${query}"`)
  
  // Perform parallel search
  const rankedPapers = await parallelSearch(query, options)
  
  if (rankedPapers.length === 0) {
    console.log('No papers found for query')
    return { papers: [], ingestedIds: [] }
  }
  
  // Enhance with PDF URLs using comprehensive strategies
  console.log(`🔍 Enhancing PDF URLs using multiple strategies...`)
  const enhancedPapers = (await enhancePdfUrls(rankedPapers)) as RankedPaper[]
  
  // Convert to PaperDTO format and ingest with chunks
  const ingestedIds: string[] = []
  const ingestedPapers: RankedPaper[] = []
  const processedPapers = new Set<string>() // Track processed papers to avoid duplicates
  
  // Filter out any duplicate papers before processing
  const uniquePapers = enhancedPapers.filter(paper => {
    const key = normalizeDoiForLookup(paper.doi || undefined) || paper.title.toLowerCase().trim()
    if (processedPapers.has(key)) {
      console.log(`📚 Skipping duplicate paper: ${paper.title}`)
      return false
    }
    processedPapers.add(key)
    return true
  })
  
  console.log(`📊 Deduplicated ${enhancedPapers.length} papers to ${uniquePapers.length} unique papers`)
  
  // Process PDFs with continuous concurrency using p-limit
  // This avoids batch synchronization where slowest paper in batch holds up the next batch
  // GROBID has 10 internal engines; we use 8 concurrent slots to leave buffer
  const PDF_CONCURRENCY = 8
  const pdfLimit = pLimit(PDF_CONCURRENCY)
  const pdfProcessingStartTime = Date.now()
  
  console.log(`📄 Processing ${uniquePapers.length} papers with ${PDF_CONCURRENCY} concurrent slots`)
  
  // Track progress for logging
  let completedCount = 0
  const totalCount = uniquePapers.length
  
  // Process all papers with continuous concurrency (no batch synchronization)
  const allResults = await Promise.allSettled(
    uniquePapers.map(paper => 
      pdfLimit(async () => {
        const result = await processPaperWithPdf(paper, query)
        completedCount++
        // Log progress every 5 papers or at completion
        if (completedCount % 5 === 0 || completedCount === totalCount) {
          const elapsed = Date.now() - pdfProcessingStartTime
          const avgPerPaper = Math.round(elapsed / completedCount)
          console.log(`📄 Progress: ${completedCount}/${totalCount} papers (${avgPerPaper}ms avg)`)
        }
        return result
      })
    )
  )
  
  // Collect successful results
  for (const result of allResults) {
    if (result.status === 'fulfilled') {
      ingestedIds.push(result.value.paperId)
      ingestedPapers.push(result.value.paper)
    } else {
      console.warn('Paper processing failed:', result.reason)
    }
  }
  
  const totalPdfProcessingTime = Date.now() - pdfProcessingStartTime
  console.log(`📊 [METRICS] PDF processing complete: ${uniquePapers.length} papers in ${totalPdfProcessingTime}ms (avg: ${Math.round(totalPdfProcessingTime / uniquePapers.length)}ms/paper)`)
  
  return { papers: ingestedPapers, ingestedIds }
}

// In-memory lock to prevent concurrent processing of the same paper
// Key: DOI or normalized title, Value: Promise that resolves when processing completes
const paperProcessingLocks = new Map<string, Promise<{ paperId: string; paper: RankedPaper }>>()

function getPaperLockKey(paper: RankedPaper): string {
  return normalizeDoiForLookup(paper.doi || undefined) || normalizeTitle(paper.title)
}

// Extract paper processing logic into separate function for parallel execution
async function processPaperWithPdf(paper: RankedPaper, searchQuery: string = ''): Promise<{ paperId: string; paper: RankedPaper }> {
    const lockKey = getPaperLockKey(paper)
    
    // Check if this paper is already being processed
    const existingLock = paperProcessingLocks.get(lockKey)
    if (existingLock) {
      console.log(`⏳ Paper already being processed, waiting: ${paper.title.slice(0, 50)}...`)
      return existingLock
    }
    
    // Create a new lock for this paper
    const processingPromise = (async () => {
      try {
        return await processPaperWithPdfInternal(paper, searchQuery)
      } finally {
        // Clean up lock after processing completes
        paperProcessingLocks.delete(lockKey)
      }
    })()
    
    paperProcessingLocks.set(lockKey, processingPromise)
    return processingPromise
}

// Internal implementation of paper processing
async function processPaperWithPdfInternal(paper: RankedPaper, searchQuery: string = ''): Promise<{ paperId: string; paper: RankedPaper }> {
    const paperDTO = convertToPaperDTO(paper, searchQuery)
    const normalizedDoi = normalizeDoiForLookup(paperDTO.doi || undefined) || undefined
    if (normalizedDoi && paperDTO.doi !== normalizedDoi) {
      paperDTO.doi = normalizedDoi
    }
    
    // Step 1: Ensure paper exists in DB first (get actual paperId)
    const { exists, paperId: existingId } = await checkPaperExists(paperDTO.doi, paperDTO.title)
    let paperId: string
    
    if (exists && existingId) {
      paperId = existingId
      console.log(`📚 Paper already exists: ${paperId}`)
    } else {
      paperId = await createPaperMetadata(paperDTO)
      console.log(`📚 Created new paper: ${paperId}`)
    }
    
    // Step 2: Check if paper already has full-text content (pdf_content field)
    // This is more reliable than counting chunks - directly checks if we have extracted text
    const supabase = await getSB()
    const { data: paperRecord } = await supabase
      .from('papers')
      .select('pdf_content, content_source')
      .eq('id', paperId)
      .single()
    
    const hasFullText = paperRecord?.pdf_content && paperRecord.pdf_content.length > 500
    
    if (hasFullText) {
      // Paper has full-text content already (from PDF or HTML)
      // But verify chunks exist — pdf_content can exist without chunks if a previous run
      // failed mid-way or chunks were lost (Qdrant reindex, migration, etc.)
      const serviceClient = getServiceClient()
      const { count: chunkCount } = await serviceClient
        .from('paper_chunks')
        .select('*', { count: 'exact', head: true })
        .eq('paper_id', paperId)

      if (chunkCount && chunkCount > 0) {
        console.log(`📚 Full-text + ${chunkCount} chunks exist (${paperRecord.pdf_content.length} chars, source: ${paperRecord.content_source}), skipping: ${paperDTO.title}`)
      } else {
        // Has content but no chunks — re-chunk from existing pdf_content
        console.warn(`⚠️ Full-text exists but 0 chunks for ${paperId}, re-chunking...`)
        const rechunked = await createChunksForPaper(paperId, paperRecord.pdf_content)
        console.log(`📚 Re-chunked existing content: ${rechunked} chunks for ${paperDTO.title}`)
      }
      
      // Ensure processing_status is 'processed' for papers with full content
      try {
        await serviceClient
          .from('papers')
          .update({ processing_status: 'processed' })
          .eq('id', paperId)
      } catch (statusErr) {
        console.warn(`Failed to update processing_status for existing paper ${paperId}:`, statusErr)
      }
      
      // Create ingested paper object with database ID
      const ingestedPaper: RankedPaper = {
        ...paper,
        canonical_id: paperId,
        relevanceScore: paper.relevanceScore,
        combinedScore: paper.combinedScore,
        bm25Score: paper.bm25Score,
        authorityScore: paper.authorityScore,
        recencyScore: paper.recencyScore,
        pdf_url: paper.pdf_url
      }
      
      return { paperId, paper: ingestedPaper }
    }
    
    // No full-text content yet - proceed with extraction
    console.log(`📄 No full-text content (${paperRecord?.pdf_content?.length || 0} chars) - attempting extraction: ${paperDTO.title}`)
    
    // Step 3: Collect all content (title, abstract, PDF text)
    // SIMPLIFIED: No separate abstract chunking - createChunksForPaper handles all content uniformly
    const contentParts: string[] = []
    
    // Always include title for title-based matching
    contentParts.push(paperDTO.title)
    
    // Add abstract if available
    if (paperDTO.abstract) {
      contentParts.push(paperDTO.abstract)
    }
    
    // Step 4: Check for PDF content and extract if needed
    let pdfProcessingMs = 0
    
    if (paperDTO.pdf_url) {
      const pdfStartTime = Date.now()
      try {
        // Use unified processor with actual paperId
        const text = await getOrExtractFullText({ pdfUrl: paperDTO.pdf_url, paperId, ocr: true, timeoutMs: 60000 })
        pdfProcessingMs = Date.now() - pdfStartTime
        
        if (text && text.length > 100) {
          contentParts.push(text)
          console.log(`✅ PDF success: ${text.length} chars from ${paperDTO.pdf_url} [${pdfProcessingMs}ms]`)
        } else {
          console.warn(`⚠️ PDF empty: ${paperDTO.pdf_url} returned ${text?.length || 0} chars [${pdfProcessingMs}ms]`)
        }
      } catch (pdfErr) {
        pdfProcessingMs = Date.now() - pdfStartTime
        const errorMessage = pdfErr instanceof Error ? pdfErr.message : String(pdfErr)
        const failureType = classifyPdfFailure(errorMessage)
        
        console.warn(`❌ PDF failed [${failureType}]: ${paperDTO.pdf_url}`)
        console.warn(`   Reason: ${errorMessage.slice(0, 200)}`)
        console.warn(`   Duration: ${pdfProcessingMs}ms | Paper: "${paperDTO.title.slice(0, 50)}..."`)
        
        // DOI fallback is deterministic: only for URL/access failures and valid normalized DOIs.
        if (normalizedDoi && shouldAttemptDoiRecovery(failureType)) {
          let recovered = false
          
          // Try 1: HTML from publisher landing page
          try {
            const htmlResult = await tryHtmlFallbackFromDoi(normalizedDoi, 30_000)
            if (htmlResult?.content && htmlResult.content.length > 200) {
              contentParts.push(htmlResult.content)
              console.log(`✅ HTML-from-DOI recovery: ${htmlResult.content.length} chars after PDF failure`)
              recovered = true
              try {
                const serviceClient = getServiceClient()
                await serviceClient.from('papers').update({
                  pdf_content: htmlResult.content,
                  content_source: 'html'
                }).eq('id', paperId)
              } catch (persistErr) {
                console.warn(`Failed to persist HTML content for ${paperId}:`, persistErr)
              }
            }
          } catch (htmlErr) {
            console.warn(`❌ HTML-from-DOI recovery failed for ${normalizedDoi}:`, htmlErr instanceof Error ? htmlErr.message : String(htmlErr))
          }
          
          // Try 2: Europe PMC full-text XML (if paper is in PMC)
          if (!recovered) {
            try {
              const epmcResult = await tryEuropePmcFullText(normalizedDoi, 30_000)
              if (epmcResult?.content && epmcResult.content.length > 200) {
                contentParts.push(epmcResult.content)
                console.log(`✅ Europe PMC XML recovery: ${epmcResult.content.length} chars after PDF failure`)
                try {
                  const serviceClient = getServiceClient()
                  await serviceClient.from('papers').update({
                    pdf_content: epmcResult.content,
                    content_source: 'html'
                  }).eq('id', paperId)
                } catch (persistErr) {
                  console.warn(`Failed to persist EPMC content for ${paperId}:`, persistErr)
                }
              }
            } catch (epmcErr) {
              console.warn(`❌ Europe PMC XML recovery failed for ${normalizedDoi}:`, epmcErr instanceof Error ? epmcErr.message : String(epmcErr))
            }
          }
        } else if (normalizedDoi) {
          console.log(`📄 Skipping DOI fallback for failure class "${failureType}"`)
        }
      }
    } else if (normalizedDoi) {
      // No PDF URL but DOI exists — try content extraction fallbacks
      console.log(`📄 No PDF URL, trying content fallbacks via DOI for: "${paperDTO.title.slice(0, 50)}..."`)
      let recovered = false
      
      // Try 1: HTML from publisher landing page
      try {
        const htmlResult = await tryHtmlFallbackFromDoi(normalizedDoi, 30_000)
        if (htmlResult?.content && htmlResult.content.length > 200) {
          contentParts.push(htmlResult.content)
          console.log(`✅ HTML-from-DOI success: ${htmlResult.content.length} chars for "${paperDTO.title.slice(0, 50)}..."`)
          recovered = true
          try {
            const serviceClient = getServiceClient()
            await serviceClient.from('papers').update({
              pdf_content: htmlResult.content,
              content_source: 'html'
            }).eq('id', paperId)
          } catch (persistErr) {
            console.warn(`Failed to persist HTML content for ${paperId}:`, persistErr)
          }
        }
      } catch (htmlErr) {
        console.warn(`❌ HTML-from-DOI failed for ${normalizedDoi}:`, htmlErr instanceof Error ? htmlErr.message : String(htmlErr))
      }
      
      // Try 2: Europe PMC full-text XML (if paper is in PMC)
      if (!recovered) {
        try {
          const epmcResult = await tryEuropePmcFullText(normalizedDoi, 30_000)
          if (epmcResult?.content && epmcResult.content.length > 200) {
            contentParts.push(epmcResult.content)
            console.log(`✅ Europe PMC XML success: ${epmcResult.content.length} chars for "${paperDTO.title.slice(0, 50)}..."`)
            try {
              const serviceClient = getServiceClient()
              await serviceClient.from('papers').update({
                pdf_content: epmcResult.content,
                content_source: 'html'
              }).eq('id', paperId)
            } catch (persistErr) {
              console.warn(`Failed to persist EPMC content for ${paperId}:`, persistErr)
            }
          }
        } catch (epmcErr) {
          console.warn(`❌ Europe PMC XML failed for ${normalizedDoi}:`, epmcErr instanceof Error ? epmcErr.message : String(epmcErr))
        }
      }
    } else {
      console.log(`📄 No PDF URL and no DOI for: "${paperDTO.title.slice(0, 50)}..."`)
    }
    
    // Step 5: Create chunks using unified chunker (same settings for all content types)
    // This eliminates the separate abstract chunking path for consistency
    const finalChunkCount = await createChunksForPaper(paperId, contentParts.join('\n\n'))
    console.log(`📚 Ingested paper with ${finalChunkCount} chunks: ${paperDTO.title}`)

    // Step 5b: Run structured extraction (non-blocking, best-effort)
    // This extracts claims, findings, effect sizes, themes for cross-document synthesis
    if (finalChunkCount > 0) {
      runStructuredExtraction(paperId, paperDTO, contentParts.join('\n\n')).catch(err => {
        console.warn(`⚠️ Structured extraction failed for ${paperId}:`, err instanceof Error ? err.message : err)
      })
    }

    // Step 6: Update processing_status to 'processed' since chunks are created
    // This ensures the UI shows "Ready" instead of "Pending" for papers
    if (finalChunkCount > 0) {
      try {
        const serviceClient = getServiceClient()
        await serviceClient
          .from('papers')
          .update({ processing_status: 'processed' })
          .eq('id', paperId)
      } catch (statusErr) {
        console.warn(`Failed to update processing_status for paper ${paperId}:`, statusErr)
      }
    } else {
      // No chunks created - mark as failed
      try {
        const serviceClient = getServiceClient()
        await serviceClient
          .from('papers')
          .update({ processing_status: 'failed' })
          .eq('id', paperId)
        console.warn(`⚠️ No chunks created for paper ${paperId}, marked as failed`)
      } catch (statusErr) {
        console.warn(`Failed to update processing_status to failed for paper ${paperId}:`, statusErr)
      }
    }

    // Create ingested paper object with database ID and enhanced PDF URLs
    const ingestedPaper: RankedPaper = {
      ...paper, // This includes the enhanced PDF URLs from enhancePdfUrls()
      canonical_id: paperId, // Use database ID as canonical ID
      // Keep all the ranking scores from the original paper
      relevanceScore: paper.relevanceScore,
      combinedScore: paper.combinedScore,
      bm25Score: paper.bm25Score,
      authorityScore: paper.authorityScore,
      recencyScore: paper.recencyScore,
      // Ensure PDF URL is preserved at top level
      pdf_url: paper.pdf_url
    }

    // Fetch and store references for the paper (using canonical_id as fallback)
    await fetchAndStoreReferencesForPaper(paper, paperId)
    
    return { paperId, paper: ingestedPaper }
}

/**
 * Run structured extraction asynchronously (non-blocking)
 * 
 * Extracts findings from paper for cross-document synthesis.
 * Runs in background - failures don't block ingestion.
 */
async function runStructuredExtraction(
  paperId: string,
  paper: PaperDTO,
  fullText: string
): Promise<void> {
  // Skip if extraction already exists
  const alreadyExtracted = await hasExtraction(paperId)
  if (alreadyExtracted) {
    console.log(`📄 Extraction already exists for: ${paper.title.slice(0, 50)}...`)
    return
  }

  console.log(`🔬 Starting extraction for: ${paper.title.slice(0, 50)}...`)

  // Build full text with title and abstract for better LLM context
  const textParts = []
  if (paper.title) textParts.push(`Title: ${paper.title}`)
  if (paper.abstract) textParts.push(`Abstract: ${paper.abstract}`)
  if (fullText) textParts.push(fullText)
  
  const result = await extractPaper({
    paperId,
    text: textParts.join('\n\n')
  })

  if (result.success && result.extraction) {
    await saveExtraction(result.extraction)
    console.log(`✅ Extraction saved for: ${paper.title.slice(0, 50)}...`)
  } else {
    console.warn(`⚠️ Extraction failed for ${paperId}: ${result.error || 'unknown error'}`)
  }
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

// Batch search for multiple queries with smart delays
export async function batchSearchAndIngest(
  queries: string[],
  options: AggregatedSearchOptions = {}
): Promise<Array<{ query: string, papers: RankedPaper[], ingestedIds: string[] }>> {
  console.log(`Starting batch search for ${queries.length} queries`)
  
  const results = []
  let previousHadRateLimit = false
  
  for (let i = 0; i < queries.length; i++) {
    const query = queries[i]
    
    try {
      const result = await searchAndIngestPapers(query, options)
      results.push({ query, ...result })
      
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
      
      results.push({ query, papers: [], ingestedIds: [] })
      
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

// References ingestion with correct fallback ID
async function fetchAndStoreReferencesForPaper(paper: AcademicPaper, paperId: string) {
  try {
    // Use canonical_id as fallback instead of paperId (which is a Supabase UUID)
    const refs = await getPaperReferences(paper.doi, paper.canonical_id)
    if (refs.length === 0) return

    const supabase = await getSB()
    // prepare rows
    const rows = refs.slice(0, 100).map(r => ({
      paper_id: paperId,
      reference_csl: r
    }))
    await supabase.from('paper_references').insert(rows).select()
    console.log(`📚 Stored ${rows.length} references for paper ${paperId}`)
  } catch (e) {
    console.warn('Reference ingestion failed', e)
  }
}

// ---------- PDF observability ----------
async function _recordPdfExtractionMetric(params: {
  doi?: string
  extractionMethod: string
  confidence: 'high' | 'medium' | 'low'
  extractionTimeMs: number
}): Promise<void> {
  try {
    const sb = await createSB()
    await sb.from('pdf_extraction_metrics').insert({
      doi: params.doi || null,
      extraction_method: params.extractionMethod,
      confidence: params.confidence,
      extraction_time_ms: params.extractionTimeMs,
      timestamp: new Date().toISOString()
    })
  } catch (err) {
    console.warn('Failed to record PDF metric', err)
  }
} 