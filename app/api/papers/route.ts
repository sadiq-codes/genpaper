import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchAndIngestPapers } from '@/lib/services/paper-aggregation'
import { z } from 'zod'
import { shortHash } from '@/lib/utils/hash'
import {
  requireAuth,
  badRequest,
  handleError,
} from '@/lib/api/helpers'

// Force Node.js runtime for pdf-parse compatibility in tiered-extractor
export const runtime = 'nodejs'

// ============================================================================
// Validation Schema
// ============================================================================

const PapersRequestSchema = z.object({
  // Search external papers
  search: z.string().optional(),
  sources: z.array(z.enum(['openalex', 'crossref', 'semantic_scholar', 'arxiv', 'core'])).optional(),
  maxResults: z.number().int().min(1).max(100).optional().default(25),
  
  // Filter user's library
  library: z.enum(['me']).optional(),
  collection: z.string().optional(),
  
  // Batch retrieval
  ids: z.array(z.string()).optional(),
  
  // Search options
  includePreprints: z.boolean().optional().default(true),
  fromYear: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
  toYear: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
  openAccessOnly: z.boolean().optional().default(false),
  
  // Sorting
  sortBy: z.enum(['relevance', 'date', 'citations', 'added_at']).optional().default('relevance'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  
  // Processing options
  ingest: z.boolean().optional().default(true),
})

// ============================================================================
// Types
// ============================================================================

interface PaperData {
  id: string
  title: string
  abstract: string | null
  publication_date: string | null
  venue: string | null
  doi: string | null
  pdf_url: string | null
  metadata: Record<string, unknown> | null
  source: string | null
  citation_count: number | null
  created_at: string
  authors?: string[]
}

// ============================================================================
// Helpers
// ============================================================================

function generateCacheKey(params: Record<string, unknown>): string {
  const keyData = JSON.stringify(params)
  return shortHash(keyData)
}

function parseQueryParams(url: URL): z.infer<typeof PapersRequestSchema> {
  return {
    search: url.searchParams.get('search') || undefined,
    sources: url.searchParams.get('sources')?.split(',') as ('openalex' | 'crossref' | 'semantic_scholar' | 'arxiv' | 'core')[] | undefined,
    maxResults: parseInt(url.searchParams.get('maxResults') || '25'),
    library: url.searchParams.get('library') as 'me' | undefined,
    collection: url.searchParams.get('collection') || undefined,
    ids: url.searchParams.get('ids')?.split(',') || undefined,
    includePreprints: url.searchParams.get('includePreprints') !== 'false',
    fromYear: url.searchParams.get('fromYear') ? parseInt(url.searchParams.get('fromYear')!) : undefined,
    toYear: url.searchParams.get('toYear') ? parseInt(url.searchParams.get('toYear')!) : undefined,
    openAccessOnly: url.searchParams.get('openAccessOnly') === 'true',
    sortBy: (url.searchParams.get('sortBy') as 'relevance' | 'date' | 'citations' | 'added_at') || 'relevance',
    sortOrder: (url.searchParams.get('sortOrder') as 'asc' | 'desc') || 'desc',
    ingest: url.searchParams.get('ingest') !== 'false',
  }
}

// ============================================================================
// GET Handler
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth()
    const supabase = await createClient()

    // Parse and validate query parameters
    const url = new URL(request.url)
    const queryParams = parseQueryParams(url)
    const validationResult = PapersRequestSchema.safeParse(queryParams)
    
    if (!validationResult.success) {
      const details = validationResult.error.errors.map(e => ({
        path: e.path.join('.'),
        message: e.message,
      }))
      return badRequest(`Invalid query parameters: ${details.map(d => d.message).join(', ')}`)
    }

    const params = validationResult.data

    // Route 1: Batch paper retrieval by IDs
    if (params.ids && params.ids.length > 0) {
      return handleBatchRetrieval(supabase, user.id, params.ids)
    }

    // Route 2: User's library papers
    if (params.library === 'me') {
      return handleLibraryQuery(supabase, user.id, params)
    }

    // Route 3: External paper search
    if (params.search) {
      return handleExternalSearch(supabase, params)
    }

    // No valid query provided
    return badRequest('Must provide search query, library=me, or ids parameter')
  } catch (error) {
    return handleError(error, 'Error in papers API')
  }
}

// ============================================================================
// Route Handlers
// ============================================================================

async function handleBatchRetrieval(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  ids: string[]
) {
  // Batch query 1: Get all papers
  const { data: papersData, error: papersError } = await supabase
    .from('papers')
    .select('*')
    .in('id', ids)
  
  if (papersError) throw papersError
  if (!papersData || papersData.length === 0) {
    return NextResponse.json({
      papers: [],
      count: 0,
      source: 'batch_retrieval',
    })
  }
  
  // Batch query 2: Check library status for all papers at once
  const { data: libraryData } = await supabase
    .from('library_papers')
    .select('paper_id')
    .eq('user_id', userId)
    .in('paper_id', ids)
  
  const libraryPaperIds = new Set(libraryData?.map(l => l.paper_id) || [])
  
  // Batch query 3: Get citation counts for all papers at once
  const { data: citationData } = await supabase
    .from('project_citations')
    .select('paper_id')
    .in('paper_id', ids)
  
  // Count citations per paper
  const citationCounts = new Map<string, number>()
  for (const c of citationData || []) {
    citationCounts.set(c.paper_id, (citationCounts.get(c.paper_id) || 0) + 1)
  }
  
  // Combine results
  const papers = papersData.map(paper => ({
    ...paper,
    inLibrary: libraryPaperIds.has(paper.id),
    usageStats: {
      citedInProjects: citationCounts.get(paper.id) || 0,
    },
  }))
  
  return NextResponse.json({
    papers,
    count: papers.length,
    source: 'batch_retrieval',
  })
}

async function handleLibraryQuery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  params: z.infer<typeof PapersRequestSchema>
) {
  let query = supabase
    .from('library_papers')
    .select(`
      id,
      paper_id,
      notes,
      added_at,
      papers:paper_id (
        id,
        title,
        abstract,
        publication_date,
        venue,
        doi,
        pdf_url,
        metadata,
        source,
        citation_count,
        created_at,
        authors
      )
    `)
    .eq('user_id', userId)

  if (params.search) {
    query = query.or(`notes.ilike.%${params.search}%,papers.title.ilike.%${params.search}%`)
  }

  if (params.collection) {
    query = query.eq('collection_id', params.collection)
  }

  // Sort library papers
  if (params.sortBy === 'added_at') {
    query = query.order('added_at', { ascending: params.sortOrder === 'asc' })
  } else if (params.sortBy === 'date') {
    query = query.order('publication_date', { foreignTable: 'papers', ascending: params.sortOrder === 'asc' })
  } else if (params.sortBy === 'citations') {
    query = query.order('citation_count', { foreignTable: 'papers', ascending: params.sortOrder === 'asc' })
  }

  const { data: papers, error } = await query

  if (error) throw error

  const transformedPapers = (papers || []).map((item) => {
    const paperData = item.papers as unknown as PaperData
    const authors = Array.isArray(paperData.authors) ? paperData.authors : []
    return {
      ...item,
      paper: {
        ...paperData,
        authors,
        author_names: authors,
      },
    }
  })

  return NextResponse.json({
    papers: transformedPapers,
    count: transformedPapers.length,
    source: 'user_library',
  })
}

async function handleExternalSearch(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: z.infer<typeof PapersRequestSchema>
) {
  const cacheKey = generateCacheKey(params)
  
  // Check for cached results (last 24 hours)
  const { data: cachedResults, error: cacheError } = await supabase
    .from('papers_api_cache')
    .select('response, fetched_at')
    .eq('id', cacheKey)
    .gte('fetched_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .single()

  if (!cacheError && cachedResults) {
    console.log('API: Returning cached search results')
    const cachedResponse = cachedResults.response as Record<string, unknown>
    return NextResponse.json({
      ...cachedResponse,
      cached: true,
      source: 'external_search_cached',
    })
  }

  // Perform external search
  const result = await searchAndIngestPapers(params.search!, {
    maxResults: params.maxResults,
    sources: params.sources,
    includePreprints: params.includePreprints,
    fromYear: params.fromYear,
    toYear: params.toYear,
    openAccessOnly: params.openAccessOnly,
  })

  const response = {
    success: true,
    papers: result.papers.map(paper => ({
      canonical_id: paper.canonical_id,
      title: paper.title,
      abstract: paper.abstract?.substring(0, 500),
      year: paper.year,
      venue: paper.venue,
      doi: paper.doi,
      url: paper.url,
      citationCount: paper.citationCount,
      relevanceScore: paper.relevanceScore,
      source: paper.source,
    })),
    count: result.papers.length,
    cached: false,
    source: 'external_search',
    ingestedIds: params.ingest ? result.ingestedIds : undefined,
  }

  // Cache successful response
  if (result.papers.length > 0) {
    try {
      await supabase
        .from('papers_api_cache')
        .upsert({
          id: cacheKey,
          query_params: params,
          response,
          fetched_at: new Date().toISOString(),
        })
    } catch (cacheError) {
      console.warn('Failed to cache search results:', cacheError)
    }
  }

  return NextResponse.json(response)
}
