import { describe, it, expect } from 'vitest'
import { paperToCSL, validateCSL, fixCSL } from '@/lib/utils/csl'
import type { PaperWithAuthors } from '@/types/simplified'

describe('CSL Utilities', () => {
  const mockPaper: PaperWithAuthors = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    title: 'Test Paper Title',
    abstract: 'Test abstract content',
    publication_date: '2023-01-01',
    venue: 'Test Journal',
    doi: '10.1000/test',
    url: 'https://example.com/paper',
    authors: [
      { id: 'author1', name: 'John Doe' }, 
      { id: 'author2', name: 'Jane Smith' }
    ],
    author_names: ['John Doe', 'Jane Smith'],
    source: 'test',
    citation_count: 10,
    impact_score: 0.8,
    created_at: '2023-01-01T00:00:00Z'
  }

  describe('paperToCSL', () => {
    it('should convert paper to valid CSL format', () => {
      const csl = paperToCSL(mockPaper)
      
      expect(csl).toHaveProperty('id', mockPaper.id)
      expect(csl).toHaveProperty('title', mockPaper.title)
      expect(csl).toHaveProperty('type', 'article-journal')
      expect(csl).toHaveProperty('DOI', mockPaper.doi)
      expect(csl).toHaveProperty('URL', mockPaper.url)
      expect(csl.author).toHaveLength(2)
      expect(csl.author?.[0]).toHaveProperty('family', 'Doe')
      expect(csl.author?.[0]).toHaveProperty('given', 'John')
    })

    it('should handle papers without authors', () => {
      const paperWithoutAuthors = { ...mockPaper, authors: [], author_names: [] }
      const csl = paperToCSL(paperWithoutAuthors)
      
      expect(csl.author).toEqual([])
    })

    it('should handle papers without publication date', () => {
      const paperWithoutDate = { ...mockPaper, publication_date: undefined }
      const csl = paperToCSL(paperWithoutDate)
      
      expect(csl.issued).toBeUndefined()
    })
  })

  describe('validateCSL', () => {
    it('should validate correct CSL items', () => {
      const validCSL = paperToCSL(mockPaper)
      expect(validateCSL(validCSL)).toBe(true)
    })

    it('should reject invalid CSL items', () => {
      const invalidCSL = { title: 'Test' } // Missing required fields
      expect(validateCSL(invalidCSL)).toBe(false)
    })
  })

  describe('fixCSL', () => {
    it('should fix common CSL issues', () => {
      const brokenCSL = {
        title: 'Test Title',
        author: 'John Doe', // Should be array
        issued: '2023' // Should be object
      }
      
      const fixed = fixCSL(brokenCSL)
      expect(Array.isArray(fixed.author)).toBe(true)
      expect(typeof fixed.issued).toBe('object')
    })
  })
}) 