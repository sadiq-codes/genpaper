import { createClient } from '@/lib/supabase/server'
import crypto from 'crypto'

// Cache entry interface
interface CacheEntry {
  id: string
  response: Record<string, unknown>
  fetched_at: string
  expires_at: string
  request_hash: string
}

// Rate limiter interface
interface RateLimit {
  requests: number
  window_start: number
  last_request: number
}

// In-memory rate limiting store (in production, use Redis)
const rateLimitStore = new Map<string, RateLimit>()

// Generate cache key from request parameters
function generateCacheKey(endpoint: string, params: Record<string, unknown>): string {
  const normalized = JSON.stringify({ endpoint, params }, Object.keys({ endpoint, params }).sort())
  return crypto.createHash('md5').update(normalized).digest('hex')
}

// Check if cache entry is still valid
function isCacheValid(entry: CacheEntry): boolean {
  return new Date(entry.expires_at) > new Date()
}

// Create cache table if it doesn't exist
export async function initializeCache(): Promise<void> {
  const supabase = await createClient()
  
  // This would typically be done via migration, but including for completeness
  const { error } = await supabase.rpc('create_api_cache_table_if_not_exists')
  
  if (error) {
    console.warn('Cache table creation failed (may already exist):', error.message)
  }
}

// Get cached response
export async function getCachedResponse(
  endpoint: string, 
  params: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  try {
    const supabase = await createClient()
    const cacheKey = generateCacheKey(endpoint, params)
    
    const { data, error } = await supabase
      .from('papers_api_cache')
      .select('*')
      .eq('id', cacheKey)
      .single()
    
    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned - cache miss
        return null
      }
      // Actual error - log and return null
      console.error('Cache retrieval error:', error)
      return null
    }
    
    if (!data) {
      return null
    }
    
    const entry = data as CacheEntry
    
    if (isCacheValid(entry)) {
      console.log(`Cache hit for ${endpoint}`)
      return entry.response
    } else {
      // Remove expired entry asynchronously (fire and forget)
      const cleanupExpired = async () => {
        try {
          await supabase.from('papers_api_cache').delete().eq('id', cacheKey)
          console.log(`Cache expired and cleaned for ${endpoint}`)
        } catch (cleanupError) {
          console.warn('Cache cleanup error:', cleanupError)
        }
      }
      void cleanupExpired()
      
      console.log(`Cache expired for ${endpoint}`)
      return null
    }
  } catch (error) {
    console.error('Cache retrieval error:', error)
    return null
  }
}

// Cache API response
export async function setCachedResponse(
  endpoint: string,
  params: Record<string, unknown>,
  response: Record<string, unknown>,
  ttlHours: number = 48
): Promise<void> {
  try {
    const supabase = await createClient()
    const cacheKey = generateCacheKey(endpoint, params)
    const now = new Date()
    const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000)
    
    // Optimize response size before caching
    const optimizedResponse = optimizeResponseForCache(response)
    
    // Check response size and skip caching if too large
    const responseSize = JSON.stringify(optimizedResponse).length
    if (responseSize > 1000000) { // 1MB limit
      console.warn(`Response too large to cache (${responseSize} bytes), skipping cache for ${endpoint}`)
      return
    }
    
    const { error } = await supabase
      .from('papers_api_cache')
      .upsert({
        id: cacheKey,
        response: optimizedResponse,
        fetched_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        request_hash: cacheKey
      })
    
    if (error) {
      console.error('Cache storage error:', error)
    } else {
      console.log(`Cached response for ${endpoint} (${responseSize} bytes)`)
    }
  } catch (error) {
    console.error('Cache storage error:', error)
  }
}

// Helper function to optimize responses before caching
function optimizeResponseForCache(response: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(response)) {
    return response.map(item => optimizeResponseForCache(item as Record<string, unknown>)) as unknown as Record<string, unknown>
  }
  
  if (typeof response === 'object' && response !== null) {
    const optimized: Record<string, unknown> = {}
    
    for (const [key, value] of Object.entries(response)) {
      if (key === 'abstract' && typeof value === 'string') {
        // Truncate long abstracts
        optimized[key] = value.length > 1000 ? value.substring(0, 1000) + '...' : value
      } else if (key === 'content' && typeof value === 'string') {
        // Truncate long content
        optimized[key] = value.length > 2000 ? value.substring(0, 2000) + '...' : value
      } else if (typeof value === 'object') {
        optimized[key] = optimizeResponseForCache(value as Record<string, unknown>)
      } else {
        optimized[key] = value
      }
    }
    
    return optimized
  }
  
  return response
}

// Clean up expired cache entries
export async function cleanupExpiredCache(): Promise<void> {
  try {
    const supabase = await createClient()
    const now = new Date().toISOString()
    
    const { error, count } = await supabase
      .from('papers_api_cache')
      .delete()
      .lt('expires_at', now)
    
    if (error) {
      console.error('Cache cleanup error:', error)
    } else {
      console.log(`Cache cleanup completed, removed ${count || 0} expired entries`)
    }
  } catch (error) {
    console.error('Cache cleanup error:', error)
  }
}

// Rate limiting functionality
export function checkRateLimit(
  identifier: string,
  maxRequests: number = 100,
  windowMs: number = 60000 // 1 minute
): { allowed: boolean, retryAfter?: number } {
  const now = Date.now()
  const limit = rateLimitStore.get(identifier)
  
  if (!limit) {
    // First request
    rateLimitStore.set(identifier, {
      requests: 1,
      window_start: now,
      last_request: now
    })
    return { allowed: true }
  }
  
  // Check if window has expired
  if (now - limit.window_start > windowMs) {
    // Reset window
    rateLimitStore.set(identifier, {
      requests: 1,
      window_start: now,
      last_request: now
    })
    return { allowed: true }
  }
  
  // Check if limit exceeded
  if (limit.requests >= maxRequests) {
    const retryAfter = Math.ceil((limit.window_start + windowMs - now) / 1000)
    return { allowed: false, retryAfter }
  }
  
  // Update request count
  limit.requests++
  limit.last_request = now
  rateLimitStore.set(identifier, limit)
  
  return { allowed: true }
}

// Cached fetch with rate limiting
export async function cachedFetch(
  url: string,
  options: RequestInit = {},
  cacheKey?: string,
  ttlHours: number = 48
): Promise<Record<string, unknown>> {
  const endpoint = new URL(url).pathname
  const params = Object.fromEntries(new URL(url).searchParams)
  
  // Check cache first
  const cached = await getCachedResponse(cacheKey || endpoint, params)
  if (cached) {
    return cached
  }
  
  // Check rate limits
  const rateLimitKey = new URL(url).hostname
  const rateCheck = checkRateLimit(rateLimitKey)
  
  if (!rateCheck.allowed) {
    console.warn(`Rate limit exceeded for ${rateLimitKey}. Retry after ${rateCheck.retryAfter}s`)
    throw new Error(`Rate limit exceeded. Retry after ${rateCheck.retryAfter} seconds`)
  }
  
  // Make request
  try {
    const response = await fetch(url, options)
    
    if (!response.ok) {
      // Handle rate limiting from API
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after')
        const waitTime = retryAfter ? parseInt(retryAfter) : 60
        
        console.warn(`API rate limit hit for ${url}. Waiting ${waitTime}s`)
        throw new Error(`API rate limit hit. Retry after ${waitTime} seconds`)
      }
      
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    
    const data = await response.json()
    
    // Cache successful response
    await setCachedResponse(cacheKey || endpoint, params, data, ttlHours)
    
    return data
  } catch (error) {
    console.error(`Fetch error for ${url}:`, error)
    throw error
  }
}

// Batch cache operations
export async function getCachedResponses(
  requests: Array<{ endpoint: string, params: Record<string, unknown> }>
): Promise<Array<Record<string, unknown> | null>> {
  const supabase = await createClient()
  const cacheKeys = requests.map(req => generateCacheKey(req.endpoint, req.params))
  
  try {
    const { data, error } = await supabase
      .from('papers_api_cache')
      .select('*')
      .in('id', cacheKeys)
    
    if (error) {
      console.error('Batch cache retrieval error:', error)
      return new Array(requests.length).fill(null)
    }
    
    // Map results back to original order
    const results = new Array(requests.length).fill(null)
    
    for (let i = 0; i < requests.length; i++) {
      const cacheKey = cacheKeys[i]
      const entry = data?.find(d => d.id === cacheKey) as CacheEntry | undefined
      
      if (entry && isCacheValid(entry)) {
        results[i] = entry.response
      }
    }
    
    return results
  } catch (error) {
    console.error('Batch cache retrieval error:', error)
    return new Array(requests.length).fill(null)
  }
}

// Set multiple cache entries
export async function setCachedResponses(
  entries: Array<{
    endpoint: string
    params: Record<string, unknown>
    response: Record<string, unknown>
    ttlHours?: number
  }>
): Promise<void> {
  const supabase = await createClient()
  const now = new Date()
  
  const cacheEntries = entries.map(entry => {
    const cacheKey = generateCacheKey(entry.endpoint, entry.params)
    const ttlHours = entry.ttlHours || 48
    const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000)
    
    return {
      id: cacheKey,
      response: optimizeResponseForCache(entry.response),
      fetched_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      request_hash: cacheKey
    }
  })
  
  try {
    const { error } = await supabase
      .from('papers_api_cache')
      .upsert(cacheEntries)
    
    if (error) {
      console.error('Batch cache storage error:', error)
    } else {
      console.log(`Cached ${entries.length} responses`)
    }
  } catch (error) {
    console.error('Batch cache storage error:', error)
  }
}

// Helper to create the cache table (would normally be in migrations)
export const createCacheTableSQL = `
CREATE TABLE IF NOT EXISTS papers_api_cache (
  id TEXT PRIMARY KEY,
  response JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  request_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_papers_api_cache_expires_at ON papers_api_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_papers_api_cache_request_hash ON papers_api_cache(request_hash);
CREATE INDEX IF NOT EXISTS idx_papers_api_cache_fetched_at_desc ON papers_api_cache(fetched_at DESC);
` 