/**
 * Rate Limiter with Token Bucket Algorithm
 * 
 * Implements per-project rate limiting to prevent abuse during streaming.
 * Uses token bucket with configurable limits and windows.
 */

interface TokenBucket {
  tokens: number
  lastRefill: number
  maxTokens: number
  refillRate: number // tokens per second
}

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetTime: number
  retryAfter?: number // seconds
}

interface RateLimitOptions {
  maxTokens?: number // Maximum tokens in bucket (default: 60)
  refillRate?: number // Tokens per second (default: 1 = 60 per minute)
  windowMs?: number // Time window in ms (default: 60000 = 1 minute)
}

class RateLimiter {
  private buckets = new Map<string, TokenBucket>()
  private maxTokens: number
  private refillRate: number
  private windowMs: number

  constructor(options: RateLimitOptions = {}) {
    this.maxTokens = options.maxTokens || 60
    this.refillRate = options.refillRate || 1 // 1 token per second = 60 per minute
    this.windowMs = options.windowMs || 60000 // 1 minute
  }

  /**
   * Check if request is allowed and consume token if so
   */
  checkLimit(key: string, tokensRequested: number = 1): RateLimitResult {
    const now = Date.now()
    let bucket = this.buckets.get(key)

    // Initialize bucket if not exists
    if (!bucket) {
      bucket = {
        tokens: this.maxTokens,
        lastRefill: now,
        maxTokens: this.maxTokens,
        refillRate: this.refillRate
      }
      this.buckets.set(key, bucket)
    }

    // Refill tokens based on time elapsed
    const timeElapsed = (now - bucket.lastRefill) / 1000 // seconds
    const tokensToAdd = Math.floor(timeElapsed * bucket.refillRate)
    
    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + tokensToAdd)
      bucket.lastRefill = now
    }

    // Check if we have enough tokens
    if (bucket.tokens >= tokensRequested) {
      bucket.tokens -= tokensRequested
      
      return {
        allowed: true,
        remaining: bucket.tokens,
        resetTime: now + ((bucket.maxTokens - bucket.tokens) / bucket.refillRate) * 1000
      }
    } else {
      // Calculate retry after time (when enough tokens will be available)
      const tokensNeeded = tokensRequested - bucket.tokens
      const retryAfterSeconds = Math.ceil(tokensNeeded / bucket.refillRate)
      
      return {
        allowed: false,
        remaining: bucket.tokens,
        resetTime: now + ((bucket.maxTokens - bucket.tokens) / bucket.refillRate) * 1000,
        retryAfter: retryAfterSeconds
      }
    }
  }

  /**
   * Clean up old buckets to prevent memory leaks
   */
  cleanup(): void {
    const now = Date.now()
    const cutoff = now - (this.windowMs * 2) // Keep buckets for 2x window time
    
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.lastRefill < cutoff) {
        this.buckets.delete(key)
      }
    }
  }

  /**
   * Get current status for a key without consuming tokens
   */
  getStatus(key: string): { tokens: number; resetTime: number } {
    const bucket = this.buckets.get(key)
    
    if (!bucket) {
      return {
        tokens: this.maxTokens,
        resetTime: Date.now()
      }
    }

    // Refill tokens for current status
    const now = Date.now()
    const timeElapsed = (now - bucket.lastRefill) / 1000
    const tokensToAdd = Math.floor(timeElapsed * bucket.refillRate)
    const currentTokens = Math.min(bucket.maxTokens, bucket.tokens + tokensToAdd)

    return {
      tokens: currentTokens,
      resetTime: now + ((bucket.maxTokens - currentTokens) / bucket.refillRate) * 1000
    }
  }
}

// Rate limiter instances for different operations
export const citationRateLimiter = new RateLimiter({
  maxTokens: 60,      // 60 citations per minute
  refillRate: 1,      // 1 citation per second
  windowMs: 60000     // 1 minute window
})

export const batchRateLimiter = new RateLimiter({
  maxTokens: 10,      // 10 batches per minute
  refillRate: 0.167,  // ~1 batch per 6 seconds
  windowMs: 60000     // 1 minute window
})

// Edits API rate limiters
export const editsApplyLimiter = new RateLimiter({
  maxTokens: 30,      // 30 applies per minute per document
  refillRate: 0.5,
  windowMs: 60000,
})

export const editsProposeLimiter = new RateLimiter({
  maxTokens: 30,      // 30 proposes per minute per document
  refillRate: 0.5,
  windowMs: 60000,
})

// Cleanup old buckets every 5 minutes
setInterval(() => {
  citationRateLimiter.cleanup()
  batchRateLimiter.cleanup()
  editsApplyLimiter.cleanup()
  editsProposeLimiter.cleanup()
}, 5 * 60 * 1000)

export type { RateLimitResult, RateLimitOptions }