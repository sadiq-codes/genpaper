import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchAndIngestPapers } from '@/lib/services/paper-aggregation'
import { z } from 'zod'
import { shortHash } from '@/lib/utils/hash'
import { getPaper } from '@/lib/db/papers'
import { isInLibrary } from '@/lib/db/library'

// Force Node.js runtime for pdf-parse compatibility in tiered-extractor
export const runtime = 'nodejs'

// Unified query parameters schema
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
  ingest: z.boolean().optional().default(true)
})

interface PaperAuthorRelation {
  ordinal: number
  authors: {
    id: string
    name: string
  }
}

interface PaperData {
  id: string
  title: string
  abstract: string | null
  publication_date: string | null
  venue: string | null
  doi: string | null
  url: string | null
  pdf_url: string | null
  metadata: Record<string, unknown> | null
  source: string | null
  citation_count: number | null
  impact_score: number | null
  created_at: string
  paper_authors?: PaperAuthorRelation[]
}

function generateCacheKey(params: Record<string, unknown>): string {
  const keyData = JSON.stringify(params)
  return shortHash(keyData)
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse query parameters
    const url = new URL(request.url)
    const queryParams = {
      search: url.searchParams.get('search') || undefined,
      sources: url.searchParams.get('sources')?.split(',') || undefined,
      maxResults: parseInt(url.searchParams.get('maxResults') || '25'),
      library: url.searchParams.get('library') as 'me' | undefined,
      collection: url.searchParams.get('collection') || undefined,
      ids: url.searchParams.get('ids')?.split(',') || undefined,
      includePreprints: url.searchParams.get('includePreprints') !== 'false',
      fromYear: url.searchParams.get('fromYear') ? parseInt(url.searchParams.get('fromYear')!) : undefined,
      toYear: url.searchParams.get('toYear') ? parseInt(url.searchParams.get('toYear')!) : undefined,
      openAccessOnly: url.searchParams.get('openAccessOnly') === 'true',
      sortBy: url.searchParams.get('sortBy') as 'relevance' | 'date' | 'citations' | 'added_at' || 'relevance',
      sortOrder: url.searchParams.get('sortOrder') as 'asc' | 'desc' || 'desc',
      ingest: url.searchParams.get('ingest') !== 'false'
    }

    const validationResult = PapersRequestSchema.safeParse(queryParams)
    
    if (!validationResult.success) {
      return NextResponse.json(
        { 
          error: 'Invalid query parameters',
          details: validationResult.error.errors.map(e => ({
            path: e.path.join('.'),
            message: e.message
          }))
        },
        { status: 400 }
      )
    }

    const params = validationResult.data

    // Route 1: Batch paper retrieval by IDs
    if (params.ids && params.ids.length > 0) {
      const papers = await Promise.all(
        params.ids.map(async (id) => {
          const paper = await getPaper(id)
          if (!paper) return null
          
          const inLibrary = await isInLibrary(user.id, id)
          
          // Get usage statistics
          const { data: citationStats } = await supabase
            .from('project_citations')
            .select('id')
            .eq('paper_id', id)
          
          return {
            ...paper,
            inLibrary,
            usageStats: {
              citedInProjects: citationStats?.length || 0
            }
          }
        })
      )
      
      return NextResponse.json({
        papers: papers.filter(Boolean),
        count: papers.filter(Boolean).length,
        source: 'batch_retrieval'
      })
    }

    // Route 2: User's library papers
    if (params.library === 'me') {
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
            url,
            pdf_url,
            metadata,
            source,
            citation_count,
            impact_score,
            created_at,
            paper_authors (
              ordinal,
              authors (
                id,
                name
              )
            )
          )
        `)
        .eq('user_id', user.id)

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
        return {
          ...item,
          paper: {
            ...paperData,
            authors: paperData.paper_authors?.sort((a: PaperAuthorRelation, b: PaperAuthorRelation) => a.ordinal - b.ordinal).map((pa: PaperAuthorRelation) => pa.authors) || [],
            author_names: paperData.paper_authors?.sort((a: PaperAuthorRelation, b: PaperAuthorRelation) => a.ordinal - b.ordinal).map((pa: PaperAuthorRelation) => pa.authors.name) || []
          }
        }
      })

      return NextResponse.json({
        papers: transformedPapers,
        count: transformedPapers.length,
        source: 'user_library'
      })
    }

    // Route 3: External paper search (replaces fetch-sources)
    if (params.search) {
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
          source: 'external_search_cached'
        })
      }

      // Perform external search
      const result = await searchAndIngestPapers(params.search, {
        maxResults: params.maxResults,
        sources: params.sources,
        includePreprints: params.includePreprints,
        fromYear: params.fromYear,
        toYear: params.toYear,
        openAccessOnly: params.openAccessOnly
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
          source: paper.source
        })),
        count: result.papers.length,
        cached: false,
        source: 'external_search',
        ingestedIds: params.ingest ? result.ingestedIds : undefined
      }

      // Cache successful response
      if (result.papers.length > 0) {
        try {
          await supabase
            .from('papers_api_cache')
            .upsert({
              id: cacheKey,
              query_params: params,
              response: response,
              fetched_at: new Date().toISOString()
            })
        } catch (cacheError) {
          console.warn('Failed to cache search results:', cacheError)
        }
      }

      return NextResponse.json(response)
    }

    // No valid query provided
    return NextResponse.json({
      error: 'Invalid request: must provide search query, library=me, or ids parameter'
    }, { status: 400 })

  } catch (error) {
    console.error('Error in unified papers API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 