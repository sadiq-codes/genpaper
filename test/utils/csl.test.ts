import { describe, it, expect } from 'vitest'
import { buildCSLFromPaper, validateCSL } from '@/lib/utils/csl'
import { formatInlineCitation, BIBLIOGRAPHY_STYLES, CitationService } from '@/lib/citations/immediate-bibliography'
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

  describe('Golden Tests: Citation Formatting', () => {
    const goldenCSL = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      title: 'Artificial Intelligence in Healthcare: A Comprehensive Review',
      author: [
        { family: 'Smith', given: 'John A.' },
        { family: 'Johnson', given: 'Maria K.' },
        { family: 'Chen', given: 'Wei' }
      ],
      issued: { 'date-parts': [[2023, 6, 15]] },
      'container-title': 'Journal of Medical AI',
      volume: '45',
      issue: '3',
      page: '123-145',
      DOI: '10.1000/jmai.2023.123456',
      type: 'article-journal'
    }

    describe('Inline Citation Formatting', () => {
      it('should format APA inline citations consistently', () => {
        const apa1 = formatInlineCitation(goldenCSL, 'apa', 1)
        const apa3 = formatInlineCitation(goldenCSL, 'apa', 3)
        
        // Golden snapshots
        expect(apa1).toBe('(Smith et al., 2023)')
        expect(apa3).toBe('(Smith et al., 2023)')
      })

      it('should format IEEE inline citations consistently', () => {
        const ieee1 = formatInlineCitation(goldenCSL, 'ieee', 1)
        const ieee5 = formatInlineCitation(goldenCSL, 'ieee', 5)
        
        // Golden snapshots
        expect(ieee1).toBe('[1]')
        expect(ieee5).toBe('[5]')
      })
    })

    describe('Bibliography Formatting', () => {
      it('should format APA bibliography entries consistently', () => {
        const mockEntry = {
          number: 1,
          paper_id: goldenCSL.id,
          csl_json: goldenCSL,
          reason: 'test'
        }
        
        const apaFormat = BIBLIOGRAPHY_STYLES.apa.format(mockEntry)
        
        // Golden snapshot - verify exact format
        expect(apaFormat).toContain('Smith, J. A., Johnson, M. K., & Chen, W. (2023)')
        expect(apaFormat).toContain('Artificial Intelligence in Healthcare: A Comprehensive Review')
        expect(apaFormat).toContain('*Journal of Medical AI*')
        expect(apaFormat).toContain('https://doi.org/10.1000/jmai.2023.123456')
      })

      it('should format IEEE bibliography entries consistently', () => {
        const mockEntry = {
          number: 1,
          paper_id: goldenCSL.id,
          csl_json: goldenCSL,
          reason: 'test'
        }
        
        const ieeeFormat = BIBLIOGRAPHY_STYLES.ieee.format(mockEntry)
        
        // Golden snapshot - verify IEEE format
        expect(ieeeFormat).toContain('[1] J. A. Smith, M. K. Johnson, and W. Chen')
        expect(ieeeFormat).toContain('"Artificial Intelligence in Healthcare: A Comprehensive Review,"')
        expect(ieeeFormat).toContain('*Journal of Medical AI*')
        expect(ieeeFormat).toContain('doi: 10.1000/jmai.2023.123456')
      })
    })

    describe('Cross-Style Consistency', () => {
      it('should maintain formatting stability across changes', () => {
        const mockEntry = {
          number: 1,
          paper_id: goldenCSL.id,
          csl_json: goldenCSL,
          reason: 'test'
        }

        // Lock formatting to prevent regressions
        const formats = {
          apa: BIBLIOGRAPHY_STYLES.apa.format(mockEntry),
          mla: BIBLIOGRAPHY_STYLES.mla.format(mockEntry),
          chicago: BIBLIOGRAPHY_STYLES.chicago.format(mockEntry),
          ieee: BIBLIOGRAPHY_STYLES.ieee.format(mockEntry)
        }

        // All should contain the title
        Object.values(formats).forEach(format => {
          expect(format).toContain('Artificial Intelligence in Healthcare')
        })

        // Check format-specific patterns are stable
        expect(formats.apa).toMatch(/Smith, J\. A\..*\(2023\)/)
        expect(formats.ieee).toMatch(/\[1\] J\. A\. Smith/)
        expect(formats.mla).toContain('Smith, John A.')
        expect(formats.chicago).toMatch(/Smith.*2023/)
      })
    })
  })
}) 