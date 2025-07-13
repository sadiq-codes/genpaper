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

// Legacy endpoint - redirect to unified papers API
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { topic, options = {} } = body

    if (!topic) {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 })
    }

    // Build query parameters for the unified API
    const params = new URLSearchParams({
      search: topic,
      ingest: 'true',
      maxResults: (options.maxResults || 25).toString()
    })
    
    if (options.fromYear) params.set('fromYear', options.fromYear.toString())
    if (options.toYear) params.set('toYear', options.toYear.toString())
    if (options.openAccessOnly) params.set('openAccessOnly', 'true')
    if (options.includePreprints !== undefined) params.set('includePreprints', options.includePreprints.toString())
    if (options.sources && options.sources.length > 0) {
      params.set('sources', options.sources.join(','))
    }

    // Redirect to unified papers API
    const unifiedUrl = `/api/papers?${params.toString()}`
    
    return NextResponse.json({
      message: 'This endpoint has been deprecated. Please use the unified papers API.',
      redirectTo: unifiedUrl,
      migration: {
        old: 'POST /api/fetch-sources',
        new: `GET ${unifiedUrl}`,
        note: 'Use GET request with query parameters instead of POST with body'
      }
    }, { 
      status: 301,
      headers: {
        'Location': unifiedUrl,
        'X-Deprecated': 'true',
        'X-Migration-Guide': 'Use GET /api/papers with search parameter'
      }
    })

  } catch (error) {
    console.error('Error in legacy fetch-sources endpoint:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Also handle GET requests with deprecation notice
export async function GET() {
  return NextResponse.json({
    message: 'This endpoint has been deprecated. Please use GET /api/papers with search parameter.',
    example: '/api/papers?search=your-topic&ingest=true&maxResults=25'
  }, { 
    status: 410, // Gone
    headers: {
      'X-Deprecated': 'true',
      'X-Migration-Guide': 'Use GET /api/papers with search parameter'
    }
  })
}