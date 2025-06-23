import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ingestPaper, type UnifiedIngestOptions } from '@/lib/db/papers'
import { getSB } from '@/lib/supabase/server'
import type { PaperDTO } from '@/lib/schemas/paper'

describe('Unified Paper Ingestion System', () => {
  const testPaperId = 'test-paper-' + Date.now()
  const mockPaper: PaperDTO = {
    title: 'Test Paper: Unified Architecture for Academic Paper Processing',
    abstract: 'This paper presents a unified architecture for academic paper processing that consolidates multiple ingestion pathways into a single, maintainable system.',
    authors: ['Dr. Test Author', 'Prof. Example Researcher'],
    venue: 'Journal of Software Architecture',
    doi: '10.1000/test.2024.unified',
    publication_date: '2024-01-15',
    url: 'https://example.com/test-paper',
    pdf_url: 'https://example.com/test-paper.pdf',
    source: 'test',
    citation_count: 42,
    impact_score: 8.5,
    metadata: {
      test: true,
      scenario: 'unified-ingestion-test'
    }
  }

  beforeEach(async () => {
    // Clean up any existing test data
    const supabase = await getSB()
    await supabase.from('paper_chunks').delete().like('paper_id', 'test-paper-%')
    await supabase.from('papers').delete().like('id', 'test-paper-%')
  })

  afterEach(async () => {
    // Clean up test data
    const supabase = await getSB()
    await supabase.from('paper_chunks').delete().like('paper_id', 'test-paper-%')
    await supabase.from('papers').delete().like('id', 'test-paper-%')
  })

  describe('Basic Ingestion Scenarios', () => {
    it('should handle abstract-only ingestion (lightweight mode)', async () => {
      const result = await ingestPaper(mockPaper, {
        skipContentProcessing: false, // Process abstract for embedding
        backgroundProcessing: false
      })

      expect(result.isNewPaper).toBe(true)
      expect(result.paperId).toBeTruthy()
      expect(result.embedingGenerated).toBe(true)
      expect(result.contentQueued).toBe(false)

      // Verify paper exists in database with embedding
      const supabase = await getSB()
      const { data: paper } = await supabase
        .from('papers')
        .select('*')
        .eq('id', result.paperId)
        .single()

      expect(paper).toBeTruthy()
      expect(paper!.title).toBe(mockPaper.title)
      expect(paper!.embedding).toBeTruthy()
      expect(paper!.embedding).not.toEqual([])
    })

    it('should handle full-text ingestion with immediate processing', async () => {
      const fullText = `
        # Introduction
        This paper presents a comprehensive study of unified architecture patterns.
        
        ## Methodology
        We analyzed multiple ingestion pathways and identified common patterns.
        
        ## Results
        The unified system shows 3x improvement in maintainability and 40% reduction in code duplication.
        
        ## Conclusion
        A single entry point for paper ingestion significantly simplifies the system architecture.
      `

      const result = await ingestPaper(mockPaper, {
        fullText,
        backgroundProcessing: false
      })

      expect(result.isNewPaper).toBe(true)
      expect(result.paperId).toBeTruthy()
      expect(result.embedingGenerated).toBe(true)
      expect(result.contentQueued).toBe(false)

      // Verify chunks were created
      const supabase = await getSB()
      const { data: chunks } = await supabase
        .from('paper_chunks')
        .select('*')
        .eq('paper_id', result.paperId)

      expect(chunks).toBeTruthy()
      expect(chunks!.length).toBeGreaterThan(0)

      // Verify chunks have embeddings
      chunks!.forEach(chunk => {
        expect(chunk.embedding).toBeTruthy()
        expect(chunk.embedding).not.toEqual([])
        expect(chunk.content.length).toBeGreaterThan(0)
      })
    })

    it('should handle PDF URL ingestion with background processing', async () => {
      const result = await ingestPaper(mockPaper, {
        pdfUrl: 'https://example.com/test-paper.pdf',
        priority: 'high',
        backgroundProcessing: true
      })

      expect(result.isNewPaper).toBe(true)
      expect(result.paperId).toBeTruthy()
      expect(result.contentQueued).toBe(true)
      expect(result.embedingGenerated).toBe(true) // Should still generate paper-level embedding from abstract

      // Verify paper exists with metadata
      const supabase = await getSB()
      const { data: paper } = await supabase
        .from('papers')
        .select('*')
        .eq('id', result.paperId)
        .single()

      expect(paper).toBeTruthy()
      expect(paper!.pdf_url).toBe(mockPaper.pdf_url)
      expect(paper!.embedding).toBeTruthy() // Should have abstract embedding
    })
  })

  describe('Idempotency and Duplicate Handling', () => {
    it('should be idempotent when ingesting the same paper twice', async () => {
      // First ingestion
      const result1 = await ingestPaper(mockPaper, {
        skipContentProcessing: false
      })

      expect(result1.isNewPaper).toBe(true)
      const paperId1 = result1.paperId

      // Second ingestion (should return existing)
      const result2 = await ingestPaper(mockPaper, {
        skipContentProcessing: false
      })

      expect(result2.isNewPaper).toBe(false)
      expect(result2.paperId).toBe(paperId1)

      // Verify no duplicates created
      const supabase = await getSB()
      const { count } = await supabase
        .from('papers')
        .select('*', { count: 'exact', head: true })
        .eq('doi', mockPaper.doi)

      expect(count).toBe(1)
    })

    it('should add new content to existing paper when provided', async () => {
      // First: lightweight ingestion
      const result1 = await ingestPaper(mockPaper, {
        skipContentProcessing: false
      })

      expect(result1.isNewPaper).toBe(true)
      const paperId = result1.paperId

      // Second: add full text content
      const fullText = 'This is the full text content of the paper that was not available initially.'
      const result2 = await ingestPaper(mockPaper, {
        fullText,
        backgroundProcessing: false
      })

      expect(result2.isNewPaper).toBe(false)
      expect(result2.paperId).toBe(paperId)
      expect(result2.contentQueued).toBe(true)

      // Verify chunks were added
      const supabase = await getSB()
      const { data: chunks } = await supabase
        .from('paper_chunks')
        .select('*')
        .eq('paper_id', paperId)

      expect(chunks).toBeTruthy()
      expect(chunks!.length).toBeGreaterThan(0)
    })
  })

  describe('Error Handling and Edge Cases', () => {
    it('should handle missing abstract gracefully', async () => {
      const paperWithoutAbstract = { 
        ...mockPaper, 
        abstract: undefined,
        title: 'Paper Without Abstract - Test Case'
      }

      const result = await ingestPaper(paperWithoutAbstract, {
        skipContentProcessing: false
      })

      expect(result.isNewPaper).toBe(true)
      expect(result.paperId).toBeTruthy()
      // Should still work, embedding generated from title only
      expect(result.embedingGenerated).toBe(true)
    })

    it('should handle empty full text gracefully', async () => {
      const result = await ingestPaper(mockPaper, {
        fullText: '',
        backgroundProcessing: false
      })

      expect(result.isNewPaper).toBe(true)
      expect(result.paperId).toBeTruthy()
      // Should fall back to abstract processing
      expect(result.embedingGenerated).toBe(true)
    })

    it('should handle invalid DOI gracefully', async () => {
      const paperWithInvalidDoi = { 
        ...mockPaper, 
        doi: undefined,
        title: 'Paper Without DOI - Test Case'
      }

      const result = await ingestPaper(paperWithInvalidDoi, {
        skipContentProcessing: false
      })

      expect(result.isNewPaper).toBe(true)
      expect(result.paperId).toBeTruthy()
      // Should generate deterministic ID from title + abstract
      expect(result.paperId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    })
  })

  describe('Performance and Chunking', () => {
    it('should handle large content efficiently', async () => {
      // Generate large content (but not too large for tests)
      const largeContent = Array(100).fill(0).map((_, i) => 
        `Section ${i + 1}: This is a substantial paragraph with meaningful content that would be found in academic papers. It discusses various aspects of the research methodology and findings in detail.`
      ).join('\n\n')

      const startTime = Date.now()
      const result = await ingestPaper(mockPaper, {
        fullText: largeContent,
        backgroundProcessing: false
      })
      const processingTime = Date.now() - startTime

      expect(result.isNewPaper).toBe(true)
      expect(result.paperId).toBeTruthy()
      expect(result.embedingGenerated).toBe(true)
      expect(processingTime).toBeLessThan(30000) // Should complete within 30 seconds

      // Verify appropriate chunking
      const supabase = await getSB()
      const { data: chunks } = await supabase
        .from('paper_chunks')
        .select('*')
        .eq('paper_id', result.paperId)

      expect(chunks).toBeTruthy()
      expect(chunks!.length).toBeGreaterThan(1) // Should be split into multiple chunks
      expect(chunks!.length).toBeLessThan(50) // But not too many

      // Verify chunk quality
      chunks!.forEach((chunk, index) => {
        expect(chunk.content.length).toBeGreaterThan(50) // Meaningful content
        expect(chunk.content.length).toBeLessThan(10000) // Not too large
        expect(chunk.chunk_index).toBe(index)
        expect(chunk.embedding).toBeTruthy()
      })
    })
  })

  describe('Database Consistency', () => {
    it('should maintain referential integrity', async () => {
      const result = await ingestPaper(mockPaper, {
        fullText: 'Sample content for referential integrity test',
        backgroundProcessing: false
      })

      const supabase = await getSB()
      
      // Verify paper exists
      const { data: paper } = await supabase
        .from('papers')
        .select('*')
        .eq('id', result.paperId)
        .single()

      expect(paper).toBeTruthy()

      // Verify chunks reference the correct paper
      const { data: chunks } = await supabase
        .from('paper_chunks')
        .select('*')
        .eq('paper_id', result.paperId)

      expect(chunks).toBeTruthy()
      chunks!.forEach(chunk => {
        expect(chunk.paper_id).toBe(result.paperId)
        expect(chunk.processing_status).toBe('completed')
        expect(chunk.error_count).toBe(0)
      })

      // Verify authors are properly linked
      const { data: authors } = await supabase
        .from('paper_authors')
        .select('*, authors(*)')
        .eq('paper_id', result.paperId)

      expect(authors).toBeTruthy()
      expect(authors!.length).toBe(mockPaper.authors!.length)
    })
  })
}) 