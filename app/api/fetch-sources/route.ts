import { NextRequest, NextResponse } from 'next/server'
import { searchAndIngestPapers } from '@/lib/services/paper-aggregation'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { shortHash } from '@/lib/utils/hash'

// Use Edge runtime for better performance and global distribution
export const runtime = 'edge'

// Schema validation with Zod
const FetchSourcesRequestSchema = z.object({
  topic: z.string().min(1).max(500).trim(),
  options: z.object({
    ingestPapers: z.boolean().optional().default(true),
    maxResults: z.number().int().min(1).max(100).optional().default(25),
    sources: z.array(z.enum(['openalex', 'crossref', 'semantic_scholar', 'arxiv', 'core'])).optional().default(['openalex', 'crossref', 'semantic_scholar']),
    includePreprints: z.boolean().optional().default(true),
    fromYear: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
    toYear: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
    openAccessOnly: z.boolean().optional().default(false),
    semanticWeight: z.number().min(0).max(2).optional().default(1.0),
    authorityWeight: z.number().min(0).max(2).optional().default(0.5),
    recencyWeight: z.number().min(0).max(2).optional().default(0.1)
  }).optional().default({})
}).refine(data => {
  if (data.options.fromYear && data.options.toYear) {
    return data.options.fromYear <= data.options.toYear
  }
  return true
}, {
  message: "fromYear must be less than or equal to toYear"
})

interface FetchSourcesResponse {
  success: boolean
  topic: string
  papers: Array<{
    canonical_id?: string
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
  ingestedIds?: string[]
  count: number
  cached?: boolean
  error?: string
}

type CacheableOptions = {
  maxResults?: number
  sources?: string[]
  includePreprints?: boolean
  fromYear?: number
  toYear?: number
  openAccessOnly?: boolean
  semanticWeight?: number
  authorityWeight?: number
  recencyWeight?: number
  useLibraryOnly?: boolean
}

function generateCacheKey(topic: string, options: CacheableOptions): string {
  const normalizedOptions = {
    maxResults: options.maxResults,
    sources: options.sources?.sort(),
    includePreprints: options.includePreprints,
    fromYear: options.fromYear,
    toYear: options.toYear,
    openAccessOnly: options.openAccessOnly,
    semanticWeight: options.semanticWeight,
    authorityWeight: options.authorityWeight,
    recencyWeight: options.recencyWeight,
    useLibraryOnly: options.useLibraryOnly
  }
  
  const keyData = JSON.stringify({ t: topic, o: normalizedOptions })
  return shortHash(keyData)
}

function sanitizeForLogging(options: CacheableOptions) {
  return {
    maxResults: options.maxResults,
    sources: options.sources,
    includePreprints: options.includePreprints,
    hasTimeFilter: !!(options.fromYear || options.toYear),
    openAccessOnly: options.openAccessOnly
  }
}

let healthCheckCache: { result: Record<string, unknown>, timestamp: number } | null = null
const HEALTH_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const validationResult = FetchSourcesRequestSchema.safeParse(body)
    
    if (!validationResult.success) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid request parameters',
          details: validationResult.error.errors.map(e => ({
            path: e.path.join('.'),
            message: e.message
          }))
        },
        { status: 400 }
      )
    }

    const { topic, options } = validationResult.data

    console.log(`API: Searching for papers, topic length: ${topic.length} chars`)
    console.log(`API: Options:`, sanitizeForLogging(options))

    const cacheKey = generateCacheKey(topic, options)
    
    const supabase = await createClient()
    
    // Check for recent cached results (last 24 hours)
    const { data: cachedResults, error: cacheError } = await supabase
      .from('papers_api_cache')
      .select('response, fetched_at')
      .eq('id', cacheKey)
      .gte('fetched_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .single()

    if (cacheError && cacheError.code !== 'PGRST116') {
      console.error('Cache lookup error:', cacheError)
      return NextResponse.json(
        {
          success: false,
          error: 'Cache lookup failed',
          topic: '',
          papers: [],
          count: 0
        },
        { status: 500 }
      )
    }

    if (!cacheError && cachedResults) {
      console.log('API: Returning cached results')
      const cachedResponse = cachedResults.response as FetchSourcesResponse
      return NextResponse.json({
        ...cachedResponse,
        cached: true
      })
    }

    // Perform the search and ingestion
    const result = await searchAndIngestPapers(topic, {
      maxResults: options.maxResults,
      sources: options.sources,
      includePreprints: options.includePreprints,
      fromYear: options.fromYear,
      toYear: options.toYear,
      openAccessOnly: options.openAccessOnly,
      semanticWeight: options.semanticWeight,
      authorityWeight: options.authorityWeight,
      recencyWeight: options.recencyWeight
    })

    const optimizedResponse: FetchSourcesResponse = {
      success: true,
      topic,
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
      cached: false
    }

    if (options.ingestPapers) {
      optimizedResponse.ingestedIds = result.ingestedIds
    }

    // Cache successful response
    if (result.papers.length > 0) {
      try {
        await supabase
          .from('papers_api_cache')
          .upsert({
            id: cacheKey,
            response: optimizedResponse,
            fetched_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
            request_hash: cacheKey
          })
      } catch (cacheUpsertError) {
        console.error('Cache storage error:', cacheUpsertError)
      }
    }

    console.log(`API: Successfully found ${result.papers.length} papers`)
    if (options.ingestPapers) {
      console.log(`API: Successfully ingested ${result.ingestedIds.length} papers`)
    }

    const fullResponse: FetchSourcesResponse = {
      success: true,
      topic,
      papers: result.papers,
      count: result.papers.length,
      cached: false
    }

    if (options.ingestPapers) {
      fullResponse.ingestedIds = result.ingestedIds
    }

    return NextResponse.json(fullResponse)

  } catch (error) {
    console.error('API: fetchSources error:', error)
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
        topic: '',
        papers: [],
        count: 0
      },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const now = Date.now()
    if (healthCheckCache && (now - healthCheckCache.timestamp) < HEALTH_CACHE_TTL) {
      console.log('Health check: Returning cached result')
      return NextResponse.json({
        ...healthCheckCache.result,
        cached: true
      })
    }

    const supabase = await createClient()
    
    const { error } = await supabase.from('papers').select('id').limit(1)
    
    if (error) {
      throw new Error(`Database connection failed: ${error.message}`)
    }

    const healthResult = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      apis: {
        openalex: 'available',
        crossref: 'available', 
        semantic_scholar: 'available',
        arxiv: 'available',
        core: process.env.CORE_API_KEY ? 'available' : 'api_key_required'
      },
      cached: false
    }

    healthCheckCache = {
      result: healthResult,
      timestamp: now
    }

    return NextResponse.json(healthResult)
  } catch (error) {
    const errorResult = {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
      cached: false
    }

    return NextResponse.json(errorResult, { status: 500 })
  }
}