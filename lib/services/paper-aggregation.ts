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

// ---------- BM25 utilities (pre-compute doc frequencies to avoid O(n²) scans) ----------

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
    const text = `${paper.title} ${paper.abstract}`.toLowerCase()
    totalDocLength += text.split(/\s+/).length
    for (const term of queryTerms) {
      if (text.includes(term)) {
        dfCounts.set(term, (dfCounts.get(term) || 0) + 1)
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

    // frequency with title double-weighted
    const freq = titleTerms.filter(t => t.includes(term)).length * 2 +
                 abstractTerms.filter(t => t.includes(term)).length

    if (freq === 0) continue

    const numerator = freq * (k1 + 1)
    const denominator = freq + k1 * (1 - b + b * (docLength / avgDocLen))
    score += idfVal * (numerator / denominator)
  }

  return score
}

// Calculate authority score based on citations  
function calculateAuthorityScore(citationCount: number): number {
  return Math.log10(citationCount + 1)
}

// Fix: Calculate recency score with BCE edge-case protection
function calculateRecencyScore(year: number): number {
  // Fix: Guard against negative years producing positives in BCE edge-case
  if (year < 1900) {
    return 0
  }
  
  const currentYear = new Date().getFullYear()
  return Math.max(0, (year - (currentYear - 10)) * 0.1) // Boost papers from last 10 years
}

// Fix: Enhanced deduplication with arXiv preprint handling
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
        // Prefer journal DOI but keep arXiv in metadata.preprint_id
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
        // Journal version preferred, add preprint metadata
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

// Fix: Rank papers using corrected scoring
function rankPapers(
  papers: AcademicPaper[], 
  query: string, 
  options: AggregatedSearchOptions = {}
): RankedPaper[] {
  const {
    semanticWeight = 1.0,
    authorityWeight = 0.5, // Fix: Only use this once, not multiply by 0.5 again later
    recencyWeight = 0.1
  } = options
  
  const bm25Env = buildBM25Environment(query, papers)

  return papers.map(paper => {
    const bm25Score = calculateBM25Score(bm25Env, paper.title, paper.abstract)
    const authorityScore = calculateAuthorityScore(paper.citationCount)
    const recencyScore = calculateRecencyScore(paper.year)
    
    // Fix: Authority weight already at 0.5, don't multiply by 0.5 again
    const combinedScore = 
      bm25Score * semanticWeight +
      authorityScore * authorityWeight + // Fix: Remove the extra * 0.5 multiplication
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

// Parallel search across all APIs with smart source prioritization
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
  
  // Fix: Filter to only supported sources to prevent pubmed config mismatch
  const SUPPORTED_SOURCES = ['openalex', 'crossref', 'semantic_scholar', 'arxiv', 'core'] as const
  type SupportedSource = typeof SUPPORTED_SOURCES[number]
  const requestedSources = sources.filter((s): s is SupportedSource => SUPPORTED_SOURCES.includes(s as SupportedSource))
  
  // Fix: Ensure we have at least one source to search
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
    try {
      console.log(`🔍 Searching ${source} in parallel…`)
      const searchOptions = { ...options, limit: Math.min(limit, 25), fastMode }
      const sourceTimeout = fastMode ? 6000 : 15000 // 6 s vs 15 s timeout

      const searchPromise = (async () => {
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
      })()

      // Race search against a timeout so one slow source does not block the whole batch
      return await Promise.race([
        searchPromise,
        new Promise<AcademicPaper[]>((_, reject) =>
          setTimeout(() => reject(new Error(`${source} timeout after ${sourceTimeout}ms`)), sourceTimeout)
        )
      ])
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

// Convert AcademicPaper to PaperDTO for ingestion
function convertToPaperDTO(paper: RankedPaper, searchQuery: string): PaperDTO {
  // Normalize impact score to 0-1 range to satisfy database constraint
  // Formula: 1 - 1/(raw + 1) maps 0→0, 1→0.5, 5→0.83, 8→0.89
  const rawScore = paper.combinedScore || 0
  const normalizedImpactScore = rawScore > 0 ? 1 - 1 / (rawScore + 1) : 0

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
    impact_score: normalizedImpactScore, // Fix: Use normalized score (0-1 range)
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
      
      // Create content chunks from title and abstract for RAG
      const contentChunks = []
      if (paperDTO.abstract) {
        // Split abstract into meaningful chunks for better RAG retrieval
        const abstractChunks = paperDTO.abstract.match(/.{1,500}(?:\s|$)/g) || []
        contentChunks.push(...abstractChunks.map((chunk: string) => chunk.trim()).filter(Boolean))
      }
      
      // Always include title as a chunk for title-based matching
      contentChunks.unshift(paperDTO.title)
      
      // Use ingestPaperWithChunks to create content chunks for RAG
      const paperId = await ingestPaperWithChunks(paperDTO, contentChunks)
      ingestedIds.push(paperId)
      console.log(`Ingested paper with ${contentChunks.length} chunks: ${paper.title} (ID: ${paperId})`)

      // Fetch and store references for the paper
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

// Batch search for multiple queries
export async function batchSearchAndIngest(
  queries: string[],
  options: AggregatedSearchOptions = {}
): Promise<Array<{ query: string, papers: RankedPaper[], ingestedIds: string[] }>> {
  console.log(`Starting batch search for ${queries.length} queries`)
  
  const results = []
  
  for (const query of queries) {
    try {
      const result = await searchAndIngestPapers(query, options)
      results.push({ query, ...result })
      
      // Add delay between requests to be respectful to APIs
      await new Promise(resolve => setTimeout(resolve, 1000))
    } catch (error) {
      console.error(`Batch search failed for query "${query}":`, error)
      results.push({ query, papers: [], ingestedIds: [] })
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

// ------------------ References ingestion ----------------------
async function fetchAndStoreReferencesForPaper(paper: AcademicPaper, paperId: string) {
  try {
    const refs = await getPaperReferences(paper.doi, paperId)
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

// Removed enhancedSearch function - functionality moved to search-orchestrator.ts unifiedSearch() 