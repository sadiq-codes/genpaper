import { NextRequest, NextResponse } from 'next/server'
import { unifiedSearch } from '@/lib/search'
import { z } from 'zod'

// Lightweight search schema for Library Manager
const LibrarySearchRequestSchema = z.object({
  query: z.string().min(1).max(500).trim(),
  options: z.object({
    maxResults: z.number().int().min(1).max(50).optional().default(20),
    sources: z.array(z.enum(['openalex', 'crossref', 'semantic_scholar', 'arxiv', 'core'])).optional().default(['openalex', 'crossref', 'semantic_scholar']),
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

    console.log(`📚 Library Search (unified): "${query}" (${options.sources?.join(', ')})`)

    // Use unifiedSearch directly for library-only results by passing sources
    const searchPromise = unifiedSearch(query, {
      maxResults: options.maxResults,
      sources: options.sources,
      fromYear: options.fromYear
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
      papers: searchResults.papers.map(paper => ({
        canonical_id: (paper as any).canonical_id || paper.id || paper.doi || paper.url || paper.title,
        title: paper.title,
        abstract: paper.abstract?.substring(0, 250),
        year: (paper as any).year || (paper as any).publication_year || new Date(paper.publication_date || '').getFullYear(),
        venue: (paper as any).venue || (paper as any)['container-title'],
        doi: (paper as any).doi || (paper as any).DOI,
        url: paper.url,
        citationCount: (paper as any).citation_count || (paper as any).citationCount || 0,
        relevanceScore: (paper as any).relevanceScore,
        source: (paper as any).source || 'mixed'
      })),
      count: searchResults.papers.length,
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