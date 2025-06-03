import { v5 as uuidv5 } from 'uuid'

/**
 * Deterministic namespace for generating consistent UUID v5 hashes
 * Using a fixed namespace ensures the same input always produces the same hash
 */
export const HASH_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

/**
 * Collision-resistant hash function using UUID v5 (SHA-1 based, 128-bit)
 * Deterministic and Edge runtime compatible
 */
export function collisionResistantHash(str: string): string {
  return uuidv5(str, HASH_NAMESPACE)
}

/**
 * Shortened collision-resistant hash for cache keys (first 16 chars)
 * Still much safer than 32-bit hashes
 */
export function shortHash(str: string): string {
  return collisionResistantHash(str).replace(/-/g, '').substring(0, 16)
}

/**
 * Generate cache key from request parameters (for API cache)
 * Uses collision-resistant UUID v5 hash
 */
export function generateCacheKey(endpoint: string, params: Record<string, unknown>): string {
  const normalized = JSON.stringify({ endpoint, params }, Object.keys({ endpoint, params }).sort())
  return shortHash(normalized)
}

/**
 * Generate cache key from structured data
 * Uses collision-resistant UUID v5 hash
 */
export function generateDataCacheKey(data: Record<string, unknown>): string {
  const normalized = JSON.stringify(data, Object.keys(data).sort())
  return shortHash(normalized)
} 