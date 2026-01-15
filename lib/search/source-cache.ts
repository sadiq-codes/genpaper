/**
 * In-Memory LRU Cache for Academic API Responses
 * 
 * Caches search results per-source with configurable TTLs.
 * Uses LRU eviction to bound memory usage.
 * 
 * This is distinct from the Supabase papers_api_cache which stores
 * aggregated results - this caches individual source API responses
 * to avoid redundant calls within the same search session.
 */

import type { PaperSource } from '@/types/simplified'
import { createHash } from 'crypto'

export interface CacheConfig {
  /** Maximum number of entries in cache (default: 500) */
  maxSize: number
  /** Default TTL in milliseconds (default: 30 minutes) */
  defaultTtlMs: number
  /** Per-source TTL overrides */
  sourceTtls?: Partial<Record<PaperSource, number>>
}

interface CacheEntry<T> {
  value: T
  expiresAt: number
  source: string
  key: string
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

// LRU Cache implementation
class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>()
  private config: CacheConfig
  
  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }
  
  /**
   * Generate a cache key from source, query, and options
   */
  static generateKey(source: string, query: string, options?: Record<string, unknown>): string {
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
  private getTtl(source: string): number {
    const sourceTtl = this.config.sourceTtls?.[source as PaperSource]
    return sourceTtl ?? this.config.defaultTtlMs
  }
  
  /**
   * Get a value from cache if not expired
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key)
    
    if (!entry) {
      return undefined
    }
    
    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return undefined
    }
    
    // Move to end for LRU (delete and re-add)
    this.cache.delete(key)
    this.cache.set(key, entry)
    
    return entry.value
  }
  
  /**
   * Set a value in cache with source-specific TTL
   */
  set(key: string, value: T, source: string): void {
    // Evict oldest entries if at capacity
    while (this.cache.size >= this.config.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        this.cache.delete(firstKey)
      } else {
        break
      }
    }
    
    const ttl = this.getTtl(source)
    const entry: CacheEntry<T> = {
      value,
      expiresAt: Date.now() + ttl,
      source,
      key,
    }
    
    this.cache.set(key, entry)
  }
  
  /**
   * Check if a key exists and is not expired
   */
  has(key: string): boolean {
    return this.get(key) !== undefined
  }
  
  /**
   * Remove a specific entry
   */
  delete(key: string): boolean {
    return this.cache.delete(key)
  }
  
  /**
   * Clear all entries for a specific source
   */
  clearSource(source: string): number {
    let cleared = 0
    for (const [key, entry] of this.cache) {
      if (entry.source === source) {
        this.cache.delete(key)
        cleared++
      }
    }
    return cleared
  }
  
  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear()
  }
  
  /**
   * Get cache statistics
   */
  stats(): { size: number; maxSize: number; sources: Record<string, number> } {
    const sources: Record<string, number> = {}
    for (const entry of this.cache.values()) {
      sources[entry.source] = (sources[entry.source] || 0) + 1
    }
    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      sources,
    }
  }
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

// Singleton cache instance
let cache: LRUCache<unknown> | null = null

/**
 * Get or create the singleton cache instance
 */
export function getCache(config?: Partial<CacheConfig>): LRUCache<unknown> {
  if (!cache) {
    cache = new LRUCache(config)
  }
  return cache
}

/**
 * Get cached result for a source query
 */
export function getCached<T>(
  source: PaperSource | string,
  query: string,
  options?: Record<string, unknown>
): T | undefined {
  const key = LRUCache.generateKey(source, query, options)
  return getCache().get(key) as T | undefined
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
  const key = LRUCache.generateKey(source, query, options)
  getCache().set(key, result, source)
}

/**
 * Check if a result is cached
 */
export function isCached(
  source: PaperSource | string,
  query: string,
  options?: Record<string, unknown>
): boolean {
  const key = LRUCache.generateKey(source, query, options)
  return getCache().has(key)
}

/**
 * Clear cache for a specific source
 */
export function clearSourceCache(source: PaperSource | string): number {
  return getCache().clearSource(source)
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
  return getCache().stats()
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
