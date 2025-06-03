import { NextRequest, NextResponse } from 'next/server'
import { searchAndIngestPapers, type AggregatedSearchOptions } from '@/lib/services/paper-aggregation'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import crypto from 'crypto'

// Fix: Add runtime specification to avoid edge/Node.js mismatch
export const runtime = 'nodejs'

// Fix: Add proper schema validation with Zod
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
  // Validate year range
  if (data.options.fromYear && data.options.toYear) {
    return data.options.fromYear <= data.options.toYear
  }
  return true
}, {
  message: "fromYear must be less than or equal to toYear"
})

// Interfaces for type safety
interface FetchSourcesRequest {
  topic: string
  options?: AggregatedSearchOptions & {
    ingestPapers?: boolean
  }
}

interface FetchSourcesResponse {
  success: boolean
  topic: string
  papers: any[]
  ingestedIds?: string[]
  count: number
  cached?: boolean
  error?: string
}

// Fix: Improved cache key generation using MD5 instead of base64
function generateCacheKey(topic: string, options: any): string {
  const normalizedOptions = {
    maxResults: options.maxResults,
    sources: options.sources?.sort(), // Sort for consistency
    includePreprints: options.includePreprints,
    fromYear: options.fromYear,
    toYear: options.toYear,
    openAccessOnly: options.openAccessOnly,
    semanticWeight: options.semanticWeight,
    authorityWeight: options.authorityWeight,
    recencyWeight: options.recencyWeight
  }
  
  const keyData = JSON.stringify({ t: topic, o: normalizedOptions })
  return crypto.createHash('md5').update(keyData).digest('hex')
}

// Fix: Redact sensitive information from logs
function sanitizeForLogging(options: any) {
  return {
    maxResults: options.maxResults,
    sources: options.sources,
    includePreprints: options.includePreprints,
    hasTimeFilter: !!(options.fromYear || options.toYear),
    openAccessOnly: options.openAccessOnly
    // Note: Removed topic from logs as it could contain PII
  }
}

// Fix: Cache health check results
let healthCheckCache: { result: any, timestamp: number } | null = null
const HEALTH_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export async function POST(request: NextRequest) {
  try {
    // Fix: Proper schema validation with detailed error messages
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

    // Fix: Improved logging without PII exposure
    console.log(`API: Searching for papers, topic length: ${topic.length} chars`)
    console.log(`API: Options:`, sanitizeForLogging(options))

    // Fix: Improved cache key generation
    const cacheKey = generateCacheKey(topic, options)
    
    // Check if we should use cached results
    const supabase = await createClient()
    
    // Check for recent cached results (last 24 hours)
    const { data: cachedResults, error: cacheError } = await supabase
      .from('papers_api_cache')
      .select('response, fetched_at')
      .eq('id', cacheKey)
      .gte('fetched_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .single()

    // Fix: Proper cache error handling
    if (cacheError && cacheError.code !== 'PGRST116') { // PGRST116 = no rows returned
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

    // Fix: Optimize cache storage - store minimal data to avoid row size limits
    const optimizedResponse: FetchSourcesResponse = {
      success: true,
      topic,
      papers: result.papers.map(paper => ({
        id: paper.canonical_id,
        title: paper.title,
        abstract: paper.abstract?.substring(0, 500), // Truncate abstracts
        year: paper.year,
        venue: paper.venue,
        doi: paper.doi,
        url: paper.url,
        citationCount: paper.citationCount,
        relevanceScore: paper.relevanceScore,
        source: paper.source
        // Note: Removed large fields to prevent row size issues
      })),
      count: result.papers.length,
      cached: false
    }

    if (options.ingestPapers) {
      optimizedResponse.ingestedIds = result.ingestedIds
    }

    // Cache the successful response with size optimization
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
        // Log cache error but don't fail the request
        console.error('Cache storage error:', cacheUpsertError)
      }
    }

    console.log(`API: Successfully found ${result.papers.length} papers`)
    if (options.ingestPapers) {
      console.log(`API: Successfully ingested ${result.ingestedIds.length} papers`)
    }

    // Return full response (not optimized version) to client
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

// Fix: Cache health check results to avoid calling APIs on every request
export async function GET() {
  try {
    // Check if we have a valid cached health result
    const now = Date.now()
    if (healthCheckCache && (now - healthCheckCache.timestamp) < HEALTH_CACHE_TTL) {
      console.log('Health check: Returning cached result')
      return NextResponse.json({
        ...healthCheckCache.result,
        cached: true
      })
    }

    const supabase = await createClient()
    
    // Test database connection
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

    // Cache the health result
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