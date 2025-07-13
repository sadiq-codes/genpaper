import { describe, it, expect } from 'vitest'
import { buildCSLFromPaper, validateCSL } from '@/lib/utils/csl'
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
      { ordinal: 0, author: { id: 'author1', name: 'John Doe' } }, 
      { ordinal: 1, author: { id: 'author2', name: 'Jane Smith' } }
    ],
    author_names: ['John Doe', 'Jane Smith'],
    source: 'test',
    citation_count: 10,
    impact_score: 0.8,
    created_at: '2023-01-01T00:00:00Z'
  }

  describe('buildCSLFromPaper', () => {
    it('should convert paper to valid CSL format', () => {
      const csl = buildCSLFromPaper(mockPaper)
      
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
      const csl = buildCSLFromPaper(paperWithoutAuthors)
      
      expect(csl.author).toEqual([])
    })

    it('should handle papers without publication date', () => {
      const paperWithoutDate = { ...mockPaper, publication_date: undefined }
      const csl = buildCSLFromPaper(paperWithoutDate)
      
      expect(csl.issued).toBeUndefined()
    })
  })

  describe('validateCSL', () => {
    it('should validate correct CSL items', () => {
      const validCSL = buildCSLFromPaper(mockPaper)
      expect(validateCSL(validCSL)).toBe(true)
    })

    it('should reject invalid CSL items', () => {
      const invalidCSL = { title: 'Test' } // Missing required fields
      expect(validateCSL(invalidCSL)).toBe(false)
    })
  })


}) 