import 'server-only'

import { hybridSearchPapers } from '@/lib/db/papers'
import { getSB } from '@/lib/supabase/server'
import type { PaperWithAuthors, PaperSource } from '@/types/simplified'
import type { AggregatedSearchOptions } from '@/lib/services/paper-aggregation'
import { DEFAULT_WEIGHTS } from '@/lib/services/paper-aggregation'
import pLimit from 'p-limit'
import { generateDeterministicAuthorId, generateDeterministicPaperId } from '@/lib/utils/deterministic-id'
import { searchAndIngestPapers } from '@/lib/services/paper-aggregation'

/**
 * @services/search-orchestrator
 * 
 * Simplified unified search: Hybrid + Academic APIs + Fallbacks with quality preservation
 * Maintains parallel execution, fallback chain, and regional boosting
 */

// Simplified search options - keeping only essential quality features
export interface UnifiedSearchOptions {
  maxResults?: number
  minResults?: number
  excludePaperIds?: string[]
  fromYear?: number
  localRegion?: string
  sources?: PaperSource[]
  semanticWeight?: number
  authorityWeight?: number
  recencyWeight?: number
}

export interface UnifiedSearchResult {
  papers: PaperWithAuthors[]
  metadata: {
    totalFound: number
    searchStrategies: string[]
    errors: string[]
  }
}

// Simple deduplication helper
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

// Convert RankedPaper to PaperWithAuthors format
function convertRankedToPaperWithAuthors(paper: any): PaperWithAuthors {
  return {
    id: paper.canonical_id || generateDeterministicPaperId({
      doi: paper.doi,
      title: paper.title,
      authors: paper.authors,
      year: paper.year
    }),
    title: paper.title,
    abstract: paper.abstract || '',
    publication_date: paper.year ? `${paper.year}-01-01` : new Date().toISOString(),
    venue: paper.venue || '',
    doi: paper.doi || '',
    pdf_url: paper.pdf_url || '',
    metadata: {
      api_source: paper.source,
      relevance_score: paper.relevanceScore,
      combined_score: paper.combinedScore,
      canonical_id: paper.canonical_id
    },
    created_at: new Date().toISOString(),
    authors: paper.authors?.map((author: unknown) => {
      const authorName = typeof author === 'string' ? author : 
        (typeof author === 'object' && author && 'name' in author ? (author as { name: string }).name : 'Unknown')
      const authorAffiliation = typeof author === 'object' && author && 'affiliation' in author ? 
        (author as { affiliation?: string }).affiliation : undefined
      
      return {
        id: generateDeterministicAuthorId({ name: authorName, affiliation: authorAffiliation }),
        name: authorName,
        affiliation: authorAffiliation
      }
    }) || [],
    author_names: paper.authors?.map((author: unknown) => 
      typeof author === 'string' ? author : 
      (typeof author === 'object' && author && 'name' in author ? (author as { name: string }).name : 'Unknown')
    ) || []
  }
}

// Regional boosting helper - KEEP FOR QUALITY
function applyRegionalBoost(papers: PaperWithAuthors[], localRegion: string): PaperWithAuthors[] {
  const localPapers: PaperWithAuthors[] = []
  const otherPapers: PaperWithAuthors[] = []

  for (const paper of papers) {
    if (paper.metadata?.region === localRegion) {
      localPapers.push(paper)
    } else {
      otherPapers.push(paper)
    }
  }

  return localPapers.length > 0 ? [...localPapers, ...otherPapers] : papers
}



/**
 * Simplified Unified Search - Preserves quality while reducing complexity
 * Maintains: Parallel execution, fallback chain, regional boosting, deduplication
 */
export async function unifiedSearch(
  query: string,
  options: UnifiedSearchOptions = {}
): Promise<UnifiedSearchResult> {
  const {
    maxResults = 20,
    minResults = 5,
    excludePaperIds = [],
    fromYear = 2000,
    localRegion,
    sources = ['openalex', 'crossref', 'semantic_scholar'],
    semanticWeight = DEFAULT_WEIGHTS.semanticWeight,
    authorityWeight = DEFAULT_WEIGHTS.authorityWeight,
    recencyWeight = DEFAULT_WEIGHTS.recencyWeight
  } = options

  console.log(`🔍 Starting unified search: "${query}"`)
  
  const searchStrategies: string[] = []
  const errors: string[] = []
  const limit = pLimit(3) // Simple concurrency control

  // PARALLEL EXECUTION - Critical for performance
  const [hybridResult, academicResult] = await Promise.allSettled([
    limit(async () => {
      try {
        const papers = await hybridSearchPapers(query, {
          limit: maxResults * 2,
          excludePaperIds,
          minYear: fromYear,
          semanticWeight
        })
        return { papers, strategy: 'hybrid' }
      } catch (error) {
        console.warn('Hybrid search failed:', error)
        return { papers: [], strategy: 'hybrid', error: String(error) }
      }
    }),
    
    limit(async () => {
      try {
        const academicOptions: AggregatedSearchOptions = {
          maxResults: maxResults * 2,
          sources,
          semanticWeight,
          authorityWeight,
          recencyWeight
        }
        
        const { papers: rankedPapers } = await searchAndIngestPapers(query, academicOptions)
        
        // Convert to PaperWithAuthors format using helper
        const convertedPapers: PaperWithAuthors[] = rankedPapers.map(convertRankedToPaperWithAuthors)
        
        return { papers: convertedPapers, strategy: 'academic_apis' }
      } catch (error) {
        console.warn('Academic API search failed:', error)
        return { papers: [], strategy: 'academic_apis', error: String(error) }
      }
    })
  ])

  // Collect results
  let allPapers: PaperWithAuthors[] = []
  
  if (hybridResult.status === 'fulfilled' && hybridResult.value.papers.length > 0) {
    allPapers.push(...hybridResult.value.papers)
    searchStrategies.push('hybrid')
  } else if (hybridResult.status === 'rejected' || hybridResult.value.error) {
    errors.push(hybridResult.status === 'rejected' ? String(hybridResult.reason) : hybridResult.value.error!)
  }
  
  if (academicResult.status === 'fulfilled' && academicResult.value.papers.length > 0) {
    allPapers.push(...academicResult.value.papers)
    searchStrategies.push('academic_apis')
  } else if (academicResult.status === 'rejected' || academicResult.value.error) {
    errors.push(academicResult.status === 'rejected' ? String(academicResult.reason) : academicResult.value.error!)
  }

  // DEDUPLICATION - Critical for quality
  allPapers = dedupePapers(allPapers)

  // KEYWORD FALLBACK - Critical for result completeness
  if (allPapers.length < minResults) {
    try {
      console.log('🔤 Executing keyword search fallback...')
      const supabase = await getSB()
      
      // Build exclusion list and apply NOT IN only if not empty
      const exclusionIds = [...excludePaperIds, ...allPapers.map(p => p.id)]
      
      // Validate UUIDs to prevent injection (UUID format: 8-4-4-4-12 hex chars)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      const validExclusionIds = exclusionIds.filter(id => id && uuidRegex.test(id))
      
      // Escape the query for FTS to prevent injection
      const sanitizedQuery = query.replace(/['"\\]/g, ' ').trim()
      
      let keywordQuery = supabase
        .from('papers')
        .select(`
          id, title, abstract, publication_date, venue, doi, pdf_url, created_at, authors
        `)
        .or(`title.fts.${sanitizedQuery},abstract.fts.${sanitizedQuery},venue.fts.${sanitizedQuery}`)
      
      // Only apply NOT IN filter if we have valid UUIDs to exclude
      if (validExclusionIds.length > 0) {
        keywordQuery = keywordQuery.not('id', 'in', `(${validExclusionIds.join(',')})`)
      }
      
      const { data: keywordPapers, error } = await keywordQuery
        .order('created_at', { ascending: false })
        .limit(maxResults)

      if (!error && keywordPapers?.length) {
        const formattedKeywordPapers: PaperWithAuthors[] = keywordPapers.map(paper => {
          const authors = Array.isArray(paper.authors) ? paper.authors : []
          return {
            ...paper,
            authors: authors.map((name: string) => ({ id: '', name })),
            author_names: authors
          }
        })

        const existingIds = new Set(allPapers.map(p => p.id))
        const newKeywordPapers = formattedKeywordPapers.filter(p => !existingIds.has(p.id))
        
        allPapers.push(...newKeywordPapers)
        if (newKeywordPapers.length > 0) searchStrategies.push('keyword')
        console.log(`✅ Keyword fallback: ${newKeywordPapers.length} papers`)
      }
    } catch (error) {
      console.warn('Keyword search failed:', error)
      errors.push(`Keyword search failed: ${String(error)}`)
    }
  }

  // REGIONAL BOOSTING - Critical for relevance
  if (localRegion) {
    allPapers = applyRegionalBoost(allPapers, localRegion)
    console.log(`🌍 Applied regional boosting for: ${localRegion}`)
  }

  // Final result preparation
  const finalPapers = allPapers.slice(0, maxResults)
  console.log(`✅ Search completed: ${finalPapers.length} papers (strategies: ${searchStrategies.join(', ')})`)

  return {
    papers: finalPapers,
    metadata: {
      totalFound: finalPapers.length,
      searchStrategies,
      errors
    }
  }
}

/**
 * Simplified SearchOrchestrator API
 */
// NOTE: Removed SearchOrchestrator class wrapper to avoid duplicate APIs.
// Prefer importing and using unifiedSearch directly.