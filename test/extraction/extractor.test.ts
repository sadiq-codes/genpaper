/**
 * Tests for Paper Extractor
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractPaper } from '@/lib/extraction/extractor'

// Mock the AI module
const mockGenerateObject = vi.fn()
vi.mock('ai', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  generateObject: (...args: unknown[]) => mockGenerateObject(...args),
}))

// Mock the language model
vi.mock('@/lib/ai/vercel-client', () => ({
  getLanguageModel: () => ({ modelId: 'test-model' }),
  getExtractionLanguageModel: () => ({ modelId: 'test-model' }),
}))

describe('Paper Extractor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('extractPaper', () => {
    it('extracts findings from paper text', async () => {
      mockGenerateObject.mockResolvedValue({
        object: {
          metadata: {
            title: 'Test Paper Title',
            authors: ['Author One', 'Author Two'],
            year: 2024,
            domain: 'Computer Science',
            paperType: 'Empirical Study',
            methodology: 'Survey-based research'
          },
          findings: [
            {
              claim: 'Finding one about X',
              evidence: 'Quote from paper supporting finding one',
              value: '75%',
              valueType: 'percentage',
              direction: 'positive',
              comparedTo: 'baseline',
              context: 'in enterprise settings',
              isMainFinding: true,
              confidence: 0.95
            },
            {
              claim: 'Finding two about Y',
              evidence: 'Quote from paper supporting finding two',
              value: null,
              valueType: null,
              direction: 'descriptive',
              comparedTo: null,
              context: null,
              isMainFinding: false,
              confidence: 0.8
            }
          ],
          researchQuestion: 'What is the effect of X on Y?',
          contributions: ['Contribution one', 'Contribution two'],
          limitations: ['Limitation one'],
          extractionNotes: ['Note about extraction']
        }
      })

      const result = await extractPaper({
        paperId: 'test-123',
        text: 'Full paper text here...'
      })

      expect(result.success).toBe(true)
      expect(result.extraction).toBeDefined()
      
      const ext = result.extraction!
      
      // Metadata
      expect(ext.metadata.title).toBe('Test Paper Title')
      expect(ext.metadata.authors).toEqual(['Author One', 'Author Two'])
      expect(ext.metadata.year).toBe(2024)
      expect(ext.metadata.domain).toBe('Computer Science')
      expect(ext.metadata.paperType).toBe('Empirical Study')
      
      // Findings
      expect(ext.findings).toHaveLength(2)
      expect(ext.findings[0].claim).toBe('Finding one about X')
      expect(ext.findings[0].value).toBe('75%')
      expect(ext.findings[0].valueType).toBe('percentage')
      expect(ext.findings[0].direction).toBe('positive')
      expect(ext.findings[0].isMainFinding).toBe(true)
      expect(ext.findings[0].id).toBeDefined() // UUID generated
      
      expect(ext.findings[1].claim).toBe('Finding two about Y')
      expect(ext.findings[1].value).toBeUndefined()
      expect(ext.findings[1].isMainFinding).toBe(false)
      
      // Summary
      expect(ext.researchQuestion).toBe('What is the effect of X on Y?')
      expect(ext.contributions).toEqual(['Contribution one', 'Contribution two'])
      expect(ext.limitations).toEqual(['Limitation one'])
      expect(ext.extractionNotes).toEqual(['Note about extraction'])
      
      // Confidence
      expect(ext.extractionConfidence).toBeCloseTo(0.875) // (0.95 + 0.8) / 2
    })

    it('handles extraction with no findings', async () => {
      mockGenerateObject.mockResolvedValue({
        object: {
          metadata: {
            title: 'Empty Paper',
            authors: [],
            year: null,
            domain: 'Unknown',
            paperType: 'Unknown',
            methodology: 'Unknown'
          },
          findings: [],
          researchQuestion: null,
          contributions: [],
          limitations: [],
          extractionNotes: ['No findings could be extracted']
        }
      })

      const result = await extractPaper({
        paperId: 'test-empty',
        text: 'Minimal text'
      })

      expect(result.success).toBe(true)
      expect(result.extraction!.findings).toHaveLength(0)
      expect(result.extraction!.extractionConfidence).toBe(0)
    })

    it('handles LLM errors gracefully', async () => {
      mockGenerateObject.mockRejectedValue(new Error('LLM API error'))

      const result = await extractPaper({
        paperId: 'test-error',
        text: 'Some text'
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('LLM API error')
      expect(result.extraction).toBeUndefined()
    })

    it('truncates very long text', async () => {
      mockGenerateObject.mockResolvedValue({
        object: {
          metadata: {
            title: 'Long Paper',
            authors: ['Author'],
            year: 2024,
            domain: 'Test',
            paperType: 'Test',
            methodology: 'Test'
          },
          findings: [],
          researchQuestion: null,
          contributions: [],
          limitations: [],
          extractionNotes: []
        }
      })

      // Create text longer than 100k chars
      const longText = 'a'.repeat(150000)

      await extractPaper({
        paperId: 'test-long',
        text: longText
      })

      // Check that the prompt was truncated
      const callArgs = mockGenerateObject.mock.calls[0][0]
      expect(callArgs.prompt.length).toBeLessThan(110000) // 100k + some buffer for prompt text
      expect(callArgs.prompt).toContain('[Text truncated...]')
    })

    it('converts null values to undefined in output', async () => {
      mockGenerateObject.mockResolvedValue({
        object: {
          metadata: {
            title: 'Test',
            authors: [],
            year: null,
            domain: 'Test',
            paperType: 'Test',
            methodology: 'Test'
          },
          findings: [{
            claim: 'Test claim',
            evidence: 'Test evidence',
            value: null,
            valueType: null,
            direction: null,
            comparedTo: null,
            context: null,
            isMainFinding: true,
            confidence: 0.9
          }],
          researchQuestion: null,
          contributions: [],
          limitations: [],
          extractionNotes: []
        }
      })

      const result = await extractPaper({
        paperId: 'test-nulls',
        text: 'Test text'
      })

      expect(result.extraction!.metadata.year).toBeUndefined()
      expect(result.extraction!.researchQuestion).toBeUndefined()
      expect(result.extraction!.findings[0].value).toBeUndefined()
      expect(result.extraction!.findings[0].direction).toBeUndefined()
    })
  })
})
