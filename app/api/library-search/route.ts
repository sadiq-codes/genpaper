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
  partial?: boolean
  error?: string
}

// Shared state for tracking search completion
let searchCompleted = false

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  // Reset state for new search
  searchCompleted = false
  
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
    }).then(results => {
      searchCompleted = true
      return results
    })

    // **TIMEOUT CONTROL**: 10 seconds for library search (reduced from 20s)
    // With BM25 pre-filter in semantic-rerank, this should be achievable
    // If timeout occurs, we still try to return whatever partial results we have
    const SEARCH_TIMEOUT_MS = 10000
    
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), SEARCH_TIMEOUT_MS)
    })

    const result = await Promise.race([searchPromise, timeoutPromise])
    const searchTimeMs = Date.now() - startTime

    // Handle timeout case
    if (result === 'timeout') {
      console.warn(`⏱️ Library search timeout after ${SEARCH_TIMEOUT_MS}ms`)
      
      // Wait a tiny bit more to see if we can get partial results
      await new Promise(resolve => setTimeout(resolve, 100))
      
      // If the search completed during our brief wait, use those results
      if (searchCompleted) {
        const finalResults = await searchPromise
        const response: LibrarySearchResponse = {
          success: true,
          query,
          papers: finalResults.map(paper => ({
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
          count: finalResults.length,
          searchTimeMs: Date.now() - startTime,
          partial: true
        }
        console.log(`📚 Search completed just after timeout: ${response.count} papers`)
        return NextResponse.json(response)
      }
      
      // Return empty results with timeout error
      return NextResponse.json({
        success: false,
        error: `Search timed out after ${SEARCH_TIMEOUT_MS / 1000} seconds. Try a more specific query.`,
        query,
        papers: [],
        count: 0,
        searchTimeMs,
        partial: true
      }, { status: 408 }) // 408 Request Timeout
    }

    // Normal success case
    const rankedPapers = result
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
