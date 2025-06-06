import { 
  AcademicPaper, 
  SearchOptions,
  searchOpenAlex,
  searchCrossref,
  searchSemanticScholar,
  searchArxiv,
  searchCore,
  expandKeywords,
  getOpenAccessPdf
} from './academic-apis'
import { ingestPaperWithChunks } from '@/lib/db/papers'
import type { PaperDTO } from '@/lib/schemas/paper'
import { PaperSources } from '@/types/simplified'

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

// Fix: Improved BM25 scoring with accurate IDF calculation
function calculateBM25Score(query: string, title: string, abstract: string, allPapers: AcademicPaper[]): number {
  const k1 = 1.2
  const b = 0.75
  
  const queryTerms = query.toLowerCase().split(/\s+/)
  const titleTerms = title.toLowerCase().split(/\s+/)
  const abstractTerms = abstract.toLowerCase().split(/\s+/)
  const allTerms = [...titleTerms, ...abstractTerms]
  
  let score = 0
  const avgDocLength = 100 // Approximate average document length
  const docLength = allTerms.length
  
  // Fix: Compute N = total docs once per query for accurate IDF
  const N = allPapers.length
  
  for (const term of queryTerms) {
    const titleFreq = titleTerms.filter(t => t.includes(term)).length
    const abstractFreq = abstractTerms.filter(t => t.includes(term)).length
    const termFreq = titleFreq * 2 + abstractFreq // Weight title matches higher
    
    if (termFreq > 0) {
      // Fix: Calculate document frequency (df) across all papers
      const df = allPapers.filter(paper => {
        const paperText = `${paper.title} ${paper.abstract}`.toLowerCase()
        return paperText.includes(term)
      }).length
      
      // Fix: Use proper BM25 IDF formula: log((N - df + 0.5) / (df + 0.5))
      const idf = Math.log((N - df + 0.5) / (df + 0.5))
      const numerator = termFreq * (k1 + 1)
      const denominator = termFreq + k1 * (1 - b + b * (docLength / avgDocLength))
      score += idf * (numerator / denominator)
    }
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
  
  return papers.map(paper => {
    const bm25Score = calculateBM25Score(query, paper.title, paper.abstract, papers)
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
    console.warn('No supported sources provided, defaulting to openalex')
    requestedSources.push('openalex')
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
  const TARGET_PAPERS = Math.min(maxResults * 2, 40) // Search for 2x target to ensure good results after dedup
  
  // **SEQUENTIAL SEARCH**: Search sources one by one with early termination
  for (const source of sourcesByPriority) {
    if (allPapers.length >= TARGET_PAPERS) {
      console.log(`✅ Early termination: ${allPapers.length} papers found, target: ${TARGET_PAPERS}`)
      break
    }
    
    try {
      console.log(`🔍 Searching ${source} (papers so far: ${allPapers.length})...`)
      
      let sourceResults: AcademicPaper[] = []
      const searchOptions = { ...options, limit: Math.min(limit, 25), fastMode }
      
      // Add per-source timeout for fast mode
      const sourceTimeout = fastMode ? 6000 : 15000 // 6s vs 15s timeout
      
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
      
      // Race against timeout
      sourceResults = await Promise.race([
        searchPromise,
        new Promise<AcademicPaper[]>((_, reject) => 
          setTimeout(() => reject(new Error(`${source} timeout after ${sourceTimeout}ms`)), sourceTimeout)
        )
      ])
      
      if (sourceResults.length > 0) {
        allPapers.push(...sourceResults)
        console.log(`✅ ${source}: ${sourceResults.length} papers (total: ${allPapers.length})`)
      } else {
        console.log(`⚠️  ${source}: 0 papers`)
      }
      
      // Small delay between sources in fast mode to avoid overwhelming APIs
      if (fastMode && sourcesByPriority.indexOf(source) < sourcesByPriority.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200))
      }
      
    } catch (error) {
      console.log(`❌ ${source} failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      // Continue to next source on failure
    }
  }
  
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
    authors: paper.authors || []
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