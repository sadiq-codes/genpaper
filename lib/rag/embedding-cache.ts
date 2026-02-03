/**
 * Shared Embedding Cache
 * 
 * Provides a centralized cache for query embeddings to avoid repeated
 * OpenAI API calls for the same or similar queries.
 * 
 * Features:
 * - Query normalization for better cache hit rates
 * - TTL-based expiration (30 minutes)
 * - LRU eviction when cache is full
 * - Cache hit/miss metrics logging
 * 
 * Uses lru-cache library for battle-tested LRU implementation.
 */

import { LRUCache } from 'lru-cache'
import { generateEmbeddings } from '@/lib/utils/embedding'

// =============================================================================
// CONFIGURATION
// =============================================================================

const EMBEDDING_CACHE_TTL_MS = 30 * 60 * 1000  // 30 minutes
const EMBEDDING_CACHE_MAX_SIZE = 1000
const CACHE_HIT_LOG_INTERVAL = 100              // Log stats every N requests

// =============================================================================
// TYPES
// =============================================================================

interface EmbeddingCacheEntry {
  embedding: number[]
  originalQuery: string  // For debugging (truncated)
}

interface CacheStats {
  hits: number
  misses: number
}

// =============================================================================
// CACHE STATE
// =============================================================================

// Stats tracked separately since lru-cache doesn't expose hit/miss counts
const cacheStats: CacheStats = { hits: 0, misses: 0 }

// Singleton cache instance
let cache: LRUCache<string, EmbeddingCacheEntry> | null = null

/**
 * Get or create the singleton cache instance
 */
function getCache(): LRUCache<string, EmbeddingCacheEntry> {
  if (!cache) {
    cache = new LRUCache<string, EmbeddingCacheEntry>({
      max: EMBEDDING_CACHE_MAX_SIZE,
      ttl: EMBEDDING_CACHE_TTL_MS,
      updateAgeOnGet: true,  // Standard LRU behavior
      allowStale: false,
    })
  }
  return cache
}

// =============================================================================
// QUERY NORMALIZATION
// =============================================================================

/**
 * Normalize a query string for better cache hit rates.
 * 
 * Transformations:
 * 1. Lowercase
 * 2. Collapse multiple whitespace to single space
 * 3. Trim
 * 4. Remove common punctuation variations
 * 5. Truncate to last 300 chars (most relevant context for autocomplete)
 * 
 * This means queries like:
 * - "Introduction: The study shows..."
 * - "introduction:  The study shows..." (extra space)
 * - "Introduction - The study shows..." (different punctuation)
 * 
 * Will all normalize to the same cache key.
 */
export function normalizeQueryForCache(query: string): string {
  let normalized = query
    .toLowerCase()
    .replace(/\s+/g, ' ')           // Collapse whitespace
    .replace(/[^\w\s.,;:'"()-]/g, '') // Remove special chars except common punctuation
    .replace(/\s*[.:;,]\s*/g, ' ')  // Normalize punctuation spacing
    .trim()
  
  // Take last 300 chars - for autocomplete, recent context is most relevant
  if (normalized.length > 300) {
    normalized = normalized.slice(-300)
  }
  
  return normalized
}

/**
 * Generate a cache key from normalized query.
 * Uses a simple but effective hash based on length + prefix + suffix.
 */
function getCacheKey(normalizedQuery: string): string {
  const len = normalizedQuery.length
  const prefix = normalizedQuery.slice(0, 50)
  const suffix = normalizedQuery.slice(-50)
  return `${len}:${prefix}|${suffix}`
}

// =============================================================================
// LOGGING
// =============================================================================

/**
 * Log cache statistics periodically.
 */
function maybeLogStats(): void {
  const total = cacheStats.hits + cacheStats.misses
  if (total > 0 && total % CACHE_HIT_LOG_INTERVAL === 0) {
    const hitRate = ((cacheStats.hits / total) * 100).toFixed(1)
    const c = getCache()
    console.log(`[EmbeddingCache] Stats: ${cacheStats.hits} hits, ${cacheStats.misses} misses (${hitRate}% hit rate), ${c.size} cached`)
  }
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Get embedding for a single query with caching.
 * 
 * @param query - The query text to embed
 * @returns The embedding vector
 */
export async function getCachedQueryEmbedding(query: string): Promise<number[]> {
  const normalized = normalizeQueryForCache(query)
  const key = getCacheKey(normalized)
  const c = getCache()
  
  // Check cache first
  const cached = c.get(key)
  if (cached) {
    cacheStats.hits++
    maybeLogStats()
    return cached.embedding
  }
  
  // Generate new embedding
  cacheStats.misses++
  const startTime = Date.now()
  const [embedding] = await generateEmbeddings([query])
  const duration = Date.now() - startTime
  
  // Log slow embeddings
  if (duration > 2000) {
    console.warn(`[EmbeddingCache] Slow embedding generation: ${duration}ms for query: "${query.slice(0, 50)}..."`)
  }
  
  // Cache it
  c.set(key, {
    embedding,
    originalQuery: query.slice(0, 100),  // Store truncated for debugging
  })
  maybeLogStats()
  
  return embedding
}

/**
 * Get embeddings for multiple texts with caching.
 * Returns embeddings for texts, using cache when available.
 * 
 * @param texts - Array of texts to embed
 * @returns Array of embedding vectors
 */
export async function getEmbeddingsWithCache(texts: string[]): Promise<number[][]> {
  const c = getCache()
  const results: (number[] | null)[] = []
  const uncachedIndices: number[] = []
  const uncachedTexts: string[] = []
  
  // Check cache for each text
  for (let i = 0; i < texts.length; i++) {
    const normalized = normalizeQueryForCache(texts[i])
    const key = getCacheKey(normalized)
    const cached = c.get(key)
    
    if (cached) {
      results[i] = cached.embedding
      cacheStats.hits++
    } else {
      results[i] = null
      uncachedIndices.push(i)
      uncachedTexts.push(texts[i])
      cacheStats.misses++
    }
  }
  
  // Generate missing embeddings in batch
  if (uncachedTexts.length > 0) {
    const startTime = Date.now()
    const newEmbeddings = await generateEmbeddings(uncachedTexts)
    const duration = Date.now() - startTime
    
    if (duration > 2000) {
      console.warn(`[EmbeddingCache] Slow batch embedding: ${duration}ms for ${uncachedTexts.length} texts`)
    }
    
    // Cache and fill in results
    for (let i = 0; i < uncachedIndices.length; i++) {
      const idx = uncachedIndices[i]
      const text = texts[idx]
      const embedding = newEmbeddings[i]
      
      results[idx] = embedding
      
      const normalized = normalizeQueryForCache(text)
      const key = getCacheKey(normalized)
      c.set(key, {
        embedding,
        originalQuery: text.slice(0, 100),
      })
    }
  }
  
  maybeLogStats()
  return results as number[][]
}

/**
 * Clear the embedding cache.
 * Useful for testing or when embeddings need to be regenerated.
 */
export function clearEmbeddingCache(): void {
  getCache().clear()
  cacheStats.hits = 0
  cacheStats.misses = 0
  console.log('[EmbeddingCache] Cache cleared')
}

/**
 * Get current cache statistics.
 */
export function getEmbeddingCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
  const total = cacheStats.hits + cacheStats.misses
  return {
    size: getCache().size,
    hits: cacheStats.hits,
    misses: cacheStats.misses,
    hitRate: total > 0 ? cacheStats.hits / total : 0,
  }
}
