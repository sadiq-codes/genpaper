import { 
  AcademicPaper, 
  SearchOptions,
  searchOpenAlex,
  searchCrossref,
  searchSemanticScholar,
  searchArxiv,
  searchCore,
  enhancePdfUrls,
  getPaperReferences
} from './academic-apis'
import { checkPaperExists, createPaperMetadata } from '@/lib/db/papers'
import { createChunksForPaper } from '@/lib/content/ingestion'
import { getOrExtractFullText } from '@/lib/services/pdf-processor'
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
  recordFailure,
  CircuitOpenError 
} from '@/lib/search/circuit-breaker'
import { getCached, setCached } from '@/lib/search/source-cache'
import { getServiceClient } from '@/lib/supabase/service'

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
function calculateRecencyScore(year: number): number {
  // Guard against negative years producing positives in BCE edge-case
  if (year < 1900) {
    return 0
  }
  
  const currentYear = new Date().getFullYear()
  return Math.max(0, (year - (currentYear - 10)) * 0.1) // Boost papers from last 10 years
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
    sources = ['openalex', 'crossref', 'semantic_scholar', 'arxiv', 'core'], // All sources by default
    fastMode = false
  } = options
  
  // Filter to only supported sources to prevent pubmed config mismatch
  const SUPPORTED_SOURCES = ['openalex', 'crossref', 'semantic_scholar', 'arxiv', 'core'] as const
  type SupportedSource = typeof SUPPORTED_SOURCES[number]
  const requestedSources = sources.filter((s): s is SupportedSource => SUPPORTED_SOURCES.includes(s as SupportedSource))
  
  // Ensure we have at least one source to search
  if (requestedSources.length === 0) {
    console.warn('No supported sources provided, falling back to all default sources')
    requestedSources.push(...SUPPORTED_SOURCES)
  }
  
  // **SMART PRIORITIZATION**: Order sources by speed/reliability and PDF coverage
  // CORE moved up because it has 200M+ open access papers with direct PDF URLs
  const sourcesByPriority: SupportedSource[] = []
  const priorityOrder: SupportedSource[] = ['openalex', 'core', 'crossref', 'semantic_scholar', 'arxiv']
  
  // Add requested sources in priority order
  for (const source of priorityOrder) {
    if (requestedSources.includes(source)) {
      sourcesByPriority.push(source)
    }
  }
  
  // Generate embedding-based query rewrites (async)
  const expandedQueries = await generateQueryRewrites(query)
  const primaryQuery = expandedQueries[0]
  
  console.log(`Starting smart sequential search for: "${primaryQuery}"`)
  console.log(`Source priority order: ${sourcesByPriority.join(' → ')}`)
  console.log(`Fast mode: ${fastMode ? 'ON' : 'OFF'}`)
  
  const allPapers: AcademicPaper[] = []
  // Increase the threshold so we do not prematurely stop after a single large response
  const TARGET_PAPERS = Math.min(maxResults * 4, 100) // Search for up to 4× target (capped at 100) before ranking
  
  console.log(`Parallel search target paper threshold set to ${TARGET_PAPERS}`)
  
  // **PARALLEL SEARCH**: query each requested source concurrently and merge results
  // Integrates circuit breaker (fail fast on unhealthy sources) and caching (avoid redundant calls)
  async function querySource(source: SupportedSource): Promise<AcademicPaper[]> {
    const searchOptions = { ...options, limit: Math.min(limit, 25), fastMode }
    const sourceTimeout = fastMode ? 6000 : 15000 // 6s vs 15s timeout

    // Circuit breaker check - skip unhealthy sources
    if (!isSourceAvailable(source)) {
      console.log(`⚡ Skipping ${source} (circuit open)`)
      return []
    }

    // Check cache first
    const cacheKey = { ...searchOptions, includePreprints }
    const cached = getCached<AcademicPaper[]>(source, primaryQuery, cacheKey)
    if (cached) {
      console.log(`💾 Cache hit for ${source} (${cached.length} papers)`)
      return cached
    }

    try {
      console.log(`🔍 Searching ${source} in parallel…`)
      
      const results = await withAbortableTimeout(async (_signal) => {
        void _signal // reference to avoid unused variable lint error
        // Note: signal parameter ready for future enhancement when academic APIs support AbortSignal
        switch (source) {
          case 'openalex':
            return await searchOpenAlex(primaryQuery, searchOptions)
          case 'crossref':
            return await searchCrossref(primaryQuery, searchOptions)
          case 'semantic_scholar':
            return await searchSemanticScholar(primaryQuery, searchOptions)
          case 'arxiv':
            return includePreprints ? await searchArxiv(primaryQuery, searchOptions) : []
          case 'core':
            return await searchCore(primaryQuery, searchOptions)
          default:
            return []
        }
      }, sourceTimeout)
      
      // Record success and cache results
      recordSuccess(source)
      setCached(source, primaryQuery, results, cacheKey)
      
      return results
      
    } catch (error) {
      // Record failure for circuit breaker
      recordFailure(source, error instanceof Error ? error : new Error(String(error)))
      console.log(`❌ ${source} failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return [] // Swallow individual failure but continue overall search
    }
  }

  const settledResults = await Promise.allSettled(sourcesByPriority.map(querySource))

  for (const res of settledResults) {
    if (res.status === 'fulfilled' && res.value.length > 0) {
      allPapers.push(...res.value)
    }
  }

  console.log(`✅ Parallel search completed: ${allPapers.length} raw papers collected`)
  
  console.log(`📊 Raw results: ${allPapers.length} papers from ${sourcesByPriority.length} sources`)
  
  // Deduplicate
  const deduplicated = deduplicatePapers(allPapers)
  console.log(`🔄 After deduplication: ${deduplicated.length} papers`)
  
  // Quick pre-filter: remove obviously irrelevant papers before expensive embedding
  const preFiltered = deduplicated.filter(paper => 
    quickRelevanceCheck(primaryQuery, paper.title, paper.abstract)
  )
  console.log(`🔍 After quick relevance filter: ${preFiltered.length} papers`)
  
  // If we have enough papers after pre-filtering, use semantic re-ranking
  // This provides much better relevance than BM25 alone
  if (preFiltered.length >= 3) {
    try {
      // Prepare papers for semantic re-ranking
      const papersForRerank = preFiltered.map(p => ({
        ...p,
        id: p.canonical_id // semantic-rerank expects 'id' field
      }))
      
      // Re-rank using embeddings
      const reranked = await semanticRerank(primaryQuery, papersForRerank, {
        minScore: 0.20, // Minimum semantic similarity threshold
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
  }
  
  // Fallback: BM25 ranking (for when semantic fails or too few papers)
  const ranked = rankPapers(preFiltered.length > 0 ? preFiltered : deduplicated, primaryQuery, options)
  
  // Return top results
  const topResults = ranked.slice(0, maxResults)
  console.log(`🎯 Final results (BM25 fallback): ${topResults.length} papers`)
  
  return topResults
}



// Convert AcademicPaper to PaperDTO for ingestion with proper guards
function convertToPaperDTO(paper: RankedPaper, searchQuery: string): PaperDTO {
  // Normalize impact score to 0-1 range with guard against exceeding 1.0
  const rawScore = paper.combinedScore || 0
  const _normalizedImpactScore = rawScore > 0 ? 
    Math.min(0.999, 1 - 1 / (rawScore + 1)) : 0 // Guard against floating point precision issues

  return {
    title: paper.title,
    abstract: paper.abstract || undefined,
    publication_date: paper.year ? `${paper.year}-01-01` : undefined,
    venue: paper.venue || undefined,
    doi: paper.doi || undefined,
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
    authors: (paper.authors && paper.authors.length > 0) ? paper.authors : ['Unknown'],
    // Additional bibliographic fields for complete citations
    volume: paper.volume || undefined,
    issue: paper.issue || undefined,
    pages: paper.pages || undefined,
    publisher: paper.publisher || undefined
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
    const key = paper.doi || paper.title.toLowerCase().trim()
    if (processedPapers.has(key)) {
      console.log(`📚 Skipping duplicate paper: ${paper.title}`)
      return false
    }
    processedPapers.add(key)
    return true
  })
  
  console.log(`📊 Deduplicated ${enhancedPapers.length} papers to ${uniquePapers.length} unique papers`)
  
  // Process PDFs in parallel batches to utilize GROBID's 10-engine pool
  const PARALLEL_PDF_BATCH_SIZE = 8 // Use 8 out of 10 GROBID engines, keep 2 as buffer
  
  for (let i = 0; i < uniquePapers.length; i += PARALLEL_PDF_BATCH_SIZE) {
    const batch = uniquePapers.slice(i, i + PARALLEL_PDF_BATCH_SIZE)
    console.log(`📄 Processing PDF batch ${Math.floor(i/PARALLEL_PDF_BATCH_SIZE) + 1}: ${batch.length} papers`)
    
    // Process this batch in parallel
    const batchResults = await Promise.allSettled(
      batch.map(paper => processPaperWithPdf(paper, query))
    )
    
    // Collect successful results
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        ingestedIds.push(result.value.paperId)
        ingestedPapers.push(result.value.paper)
      } else {
        console.warn('Paper processing failed:', result.reason)
      }
    }
  }
  
  return { papers: ingestedPapers, ingestedIds }
}

// In-memory lock to prevent concurrent processing of the same paper
// Key: DOI or normalized title, Value: Promise that resolves when processing completes
const paperProcessingLocks = new Map<string, Promise<{ paperId: string; paper: RankedPaper }>>()

function getPaperLockKey(paper: RankedPaper): string {
  return paper.doi || normalizeTitle(paper.title)
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
    
    // Step 2: Check if chunks already exist - but allow PDF upgrade for low-chunk papers
    const supabase = await getSB()
    const { count: existingChunkCount, error: chunksErr } = await supabase
      .from('paper_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('paper_id', paperId)
    
    if (!chunksErr && existingChunkCount && existingChunkCount >= 5) {
      // Paper has full-text content already (≥5 chunks), skip processing
      console.log(`📚 Full content already exists for paper (${existingChunkCount} chunks, skipping): ${paperDTO.title}`)
      
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
    } else if (!chunksErr && existingChunkCount && existingChunkCount > 0) {
      // Paper has some content but <5 chunks (probably just abstract) - allow PDF upgrade
      console.log(`📄 Paper has ${existingChunkCount} chunks - attempting PDF upgrade: ${paperDTO.title}`)
      
      // Clear existing abstract-only chunks before adding full-text content
      // Use service client to bypass RLS (paper_chunks requires service_role for writes)
      try {
        const serviceClient = getServiceClient()
        await serviceClient
          .from('paper_chunks')
          .delete()
          .eq('paper_id', paperId)
        console.log(`🗑️ Cleared ${existingChunkCount} existing chunks for upgrade`)
      } catch (deleteErr) {
        console.warn('Failed to clear existing chunks for upgrade:', deleteErr)
      }
    }
    
    // Step 3: Prepare content chunks from title and abstract
    const contentChunks: string[] = []
    
    // Always include title as a chunk for title-based matching
    contentChunks.push(paperDTO.title)
    
    if (paperDTO.abstract) {
      // Use sentence-aware chunking for better retrieval
      // Use token-based chunking for abstract
      const { chunkByTokens } = await import('@/lib/utils/text')
      const abstractChunks = await chunkByTokens(paperDTO.abstract, paperId, {
        maxTokens: 200,
        preserveParagraphs: false
      })
      contentChunks.push(...abstractChunks.map(chunk => chunk.content))
    }
    
    // Step 4: Check for PDF content and extract if needed
    if (paperDTO.pdf_url) {
      try {
        // Use unified processor with actual paperId
        const text = await getOrExtractFullText({ pdfUrl: paperDTO.pdf_url, paperId, ocr: true, timeoutMs: 60000 })
        if (text && text.length > 100) {
          contentChunks.push(text)
          console.log(`✅ Added full-text content (${text.length} chars)`)
        } else {
          console.warn('PDF extraction returned no usable text content')
        }
      } catch (pdfErr) {
        console.warn('PDF extraction failed, continuing with abstract only', pdfErr)
      }
    }
    
    // Step 5: Create chunks for the paper
    const finalChunkCount = await createChunksForPaper(paperId, contentChunks.join('\n\n'))
    console.log(`📚 Ingested paper with ${finalChunkCount} chunks: ${paperDTO.title}`)

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