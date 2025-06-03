import { searchAndIngestPapers, type AggregatedSearchOptions, type RankedPaper } from './paper-aggregation'
import { semanticSearchPapers, hybridSearchPapers } from '@/lib/db/papers'
import { createClient } from '@/lib/supabase/server'
import type { PaperWithAuthors } from '@/types/simplified'

// Enhanced search options that combine vector and academic search
export interface EnhancedSearchOptions extends AggregatedSearchOptions {
  useSemanticSearch?: boolean
  fallbackToKeyword?: boolean
  fallbackToAcademic?: boolean
  minResults?: number
  combineResults?: boolean
  vectorWeight?: number
  academicWeight?: number
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
      minYear: options.fromYear || 2018,
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
        minYear: options.fromYear || 2018,
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
    .textSearch('search_vector', query)
    .order('citation_count', { ascending: false })
    .limit(options.maxResults || 10)
  
  if (error) throw error
  
  // Transform the data to include authors in the correct format
  const transformedPapers: PaperWithAuthors[] = (papers || []).map((paper: any) => {
    const authors = paper.authors
      ?.sort((a: any, b: any) => a.ordinal - b.ordinal)
      ?.map((pa: any) => pa.author) || []
    
    return {
      ...paper,
      authors,
      author_names: authors.map((a: any) => a.name)
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
    // Use paper.canonical_id as the key for academic papers since they might not have our DB ID yet
    const key = paper.doi || paper.canonical_id
    const score = paper.combinedScore * academicWeight
    
    const existing = paperMap.get(key)
    
    if (existing) {
      // Boost existing papers
      existing.combinedScore += score * 0.3
    } else {
      // Convert academic paper to our format
      paperMap.set(key, {
        id: key,
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
        impact_score: paper.combinedScore,
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

// Main enhanced search function
export async function enhancedSearch(
  query: string,
  options: EnhancedSearchOptions = {}
): Promise<EnhancedSearchResult> {
  const {
    useSemanticSearch = true,
    fallbackToKeyword = true,
    fallbackToAcademic = true,
    minResults = 10,
    combineResults = true
  } = options
  
  console.log(`Starting enhanced search for: "${query}"`)
  console.log(`Options:`, { useSemanticSearch, fallbackToKeyword, fallbackToAcademic, minResults })
  
  let vectorResults: PaperWithAuthors[] = []
  let keywordResults: PaperWithAuthors[] = []
  let academicResults: RankedPaper[] = []
  const searchStrategies: string[] = []
  
  // 1. Try vector/semantic search first
  if (useSemanticSearch) {
    vectorResults = await performVectorSearch(query, options)
    searchStrategies.push('vector')
  }
  
  // 2. Fallback to keyword search if needed
  if (fallbackToKeyword && vectorResults.length < minResults) {
    keywordResults = await performKeywordSearch(query, options)
    searchStrategies.push('keyword')
  }
  
  // 3. Fallback to academic API search if still not enough results
  const totalExistingResults = vectorResults.length + keywordResults.length
  if (fallbackToAcademic && totalExistingResults < minResults) {
    academicResults = await performAcademicSearch(query, options)
    searchStrategies.push('academic')
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
        id: p.doi || p.canonical_id,
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
    sources: ['openalex', 'crossref', 'semantic_scholar']
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
    sources: ['openalex', 'crossref', 'semantic_scholar'],
    maxResults: 50 // Get more for refresh
  })
  
  const newPapers = result.ingestedIds.length
  
  // TODO: Add logic to update existing papers with new citation counts, etc.
  const updatedPapers = 0
  
  console.log(`Refresh complete: ${newPapers} new papers, ${updatedPapers} updated`)
  
  return { newPapers, updatedPapers }
} 