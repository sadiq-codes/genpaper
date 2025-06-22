import { 
  AcademicPaper, 
  SearchOptions,
  searchOpenAlex,
  searchCrossref,
  searchSemanticScholar,
  searchArxiv,
  searchCore,
  expandKeywords,
  getOpenAccessPdf,
  getPaperReferences
} from './academic-apis'
import { ingestPaperWithChunks } from '@/lib/db/papers'
import type { PaperDTO } from '@/lib/schemas/paper'
import { PaperSources } from '@/types/simplified'
import { getSB } from '@/lib/supabase/server'
import { extractPdfMetadataTiered } from '@/lib/pdf/tiered-extractor'
import { createClient as createSB } from '@/lib/supabase/client'
// Note: randomUUID imported for future use in enhanced temp ID generation

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

// Enhanced deduplication with arXiv preprint handling (no object mutation)
function deduplicatePapers(papers: AcademicPaper[]): AcademicPaper[] {
  const seen = new Set<string>()
  const deduplicated: AcademicPaper[] = []
  const arxivPapers = new Map<string, AcademicPaper>()
  const journalPapers = new Map<string, AcademicPaper>()
  
  // Sort by citation count descending to prefer higher-cited duplicates
  const sorted = papers.sort((a, b) => b.citationCount - a.citationCount)
  
  // First pass: identify arXiv preprints and journal papers
  for (const paper of sorted) {
    const normalizedTitle = paper.title.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    
    if (paper.source === 'arxiv') {
      arxivPapers.set(normalizedTitle, paper)
    } else if (paper.doi) {
      journalPapers.set(normalizedTitle, paper)
    }
  }
  
  // Second pass: deduplicate with arXiv preprint vs journal DOI preference
  for (const paper of sorted) {
    if (!seen.has(paper.canonical_id)) {
      const normalizedTitle = paper.title.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      
      // Check for arXiv preprint vs journal version
      if (paper.source === 'arxiv' && journalPapers.has(normalizedTitle)) {
        const journalVersion = journalPapers.get(normalizedTitle)!
        // Create new object instead of mutating - prevent side effects
        const enhancedJournal = {
          ...journalVersion,
          preprint_id: paper.url,
          siblings: [paper.canonical_id]
        } as RankedPaper
        
        seen.add(paper.canonical_id)
        seen.add(journalVersion.canonical_id)
        
        // Only add if journal version not already added
        if (!deduplicated.find(p => p.canonical_id === journalVersion.canonical_id)) {
          deduplicated.push(enhancedJournal)
        }
      } else if (paper.doi && arxivPapers.has(normalizedTitle)) {
        const arxivVersion = arxivPapers.get(normalizedTitle)!
        // Create new object instead of mutating
        const enhancedJournal = {
          ...paper,
          preprint_id: arxivVersion.url,
          siblings: [arxivVersion.canonical_id]
        } as RankedPaper
        
        seen.add(paper.canonical_id)
        seen.add(arxivVersion.canonical_id)
        deduplicated.push(enhancedJournal)
      } else {
        // No duplicate found, add as-is
        seen.add(paper.canonical_id)
        deduplicated.push(paper)
      }
    }
  }
  
  return deduplicated
}

// Rank papers using corrected scoring (no double authority weighting)
function rankPapers(
  papers: AcademicPaper[], 
  query: string, 
  options: AggregatedSearchOptions = {}
): RankedPaper[] {
  const {
    semanticWeight = 1.0,
    authorityWeight = 0.5,
    recencyWeight = 0.1
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
  
  // **SMART PRIORITIZATION**: Order sources by speed/reliability (fastest first)
  const sourcesByPriority: SupportedSource[] = []
  const priorityOrder: SupportedSource[] = ['openalex', 'crossref', 'semantic_scholar', 'arxiv', 'core']
  
  // Add requested sources in priority order
  for (const source of priorityOrder) {
    if (requestedSources.includes(source)) {
      sourcesByPriority.push(source)
    }
  }
  
  // Expand search terms
  const expandedQueries = expandKeywords(query)
  const primaryQuery = expandedQueries[0]
  
  console.log(`Starting smart sequential search for: "${primaryQuery}"`)
  console.log(`Source priority order: ${sourcesByPriority.join(' → ')}`)
  console.log(`Fast mode: ${fastMode ? 'ON' : 'OFF'}`)
  
  const allPapers: AcademicPaper[] = []
  // Increase the threshold so we do not prematurely stop after a single large response
  const TARGET_PAPERS = Math.min(maxResults * 4, 100) // Search for up to 4× target (capped at 100) before ranking
  
  console.log(`Parallel search target paper threshold set to ${TARGET_PAPERS}`)
  
  // **PARALLEL SEARCH**: query each requested source concurrently and merge results
  async function querySource(source: SupportedSource): Promise<AcademicPaper[]> {
    const searchOptions = { ...options, limit: Math.min(limit, 25), fastMode }
    const sourceTimeout = fastMode ? 6000 : 15000 // 6s vs 15s timeout

    try {
      console.log(`🔍 Searching ${source} in parallel…`)
      
      return await withAbortableTimeout(async (_signal) => {
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
      
    } catch (error) {
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
  
  // Deduplicate and rank as before
  const deduplicated = deduplicatePapers(allPapers)
  console.log(`🔄 After deduplication: ${deduplicated.length} papers`)
  
  // Rank papers
  const ranked = rankPapers(deduplicated, primaryQuery, options)
  
  // Return top results
  const topResults = ranked.slice(0, maxResults)
  console.log(`🎯 Final results: ${topResults.length} papers`)
  
  return topResults
}

// Sentence-aware text chunking for better retrieval
function chunkText(text: string, maxLength = 500): string[] {
  // Split into sentences using basic punctuation
  const sentences = text.split(/(?<=[.!?])\s+/)
  const chunks: string[] = []
  let currentChunk = ''
  
  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim()
    if (!trimmedSentence) continue
    
    // Check if adding this sentence would exceed max length
    const potentialChunk = currentChunk ? `${currentChunk} ${trimmedSentence}` : trimmedSentence
    
    if (potentialChunk.length > maxLength && currentChunk) {
      // Current chunk is ready, start new one with this sentence
      chunks.push(currentChunk.trim())
      currentChunk = trimmedSentence
    } else {
      // Add sentence to current chunk
      currentChunk = potentialChunk
    }
  }
  
  // Add final chunk if it has content
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim())
  }
  
  // If no chunks were created (very long sentences), fall back to character splitting
  if (chunks.length === 0 && text.length > 0) {
    const charChunks = text.match(/.{1,500}(?:\s|$)/g) || []
    chunks.push(...charChunks.map(chunk => chunk.trim()).filter(Boolean))
  }
  
  return chunks
}

// Convert AcademicPaper to PaperDTO for ingestion with proper guards
function convertToPaperDTO(paper: RankedPaper, searchQuery: string): PaperDTO {
  // Normalize impact score to 0-1 range with guard against exceeding 1.0
  const rawScore = paper.combinedScore || 0
  const normalizedImpactScore = rawScore > 0 ? 
    Math.min(0.999, 1 - 1 / (rawScore + 1)) : 0 // Guard against floating point precision issues

  return {
    title: paper.title,
    abstract: paper.abstract || undefined,
    publication_date: paper.year ? `${paper.year}-01-01` : undefined,
    venue: paper.venue || undefined,
    doi: paper.doi || undefined,
    url: paper.url || undefined,
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
    impact_score: normalizedImpactScore,
    authors: (paper.authors && paper.authors.length > 0) ? paper.authors : ['Unknown']
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
  
  // Enhance with PDF URLs where possible
  const enhancedPapers = await Promise.all(
    rankedPapers.map(async (paper) => {
      if (paper.doi && !paper.pdf_url) {
        try {
          const pdfUrl = await getOpenAccessPdf(paper.doi)
          if (pdfUrl) {
            return { ...paper, pdf_url: pdfUrl }
          }
        } catch (error) {
          console.error(`Failed to get PDF for DOI ${paper.doi}:`, error)
        }
      }
      return paper
    })
  )
  
  // Convert to PaperDTO format and ingest with chunks
  const ingestedIds: string[] = []
  
  for (const paper of enhancedPapers) {
    try {
      const paperDTO = convertToPaperDTO(paper, query)
      
      // Create content chunks from title and abstract for RAG using sentence-aware chunking
      const contentChunks: string[] = []
      if (paperDTO.abstract) {
        // Use sentence-aware chunking for better retrieval
        const abstractChunks = chunkText(paperDTO.abstract)
        contentChunks.push(...abstractChunks)
      }
      
      // Always include title as a chunk for title-based matching
      contentChunks.unshift(paperDTO.title)
      
      // 🆕 Full-text ingestion – parse PDF when available (no gating)
      if (paperDTO.pdf_url) {
        try {
          console.log(`📥 Downloading PDF for full-text extraction: ${paperDTO.pdf_url}`)
          const pdfRes = await fetch(paperDTO.pdf_url, { headers: { 'User-Agent': 'GenPaperBot/1.0' } })
          if (pdfRes.ok) {
            const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer())
            const extraction = await extractPdfMetadataTiered(pdfBuffer, {
              grobidUrl: process.env.GROBID_URL || 'http://localhost:8070',
              enableOcr: false
            })

            // Record extraction metrics
            await recordPdfExtractionMetric({
              doi: paperDTO.doi,
              extractionMethod: extraction.extractionMethod,
              confidence: extraction.confidence,
              extractionTimeMs: extraction.extractionTimeMs
            })

            if (extraction.fullText && extraction.fullText.length > 100) {
              // Add full text to content for chunking by ingestPaperWithChunks (with 1MB safety cap)
              const text = extraction.fullText.slice(0, 1_000_000)
              contentChunks.push(text)
              paperDTO.abstract = extraction.abstract ?? paperDTO.abstract
              console.log(`✅ Added full-text content (method: ${extraction.extractionMethod}, ${text.length} chars)`)
            } else {
              console.warn('PDF extraction returned no usable text content')
            }
          } else {
            console.warn(`Failed to download PDF (${pdfRes.status})`)
          }
        } catch (pdfErr) {
          console.warn('PDF extraction failed, continuing with abstract only', pdfErr)
        }
      }
      
      // Use ingestPaperWithChunks to create content chunks for RAG
      const paperId = await ingestPaperWithChunks(paperDTO, contentChunks)
      ingestedIds.push(paperId)
      console.log(`Ingested paper with ${contentChunks.length} chunks: ${paper.title} (ID: ${paperId})`)

      // Fetch and store references for the paper (using canonical_id as fallback)
      await fetchAndStoreReferencesForPaper(paper, paperId)
    } catch (error) {
      console.error(`Failed to ingest paper "${paper.title}":`, error)
    }
  }
  
  console.log(`Successfully ingested ${ingestedIds.length} of ${enhancedPapers.length} papers with content chunks`)
  
  return {
    papers: enhancedPapers,
    ingestedIds
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
async function recordPdfExtractionMetric(params: {
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