import { describe, it, expect } from 'vitest'
import { getUserIP } from '@/lib/utils/user-location'

describe('User Location Detection', () => {
  describe('getUserIP', () => {
    it('should extract IP from x-forwarded-for header', () => {
      const request = new Request('http://localhost', {
        headers: {
          'x-forwarded-for': '203.0.113.1, 198.51.100.1'
        }
      })

      const ip = getUserIP(request)
      expect(ip).toBe('203.0.113.1')
    })

    it('should extract IP from x-real-ip header', () => {
      const request = new Request('http://localhost', {
        headers: {
          'x-real-ip': '203.0.113.2'
        }
      })

      const ip = getUserIP(request)
      expect(ip).toBe('203.0.113.2')
    })

    it('should extract IP from cf-connecting-ip header (Cloudflare)', () => {
      const request = new Request('http://localhost', {
        headers: {
          'cf-connecting-ip': '203.0.113.3'
        }
      })

      const ip = getUserIP(request)
      expect(ip).toBe('203.0.113.3')
    })

    it('should prioritize x-forwarded-for over other headers', () => {
      const request = new Request('http://localhost', {
        headers: {
          'x-forwarded-for': '203.0.113.1',
          'x-real-ip': '203.0.113.2',
          'cf-connecting-ip': '203.0.113.3'
        }
      })

      const ip = getUserIP(request)
      expect(ip).toBe('203.0.113.1')
    })

    it('should ignore localhost IPs', () => {
      const request = new Request('http://localhost', {
        headers: {
          'x-forwarded-for': '127.0.0.1',
          'x-real-ip': '203.0.113.2'
        }
      })

      const ip = getUserIP(request)
      expect(ip).toBe('203.0.113.2')
    })

    it('should fallback to localhost when no valid IP found', () => {
      const request = new Request('http://localhost', {
        headers: {}
      })

      const ip = getUserIP(request)
      expect(ip).toBe('127.0.0.1')
    })

    it('should handle IPv6 localhost correctly', () => {
      const request = new Request('http://localhost', {
        headers: {
          'x-forwarded-for': '::1',
          'x-real-ip': '203.0.113.2'
        }
      })

      const ip = getUserIP(request)
      expect(ip).toBe('203.0.113.2')
    })
  })
}) 