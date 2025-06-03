import { NextRequest, NextResponse } from 'next/server'
import { parallelSearch } from '@/lib/services/paper-aggregation'
import { z } from 'zod'

// Lightweight search schema for Library Manager
const LibrarySearchRequestSchema = z.object({
  query: z.string().min(1).max(500).trim(),
  options: z.object({
    maxResults: z.number().int().min(1).max(50).optional().default(20), // Restored full result limit
    sources: z.array(z.enum(['openalex', 'crossref', 'semantic_scholar', 'arxiv', 'core'])).optional().default(['openalex', 'crossref', 'semantic_scholar', 'arxiv', 'core']), // All sources by default
    includePreprints: z.boolean().optional().default(true),
    fromYear: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
    toYear: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
    openAccessOnly: z.boolean().optional().default(false),
    fastMode: z.boolean().optional().default(true) // Enable fast mode by default
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

    console.log(`📚 Fast Library Search: "${query}" (${options.sources?.join(', ')})`)

    // **PERFORMANCE OPTIMIZATION**: Use fast mode with timeout
    const searchPromise = parallelSearch(query, {
      maxResults: options.maxResults,
      sources: options.sources,
      includePreprints: options.includePreprints,
      fromYear: options.fromYear,
      toYear: options.toYear,
      openAccessOnly: options.openAccessOnly,
      fastMode: options.fastMode // Pass fast mode to aggregation
    })

    // **TIMEOUT CONTROL**: Maximum 10 seconds for library search
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Search timeout after 10 seconds')), 10000)
    })

    const searchResults = await Promise.race([searchPromise, timeoutPromise]) as Awaited<typeof searchPromise>

    const searchTimeMs = Date.now() - startTime

    const response: LibrarySearchResponse = {
      success: true,
      query,
      papers: searchResults.map(paper => ({
        canonical_id: paper.canonical_id,
        title: paper.title,
        abstract: paper.abstract?.substring(0, 250), // Reduced for faster response
        year: paper.year,
        venue: paper.venue,
        doi: paper.doi,
        url: paper.url,
        citationCount: paper.citationCount,
        relevanceScore: paper.relevanceScore,
        source: paper.source
      })),
      count: searchResults.length,
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