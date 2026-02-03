/**
 * In-Memory LRU Cache for Academic API Responses
 * 
 * Caches search results per-source with configurable TTLs.
 * Uses lru-cache library for battle-tested LRU eviction.
 * 
 * This is distinct from the Supabase papers_api_cache which stores
 * aggregated results - this caches individual source API responses
 * to avoid redundant calls within the same search session.
 */

import { LRUCache } from 'lru-cache'
import type { PaperSource } from '@/types/simplified'
import { createHash } from 'crypto'

// =============================================================================
// CONFIGURATION
// =============================================================================

export interface CacheConfig {
  /** Maximum number of entries in cache (default: 500) */
  maxSize: number
  /** Default TTL in milliseconds (default: 30 minutes) */
  defaultTtlMs: number
  /** Per-source TTL overrides */
  sourceTtls?: Partial<Record<PaperSource, number>>
}

const DEFAULT_CONFIG: CacheConfig = {
  maxSize: 500,
  defaultTtlMs: 30 * 60 * 1000, // 30 minutes
  sourceTtls: {
    openalex: 30 * 60 * 1000,      // 30 min - fast API, generous limits
    crossref: 30 * 60 * 1000,       // 30 min - stable metadata
    semantic_scholar: 60 * 60 * 1000, // 60 min - strict rate limits
    arxiv: 15 * 60 * 1000,          // 15 min - updates frequently
    core: 30 * 60 * 1000,           // 30 min - standard
  },
}

// =============================================================================
// TYPES
// =============================================================================

interface CacheEntry<T> {
  value: T
  source: string
}

// =============================================================================
// CACHE IMPLEMENTATION
// =============================================================================

// Singleton cache instance
let cache: LRUCache<string, CacheEntry<unknown>> | null = null
let config: CacheConfig = DEFAULT_CONFIG

/**
 * Get or create the singleton cache instance
 */
function getCache(): LRUCache<string, CacheEntry<unknown>> {
  if (!cache) {
    cache = new LRUCache<string, CacheEntry<unknown>>({
      max: config.maxSize,
      ttl: config.defaultTtlMs,
      // Update age on access (standard LRU behavior)
      updateAgeOnGet: true,
      // Allow stale entries while fetching new ones
      allowStale: false,
    })
  }
  return cache
}

/**
 * Generate a cache key from source, query, and options
 */
export function generateKey(source: string, query: string, options?: Record<string, unknown>): string {
  const normalized = {
    source,
    query: query.toLowerCase().trim(),
    options: options ? JSON.stringify(sortObject(options)) : '',
  }
  const hash = createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex')
    .slice(0, 16)
  return `${source}:${hash}`
}

/**
 * Get TTL for a specific source
 */
function getTtl(source: string): number {
  return config.sourceTtls?.[source as PaperSource] ?? config.defaultTtlMs
}

// Sort object keys for consistent hashing
function sortObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) {
    const value = obj[key]
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      sorted[key] = sortObject(value as Record<string, unknown>)
    } else {
      sorted[key] = value
    }
  }
  return sorted
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Initialize cache with custom config (optional)
 */
export function initCache(customConfig?: Partial<CacheConfig>): void {
  config = { ...DEFAULT_CONFIG, ...customConfig }
  cache = null // Reset to recreate with new config
}

/**
 * Get cached result for a source query
 */
export function getCached<T>(
  source: PaperSource | string,
  query: string,
  options?: Record<string, unknown>
): T | undefined {
  const key = generateKey(source, query, options)
  const entry = getCache().get(key)
  return entry?.value as T | undefined
}

/**
 * Cache a result for a source query
 */
export function setCached<T>(
  source: PaperSource | string,
  query: string,
  result: T,
  options?: Record<string, unknown>
): void {
  const key = generateKey(source, query, options)
  const ttl = getTtl(source)
  
  getCache().set(key, { value: result, source }, { ttl })
}

/**
 * Check if a result is cached
 */
export function isCached(
  source: PaperSource | string,
  query: string,
  options?: Record<string, unknown>
): boolean {
  const key = generateKey(source, query, options)
  return getCache().has(key)
}

/**
 * Clear cache for a specific source
 */
export function clearSourceCache(source: PaperSource | string): number {
  const c = getCache()
  let cleared = 0
  
  // Iterate through all entries and delete matching source
  for (const key of c.keys()) {
    const entry = c.peek(key) // peek doesn't update LRU order
    if (entry?.source === source) {
      c.delete(key)
      cleared++
    }
  }
  
  return cleared
}

/**
 * Clear entire cache
 */
export function clearAllCache(): void {
  getCache().clear()
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { size: number; maxSize: number; sources: Record<string, number> } {
  const c = getCache()
  const sources: Record<string, number> = {}
  
  for (const key of c.keys()) {
    const entry = c.peek(key)
    if (entry) {
      sources[entry.source] = (sources[entry.source] || 0) + 1
    }
  }
  
  return {
    size: c.size,
    maxSize: config.maxSize,
    sources,
  }
}

/**
 * Wrapper that adds caching to an async search function
 * 
 * @example
 * const cachedSearch = withCache('openalex', searchOpenAlex)
 * const results = await cachedSearch(query, options)
 */
export function withCache<T, Args extends [string, Record<string, unknown>?]>(
  source: PaperSource | string,
  fn: (...args: Args) => Promise<T>
): (...args: Args) => Promise<T> {
  return async (...args: Args): Promise<T> => {
    const [query, options] = args
    
    // Check cache first
    const cached = getCached<T>(source, query, options)
    if (cached !== undefined) {
      return cached
    }
    
    // Execute function
    const result = await fn(...args)
    
    // Cache result
    setCached(source, query, result, options)
    
    return result
  }
}
