import { NextRequest, NextResponse } from 'next/server'
import { parallelSearch } from '@/lib/services/paper-aggregation'
import { z } from 'zod'

/**
 * Fast Library Search API (Phase 1 of two-phase search)
 * 
 * Returns BM25-ranked results immediately without:
 * - LLM query rewrites (uses original query only)
 * - Semantic re-ranking (skips embedding generation)
 * 
 * This provides results in ~1-2s instead of ~5-10s.
 * The client can then call /api/library-search/rerank for better ordering.
 */

const FastSearchRequestSchema = z.object({
  query: z.string().min(1).max(500).trim(),
  options: z.object({
    maxResults: z.number().int().min(1).max(50).optional().default(25),
    sources: z.array(z.enum(['openalex', 'crossref', 'semantic_scholar', 'arxiv', 'core'])).optional().default(['openalex', 'crossref', 'semantic_scholar']),
    fromYear: z.number().int().min(1900).max(new Date().getFullYear()).optional()
  }).optional().default({})
})

interface FastSearchResponse {
  success: boolean
  query: string
  papers: Array<{
    canonical_id: string
    title: string
    abstract?: string
    authors?: string[]
    year: number
    venue?: string
    doi?: string
    url?: string
    citationCount: number
    bm25Score?: number
    source: string
  }>
  count: number
  searchTimeMs: number
  phase: 'fast'
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const body = await request.json()
    const validationResult = FastSearchRequestSchema.safeParse(body)
    
    if (!validationResult.success) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid request parameters',
          query: '',
          papers: [],
          count: 0,
          phase: 'fast'
        },
        { status: 400 }
      )
    }

    const { query, options } = validationResult.data

    console.log(`⚡ Fast Library Search: "${query}"`)

    // Use parallelSearch with fast options:
    // - skipQueryRewrites: true (skip LLM call)
    // - skipSemanticRerank: true (skip embedding generation)
    // - fastMode: true (shorter API timeouts)
    const papers = await parallelSearch(query, {
      maxResults: options.maxResults,
      sources: options.sources,
      fromYear: options.fromYear,
      fastMode: true,
      skipQueryRewrites: true,
      skipSemanticRerank: true
    })

    const searchTimeMs = Date.now() - startTime

    const response: FastSearchResponse = {
      success: true,
      query,
      papers: papers.map(paper => ({
        canonical_id: paper.canonical_id || paper.doi || paper.title,
        title: paper.title,
        abstract: paper.abstract?.substring(0, 300),
        authors: paper.authors,
        year: paper.year,
        venue: paper.venue,
        doi: paper.doi,
        url: paper.url,
        citationCount: paper.citationCount || 0,
        bm25Score: paper.bm25Score,
        source: paper.source || 'mixed'
      })),
      count: papers.length,
      searchTimeMs,
      phase: 'fast'
    }

    console.log(`⚡ Fast Search Complete: ${response.count} papers in ${searchTimeMs}ms`)

    return NextResponse.json(response)

  } catch (error) {
    const searchTimeMs = Date.now() - startTime
    console.error(`Fast search error after ${searchTimeMs}ms:`, error)
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Search failed',
        query: '',
        papers: [],
        count: 0,
        searchTimeMs,
        phase: 'fast'
      },
      { status: 500 }
    )
  }
}
