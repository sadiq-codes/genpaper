import { describe, expect, test, beforeEach, vi } from 'vitest'
import { citationRateLimiter, batchRateLimiter } from '@/lib/utils/rate-limiter'

describe('rate-limiter', () => {
  beforeEach(() => {
    // Clear any existing buckets
    citationRateLimiter.cleanup()
    batchRateLimiter.cleanup()
  })

  describe('citation rate limiter', () => {
    test('allows requests within limit', () => {
      const projectId = 'test-project-1'
      
      // First request should be allowed
      const result1 = citationRateLimiter.checkLimit(projectId, 1)
      expect(result1.allowed).toBe(true)
      expect(result1.remaining).toBe(59) // 60 - 1
      
      // Second request should also be allowed
      const result2 = citationRateLimiter.checkLimit(projectId, 1)
      expect(result2.allowed).toBe(true)
      expect(result2.remaining).toBe(58) // 59 - 1
    })

    test('blocks requests exceeding limit', () => {
      const projectId = 'test-project-2'
      
      // Consume all tokens
      const result1 = citationRateLimiter.checkLimit(projectId, 60)
      expect(result1.allowed).toBe(true)
      expect(result1.remaining).toBe(0)
      
      // Next request should be blocked
      const result2 = citationRateLimiter.checkLimit(projectId, 1)
      expect(result2.allowed).toBe(false)
      expect(result2.retryAfter).toBeGreaterThan(0)
    })

    test('different projects have separate limits', () => {
      const project1 = 'test-project-3'
      const project2 = 'test-project-4'
      
      // Consume all tokens for project1
      citationRateLimiter.checkLimit(project1, 60)
      
      // project2 should still have full quota
      const result = citationRateLimiter.checkLimit(project2, 1)
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(59)
    })

    test('tokens refill over time', async () => {
      const projectId = 'test-project-5'
      
      // Mock time to control refill
      const mockNow = vi.spyOn(Date, 'now')
      const startTime = 1000000
      mockNow.mockReturnValue(startTime)
      
      // Consume some tokens
      citationRateLimiter.checkLimit(projectId, 10)
      
      // Advance time by 5 seconds (should refill 5 tokens)
      mockNow.mockReturnValue(startTime + 5000)
      
      const status = citationRateLimiter.getStatus(projectId)
      expect(status.tokens).toBe(55) // 50 + 5 refilled
      
      mockNow.mockRestore()
    })
  })

  describe('batch rate limiter', () => {
    test('has separate lower limits for batches', () => {
      const projectId = 'test-batch-project'
      
      // Should allow up to 10 batches
      const results = []
      for (let i = 0; i < 10; i++) {
        results.push(batchRateLimiter.checkLimit(projectId, 1))
      }
      
      expect(results.every(r => r.allowed)).toBe(true)
      expect(results[9].remaining).toBe(0)
      
      // 11th batch should be blocked
      const blocked = batchRateLimiter.checkLimit(projectId, 1)
      expect(blocked.allowed).toBe(false)
    })

    test('calculates correct retry-after time', () => {
      const projectId = 'test-retry-project'
      
      // Consume all tokens
      batchRateLimiter.checkLimit(projectId, 10)
      
      // Next request should provide retry-after
      const result = batchRateLimiter.checkLimit(projectId, 1)
      expect(result.allowed).toBe(false)
      expect(result.retryAfter).toBeGreaterThan(0)
      expect(result.retryAfter).toBeLessThanOrEqual(10) // Should be reasonable
    })
  })

  describe('rate limit headers integration', () => {
    test('provides correct rate limit information', () => {
      const projectId = 'test-headers-project'
      
      const result = citationRateLimiter.checkLimit(projectId, 5)
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(55)
      expect(result.resetTime).toBeGreaterThan(Date.now())
      
      // Verify headers would be correct
      expect(typeof result.resetTime).toBe('number')
      expect(new Date(result.resetTime).toISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })
  })
})