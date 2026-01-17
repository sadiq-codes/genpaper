import { NextRequest, NextResponse } from 'next/server'
import { parallelSearch } from '@/lib/services/paper-aggregation'
import { z } from 'zod'

// Lightweight search schema for Library Manager
// This endpoint is for FAST search results - no ingestion, no PDF processing
const LibrarySearchRequestSchema = z.object({
  query: z.string().min(1).max(500).trim(),
  options: z.object({
    maxResults: z.number().int().min(1).max(50).optional().default(20),
    sources: z.array(z.enum(['openalex', 'crossref', 'semantic_scholar', 'arxiv', 'core'])).optional().default(['openalex', 'core', 'crossref', 'semantic_scholar']),
    fromYear: z.number().int().min(1900).max(new Date().getFullYear()).optional()
  }).optional().default({})
})

interface LibrarySearchResponse {
  success: boolean
  query: string
  papers: Array<{
    canonical_id: string
    title: string
    abstract?: string
    year: number
    venue?: string
    doi?: string
    url?: string
    citationCount: number
    relevanceScore?: number
    source: string
  }>
  count: number
  searchTimeMs?: number
  error?: string
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const body = await request.json()
    const validationResult = LibrarySearchRequestSchema.safeParse(body)
    
    if (!validationResult.success) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid request parameters',
          query: '',
          papers: [],
          count: 0,
          details: validationResult.error.errors.map(e => ({
            path: e.path.join('.'),
            message: e.message
          }))
        },
        { status: 400 }
      )
    }

    const { query, options } = validationResult.data

    console.log(`📚 Library Search (fast): "${query}" (${options.sources?.join(', ')})`)

    // Use parallelSearch directly for FAST results
    // This skips: ingestion, PDF processing, chunking, database writes
    // Only does: API calls + ranking + deduplication
    const searchPromise = parallelSearch(query, {
      maxResults: options.maxResults,
      sources: options.sources,
      fromYear: options.fromYear,
      fastMode: true // Enable fast mode for quicker API timeouts
    })

    // **TIMEOUT CONTROL**: 20 seconds for library search
    // parallelSearch with fastMode uses 6s individual API timeouts
    // Total time: ~6-8s for API calls + ranking
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Search timeout after 20 seconds')), 20000)
    })

    const rankedPapers = await Promise.race([searchPromise, timeoutPromise])

    const searchTimeMs = Date.now() - startTime

    const response: LibrarySearchResponse = {
      success: true,
      query,
      papers: rankedPapers.map(paper => ({
        canonical_id: paper.canonical_id || paper.doi || paper.title,
        title: paper.title,
        abstract: paper.abstract?.substring(0, 250),
        year: paper.year,
        venue: paper.venue,
        doi: paper.doi,
        url: paper.url,
        citationCount: paper.citationCount || 0,
        relevanceScore: paper.relevanceScore,
        source: paper.source || 'mixed'
      })),
      count: rankedPapers.length,
      searchTimeMs
    }

    console.log(`📚 Fast Search Complete: ${response.count} papers in ${searchTimeMs}ms`)

    return NextResponse.json(response)

  } catch (error) {
    const searchTimeMs = Date.now() - startTime
    console.error(`Library search error after ${searchTimeMs}ms:`, error)
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Search failed',
        query: '',
        papers: [],
        count: 0,
        searchTimeMs
      },
      { status: 500 }
    )
  }
} 