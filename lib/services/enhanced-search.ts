import { searchAndIngestPapers, type AggregatedSearchOptions, type RankedPaper } from './paper-aggregation'
import { semanticSearchPapers, hybridSearchPapers } from '@/lib/db/papers'
import { generatePaperUUID } from '@/lib/db/papers'
import { createClient } from '@/lib/supabase/server'
import type { PaperWithAuthors, PaperSources } from '@/types/simplified'

// Enhanced search options that combine vector and academic search
export interface EnhancedSearchOptions extends AggregatedSearchOptions {
  useSemanticSearch?: boolean
  fallbackToKeyword?: boolean
  fallbackToAcademic?: boolean
  forceIngest?: boolean // Skip vector/keyword and go straight to academic APIs
  minResults?: number
  combineResults?: boolean
  vectorWeight?: number
  academicWeight?: number
  localRegion?: string // Region to boost in search results
}

// Combined search result with metadata
export interface EnhancedSearchResult {
  papers: Array<PaperWithAuthors & { 
    searchType: 'vector' | 'keyword' | 'academic' 
    relevanceScore?: number
    combinedScore?: number
  }>
  metadata: {
    vectorResults: number
    keywordResults: number
    academicResults: number
    totalResults: number
    searchStrategies: string[]
    cached: boolean
  }
}

// Defensive sanitizer for tsquery meta characters
const TSQUERY_META = /[()|&!:*]/g // reserved tokens

export function safePlainQuery(str: string): string {
  return str
    .replace(TSQUERY_META, ' ') // strip meta-chars
    .replace(/\s+/g, ' ')
    .trim()
}

// Helper function to deduplicate papers by ID or DOI
function deduplicatePapers<T extends { id?: string; doi?: string; canonical_id?: string }>(papers: T[]): T[] {
  const seen = new Set<string>()
  return papers.filter(paper => {
    const key = paper.id || paper.doi || paper.canonical_id || JSON.stringify(paper)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

// Vector/semantic search with proper error handling (no mock fallback)
async function performVectorSearch(
  query: string, 
  options: EnhancedSearchOptions
): Promise<PaperWithAuthors[]> {
  console.log(`Performing vector search for: "${query}"`)
  
  // First try hybrid search
  try {
    const papers = await hybridSearchPapers(query, {
      limit: options.maxResults || 10,
      minYear: options.fromYear || 1900,
      sources: options.sources,
      semanticWeight: options.vectorWeight || 0.7,
      excludePaperIds: []
    })
    
    console.log(`Hybrid search found ${papers.length} papers`)
    return papers
  } catch (hybridError: unknown) {
    console.error('Hybrid search failed:', hybridError)
    
    // Check if it's the function overloading error
    const errorMessage = hybridError instanceof Error ? hybridError.message : String(hybridError)
    const errorCode = hybridError && typeof hybridError === 'object' && 'code' in hybridError ? (hybridError as { code: string }).code : null
    
    if (errorCode === 'PGRST203' || errorMessage.includes('Could not choose the best candidate function')) {
      console.log('Function overloading detected, trying simpler semantic search')
      
      // Try the simpler semantic search function
      const papers = await semanticSearchPapers(query, {
        limit: options.maxResults || 10,
        minYear: options.fromYear || 1900,
        sources: options.sources
      })
      
      console.log(`Semantic search found ${papers.length} papers`)
      return papers
    }
    
    // For other errors, re-throw to fail properly
    throw hybridError
  }
}

// Keyword search using full-text search
async function performKeywordSearch(
  query: string,
  options: EnhancedSearchOptions
): Promise<PaperWithAuthors[]> {
  console.log(`Performing keyword search for: "${query}"`)
  
  const supabase = await createClient()
  const { data: papers, error } = await supabase
    .from('papers')
    .select(`
      *,
      authors:paper_authors(
        ordinal,
        author:authors(*)
      )
    `)
    .textSearch('search_vector', query, { type: 'websearch' })
    .order('citation_count', { ascending: false })
    .limit(options.maxResults || 10)
  
  if (error) throw error
  
  // Transform the data to include authors in the correct format
  const transformedPapers: PaperWithAuthors[] = (papers || []).map((paper: {
    id: string
    title: string
    abstract?: string
    publication_date?: string
    venue?: string
    doi?: string
    url?: string
    pdf_url?: string
    metadata?: unknown
    source?: string
    citation_count?: number
    impact_score?: number
    created_at: string
    authors?: Array<{
      ordinal: number
      author: { id: string; name: string }
    }>
  }) => {
    const authors = paper.authors
      ?.sort((a, b) => a.ordinal - b.ordinal)
      ?.map((pa) => pa.author) || []
    
    return {
      ...paper,
      authors,
      author_names: authors.map((a) => a.name)
    } as PaperWithAuthors
  })
  
  console.log(`Keyword search found ${papers.length} papers`)
  return transformedPapers
}

// Academic API search using our new services
async function performAcademicSearch(
  query: string,
  options: EnhancedSearchOptions
): Promise<RankedPaper[]> {
  console.log(`Performing academic API search for: "${query}"`)
  const result = await searchAndIngestPapers(query, options)
  console.log(`Academic search found and ingested ${result.papers.length} papers`)
  return result.papers
}

// Combine and deduplicate results from multiple search strategies
function combineSearchResults(
  vectorResults: PaperWithAuthors[],
  keywordResults: PaperWithAuthors[],
  academicResults: RankedPaper[],
  options: EnhancedSearchOptions
): Array<PaperWithAuthors & { 
  searchType: 'vector' | 'keyword' | 'academic'
  relevanceScore?: number
  combinedScore?: number
}> {
  const { vectorWeight = 1.0, academicWeight = 0.8, maxResults = 25 } = options
  
  // Create a map to track unique papers by ID
  const paperMap = new Map<string, PaperWithAuthors & { 
    searchType: 'vector' | 'keyword' | 'academic'
    relevanceScore: number
    combinedScore: number
  }>()
  
  // Add vector results with high weight
  vectorResults.forEach((paper, index) => {
    const score = (vectorResults.length - index) * vectorWeight
    paperMap.set(paper.id, {
      ...paper,
      searchType: 'vector' as const,
      relevanceScore: score,
      combinedScore: score
    })
  })
  
  // Add keyword results, combining if already exists
  keywordResults.forEach((paper, index) => {
    const score = (keywordResults.length - index) * 0.7 // Lower base weight
    const existing = paperMap.get(paper.id)
    
    if (existing) {
      // Boost existing papers found in multiple searches
      existing.combinedScore += score * 0.5
      existing.searchType = 'vector' // Keep primary type
    } else {
      paperMap.set(paper.id, {
        ...paper,
        searchType: 'keyword' as const,
        relevanceScore: score,
        combinedScore: score
      })
    }
  })
  
  // Add academic results, combining if already exists
  academicResults.forEach((paper) => {
    // Fix: Generate proper UUID for paper ID instead of using raw DOI
    const key = paper.doi 
      ? generatePaperUUID(paper.doi)
      : generatePaperUUID(paper.canonical_id)
    const score = paper.combinedScore * academicWeight
    
    const existing = paperMap.get(key)
    
    if (existing) {
      // Boost existing papers
      existing.combinedScore += score * 0.3
    } else {
      // Convert academic paper to our format
      paperMap.set(key, {
        id: key, // Now a valid UUID
        title: paper.title,
        abstract: paper.abstract,
        publication_date: paper.year ? `${paper.year}-01-01` : undefined,
        venue: paper.venue,
        doi: paper.doi,
        url: paper.url,
        pdf_url: paper.pdf_url,
        metadata: {
          canonical_id: paper.canonical_id,
          api_source: paper.source
        },
        source: `academic_search_${paper.source}`,
        citation_count: paper.citationCount,
        impact_score: paper.combinedScore > 0 ? 1 - 1 / (paper.combinedScore + 1) : 0, // Fix: Normalize to 0-1 range
        created_at: new Date().toISOString(),
        authors: [],
        author_names: paper.authors || [],
        searchType: 'academic' as const,
        relevanceScore: paper.relevanceScore || 0,
        combinedScore: score
      })
    }
  })
  
  // Sort by combined score and return top results
  const combined = Array.from(paperMap.values())
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, maxResults)
  
  console.log(`Combined ${vectorResults.length} vector + ${keywordResults.length} keyword + ${academicResults.length} academic results into ${combined.length} papers`)
  
  return combined
}

// Check if search results are relevant to the query
async function checkResultRelevance(
  query: string, 
  papers: PaperWithAuthors[]
): Promise<{ isRelevant: boolean; reason: string }> {
  if (papers.length === 0) {
    return { isRelevant: false, reason: 'No results returned' }
  }
  
  // Check for obvious topic mismatches by analyzing titles
  const queryLower = query.toLowerCase()
  const queryKeywords = queryLower.split(/\s+/).filter(word => word.length > 3)
  
  // Extract key technical terms that should appear in relevant papers
  const technicalTerms = new Set<string>()
  if (queryLower.includes('virtual reality') || queryLower.includes('vr')) {
    technicalTerms.add('virtual')
    technicalTerms.add('reality')
    technicalTerms.add('vr')
    technicalTerms.add('immersive')
    technicalTerms.add('3d')
  }
  if (queryLower.includes('augmented reality') || queryLower.includes('ar')) {
    technicalTerms.add('augmented')
    technicalTerms.add('reality')
    technicalTerms.add('ar')
    technicalTerms.add('mixed')
  }
  if (queryLower.includes('drone') || queryLower.includes('uav')) {
    technicalTerms.add('drone')
    technicalTerms.add('uav')
    technicalTerms.add('autonomous')
    technicalTerms.add('unmanned')
  }
  if (queryLower.includes('artificial intelligence') || queryLower.includes('ai') || queryLower.includes('machine learning')) {
    technicalTerms.add('artificial')
    technicalTerms.add('intelligence')
    technicalTerms.add('machine')
    technicalTerms.add('learning')
    technicalTerms.add('neural')
    technicalTerms.add('deep')
  }
  
  // Check if any papers contain relevant terms
  let relevantPapers = 0
  for (const paper of papers) {
    const titleLower = (paper.title || '').toLowerCase()
    const abstractLower = (paper.abstract || '').toLowerCase()
    const combinedText = titleLower + ' ' + abstractLower
    
    // Check for query keywords
    const hasQueryKeywords = queryKeywords.some(keyword => 
      combinedText.includes(keyword)
    )
    
    // Check for technical terms
    const hasTechnicalTerms = technicalTerms.size > 0 && 
      Array.from(technicalTerms).some(term => combinedText.includes(term))
    
    if (hasQueryKeywords || hasTechnicalTerms) {
      relevantPapers++
    }
  }
  
  const relevanceRatio = relevantPapers / papers.length
  
  // If less than 30% of papers are relevant, consider results irrelevant
  if (relevanceRatio < 0.3) {
    return { 
      isRelevant: false, 
      reason: `Only ${relevantPapers}/${papers.length} papers (${(relevanceRatio * 100).toFixed(1)}%) appear relevant to query` 
    }
  }
  
  // Special check for VR/AR queries returning biology/agriculture papers
  if ((queryLower.includes('virtual') || queryLower.includes('augmented') || queryLower.includes('reality')) && 
      papers.some(p => {
        const text = ((p.title || '') + ' ' + (p.abstract || '')).toLowerCase()
        return text.includes('plant') || text.includes('tomato') || text.includes('agriculture') || 
               text.includes('mycorrhiza') || text.includes('rumen') || text.includes('microorganism')
      })) {
    return { 
      isRelevant: false, 
      reason: 'VR/AR query returned biology/agriculture papers - embedding mismatch' 
    }
  }
  
  return { isRelevant: true, reason: `${relevantPapers}/${papers.length} papers appear relevant` }
}

// Main enhanced search function
export async function enhancedSearch(
  query: string,
  options: EnhancedSearchOptions = {}
): Promise<EnhancedSearchResult> {
  const {
    useSemanticSearch = true,
    fallbackToKeyword = true,
    fallbackToAcademic = true,
    forceIngest = false,
    minResults = 10,
    combineResults = true
  } = options
  
  console.log(`Starting enhanced search for: "${query}"`)
  console.log(`Options:`, { useSemanticSearch, fallbackToKeyword, fallbackToAcademic, forceIngest, minResults })
  
  let vectorResults: PaperWithAuthors[] = []
  let keywordResults: PaperWithAuthors[] = []
  let academicResults: RankedPaper[] = []
  const searchStrategies: string[] = []

  // Force ingest: Skip vector/keyword search and go straight to academic APIs
  if (forceIngest) {
    console.log('Force ingest mode: skipping vector/keyword search')
    academicResults = await performAcademicSearch(query, options)
    academicResults = deduplicatePapers(academicResults)
    searchStrategies.push('academic')
  } else {
    // 1. Try vector/semantic search first
    if (useSemanticSearch) {
      vectorResults = await performVectorSearch(query, options)
      vectorResults = deduplicatePapers(vectorResults)
      searchStrategies.push('vector')
      
      // Check if vector results are relevant - if all semantic scores are 0, results are likely irrelevant
      const vectorRelevance = await checkResultRelevance(query, vectorResults)
      if (!vectorRelevance.isRelevant) {
        console.warn(`⚠️ Vector search returned irrelevant results - ${vectorRelevance.reason}`)
        console.warn(`🔄 Forcing academic search for better results`)
        vectorResults = [] // Clear irrelevant results
      }
    }
    
    // 2. Fallback to keyword search if needed
    if (fallbackToKeyword && vectorResults.length < minResults) {
      keywordResults = await performKeywordSearch(query, options)
      // Deduplicate keyword results against vector results
      const vectorIds = new Set(vectorResults.map(p => p.id))
      keywordResults = keywordResults.filter(p => !vectorIds.has(p.id))
      keywordResults = deduplicatePapers(keywordResults)
      searchStrategies.push('keyword')
    }
    
    // 3. Fallback to academic API search if still not enough results
    const totalExistingResults = vectorResults.length + keywordResults.length
    if (fallbackToAcademic && totalExistingResults < minResults) {
      academicResults = await performAcademicSearch(query, options)
      // Deduplicate academic results against existing papers
      const existingIds = new Set([
        ...vectorResults.map(p => p.id),
        ...keywordResults.map(p => p.id)
      ])
      const existingDois = new Set([
        ...vectorResults.map(p => p.doi).filter(Boolean),
        ...keywordResults.map(p => p.doi).filter(Boolean)
      ])
      academicResults = academicResults.filter(p => 
        !existingIds.has(p.canonical_id) && 
        !existingIds.has(p.doi || '') &&
        !existingDois.has(p.doi || '')
      )
      academicResults = deduplicatePapers(academicResults)
      searchStrategies.push('academic')
    }
  }
  
  // 4. Combine results if requested
  let finalPapers: Array<PaperWithAuthors & { 
    searchType: 'vector' | 'keyword' | 'academic'
    relevanceScore?: number
    combinedScore?: number
  }>
  
  if (combineResults) {
    finalPapers = combineSearchResults(vectorResults, keywordResults, academicResults, options)
  } else {
    // Just concatenate in priority order
    finalPapers = [
      ...vectorResults.map(p => ({ ...p, searchType: 'vector' as const })),
      ...keywordResults.map(p => ({ ...p, searchType: 'keyword' as const })),
      ...academicResults.map(p => ({ 
        ...p,
        id: p.doi ? generatePaperUUID(p.doi) : generatePaperUUID(p.canonical_id),
        publication_date: p.year ? `${p.year}-01-01` : undefined,
        created_at: new Date().toISOString(),
        authors: [],
        author_names: p.authors || [],  
        searchType: 'academic' as const,
        relevanceScore: p.relevanceScore || 0,
        combinedScore: p.combinedScore
      }))
    ].slice(0, options.maxResults || 25)
  }
  
  // 5. Apply regional boosting if localRegion is specified
  if (options.localRegion) {
    console.log(`Applying regional boost for: ${options.localRegion}`)
    
    // Partition papers by region
    const localPapers: typeof finalPapers = []
    const otherPapers: typeof finalPapers = []
    
    for (const paper of finalPapers) {
      const paperRegion = paper.metadata && typeof paper.metadata === 'object' && 'region' in paper.metadata 
        ? (paper.metadata as { region?: string }).region 
        : undefined
      
      if (paperRegion === options.localRegion) {
        localPapers.push(paper)
      } else {
        otherPapers.push(paper)
      }
    }
    
    // Reorder: local papers first, then others
    finalPapers = [...localPapers, ...otherPapers]
    
    console.log(`Regional boost applied: ${localPapers.length} local papers, ${otherPapers.length} other papers`)
  }
  
  const metadata = {
    vectorResults: vectorResults.length,
    keywordResults: keywordResults.length, 
    academicResults: academicResults.length,
    totalResults: finalPapers.length,
    searchStrategies,
    cached: false // This would be set by the calling API if results were cached
  }
  
  console.log(`Enhanced search completed:`, metadata)
  
  return {
    papers: finalPapers,
    metadata
  }
}

// Convenience function for simple searches
export async function quickAcademicSearch(query: string, maxResults: number = 10): Promise<PaperWithAuthors[]> {
  const result = await enhancedSearch(query, {
    maxResults,
    useSemanticSearch: true,
    fallbackToKeyword: true,
    fallbackToAcademic: true,
    minResults: Math.min(5, maxResults),
    combineResults: true,
    sources: ['openalex', 'crossref', 'semantic_scholar'] as PaperSources
  })
  
  return result.papers
}

// Function to refresh academic content for a topic
export async function refreshAcademicContent(
  query: string,
  options: AggregatedSearchOptions = {}
): Promise<{ newPapers: number, updatedPapers: number }> {
  console.log(`Refreshing academic content for: "${query}"`)
  
  const result = await searchAndIngestPapers(query, {
    ...options,
    sources: ['openalex', 'crossref', 'semantic_scholar'] as PaperSources,
    maxResults: 50 // Get more for refresh
  })
  
  const newPapers = result.ingestedIds.length
  
  // TODO: Add logic to update existing papers with new citation counts, etc.
  const updatedPapers = 0
  
  console.log(`Refresh complete: ${newPapers} new papers, ${updatedPapers} updated`)
  
  return { newPapers, updatedPapers }
} 