/**
 * Tests for Extraction Database Service
 * 
 * Tests the save/load/query operations for paper extractions.
 * Uses mocked Supabase client to avoid actual database calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock server-only
vi.mock('server-only', () => ({}))

// Build mock supabase chain
let mockExtractionData: any[] = []
let mockFindingData: any[] = []
let lastInsertedId = 'extraction-123'

const createMockChain = (table?: string) => {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockImplementation(async () => {
      if (mockExtractionData.length > 0) {
        return { data: mockExtractionData[0], error: null }
      }
      return { data: null, error: null }
    })
  }
  
  // Insert returns a chainable object
  chain.insert = vi.fn().mockImplementation((rows: any) => {
    if (table === 'paper_extractions') {
      mockExtractionData.push(...(Array.isArray(rows) ? rows : [rows]))
    } else if (table === 'paper_findings') {
      mockFindingData.push(...(Array.isArray(rows) ? rows : [rows]))
    }
    
    // Return chainable object
    return {
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: lastInsertedId },
          error: null
        })
      })
    }
  })
  
  return chain
}

const mockFrom = vi.fn((table: string) => createMockChain(table))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: mockFrom
  }))
}))

import { saveExtraction, getExtraction, hasExtraction } from '@/lib/extraction/db'
import type { PaperExtraction, CoreExtraction, QuantitativeExtension } from '@/lib/extraction/types'

// Helper to create a mock extraction
function createMockExtraction(paperId: string = 'paper-123'): PaperExtraction {
  const core: CoreExtraction = {
    paperId,
    paperType: {
      primaryType: 'quantitative',
      confidence: 'high',
      confidenceScore: 0.9,
      indicators: ['regression', 'p-value'],
      suggestedExtensions: ['quantitative']
    },
    title: 'Test Paper Title',
    objectives: ['Objective 1', 'Objective 2'],
    mainClaims: [
      {
        id: 'claim-1',
        text: 'Leadership positively affects performance',
        type: 'finding',
        evidenceQuote: 'β=0.34, p<0.001',
        section: 'results',
        confidence: 0.9
      }
    ],
    keyContributions: ['Contribution 1'],
    methodologySummary: 'Quantitative survey study',
    context: {
      domain: 'organizational behavior'
    },
    limitations: ['Limitation 1'],
    futureWork: ['Future work 1'],
    extractionMetadata: {
      extractionVersion: '1.0.0',
      extractedAt: new Date(),
      modelUsed: 'gpt-4o',
      extractionTimeMs: 1500,
      overallConfidence: 0.85,
      warnings: []
    }
  }
  
  const quantitative: QuantitativeExtension = {
    paperId,
    studyDesign: 'cross_sectional',
    sampleSize: 500,
    sampleDescription: 'Employees from 50 organizations',
    variables: {
      independent: [{ name: 'Leadership' }],
      dependent: [{ name: 'Performance' }]
    },
    analysisMethod: ['regression'],
    statisticalFindings: [
      {
        id: 'finding-1',
        description: 'Positive effect of leadership',
        relationship: 'positive',
        independentVariable: 'Leadership',
        dependentVariable: 'Performance',
        effectSize: 0.34,
        effectSizeType: 'beta',
        pValue: 0.001,
        sampleSize: 500,
        isSignificant: true,
        confidence: 0.9,
        rawQuote: 'β=0.34, p<0.001'
      }
    ],
    effectSizeReported: true,
    confidenceIntervalsReported: false,
    extractionConfidence: 0.85
  }
  
  return {
    core,
    quantitative,
    extensions: ['quantitative'],
    overallConfidence: 0.85,
    validationStatus: 'pending'
  }
}

describe('Extraction Database Service', () => {
  
  beforeEach(() => {
    vi.clearAllMocks()
    mockExtractionData = []
    mockFindingData = []
    lastInsertedId = 'extraction-' + Date.now()
  })
  
  describe('saveExtraction', () => {
    
    it('saves extraction to paper_extractions table', async () => {
      const extraction = createMockExtraction('paper-123')
      
      const resultId = await saveExtraction(extraction)
      
      expect(resultId).toBeDefined()
      expect(mockFrom).toHaveBeenCalledWith('paper_extractions')
    })
    
    it('includes all core extraction fields', async () => {
      const extraction = createMockExtraction('paper-456')
      
      await saveExtraction(extraction)
      
      // Check that the extraction data includes expected fields
      expect(mockExtractionData.length).toBeGreaterThan(0)
      const saved = mockExtractionData[0]
      
      expect(saved.paper_id).toBe('paper-456')
      expect(saved.paper_type).toBe('quantitative')
      expect(saved.paper_type_confidence).toBe(0.9)
      expect(saved.overall_confidence).toBe(0.85)
      expect(saved.validation_status).toBe('pending')
      expect(saved.model_used).toBe('gpt-4o')
      expect(saved.core_extraction).toBeDefined()
    })
    
    it('saves quantitative extension when present', async () => {
      const extraction = createMockExtraction('paper-789')
      
      await saveExtraction(extraction)
      
      const saved = mockExtractionData[0]
      expect(saved.quantitative_extension).toBeDefined()
      expect(saved.quantitative_extension.sampleSize).toBe(500)
    })
    
    it('saves normalized findings to paper_findings table', async () => {
      const extraction = createMockExtraction('paper-findings')
      
      await saveExtraction(extraction)
      
      // Should have called from('paper_findings') to save normalized findings
      const findingsCalls = mockFrom.mock.calls.filter(
        (call: any[]) => call[0] === 'paper_findings'
      )
      expect(findingsCalls.length).toBeGreaterThan(0)
    })
    
    it('increments extraction version for same paper', async () => {
      // First extraction exists
      mockExtractionData = [{ extraction_version: 1 }]
      
      const extraction = createMockExtraction('paper-version')
      
      // The mock returns existing version 1, so new should be version 2
      await saveExtraction(extraction)
      
      // Clear and check second save
      const savedData = [...mockExtractionData]
      expect(savedData[savedData.length - 1].extraction_version).toBe(2)
    })
    
    it('handles papers with no extensions', async () => {
      const extraction = createMockExtraction('paper-no-ext')
      extraction.quantitative = undefined
      extraction.extensions = []
      
      await saveExtraction(extraction)
      
      const saved = mockExtractionData[0]
      expect(saved.quantitative_extension).toBeUndefined()
    })
  })
  
  describe('hasExtraction', () => {
    
    it('returns true when extraction exists', async () => {
      // Setup mock to return existing extraction
      mockExtractionData = [{ id: 'existing-extraction' }]
      
      const result = await hasExtraction('paper-with-extraction')
      
      expect(mockFrom).toHaveBeenCalledWith('paper_extractions')
    })
    
    it('returns false when no extraction exists', async () => {
      mockExtractionData = []
      
      const result = await hasExtraction('paper-without-extraction')
      
      expect(mockFrom).toHaveBeenCalledWith('paper_extractions')
    })
  })
  
  describe('data structure validation', () => {
    
    it('stores claims with proper structure', async () => {
      const extraction = createMockExtraction('paper-claims')
      extraction.core.mainClaims = [
        {
          id: 'claim-1',
          text: 'Test claim text',
          type: 'finding',
          evidenceQuote: 'Direct quote from paper',
          section: 'results',
          confidence: 0.95
        }
      ]
      
      await saveExtraction(extraction)
      
      const saved = mockExtractionData[0]
      expect(saved.core_extraction.mainClaims[0].id).toBe('claim-1')
      expect(saved.core_extraction.mainClaims[0].text).toBe('Test claim text')
      expect(saved.core_extraction.mainClaims[0].type).toBe('finding')
    })
    
    it('stores statistical findings with effect sizes', async () => {
      const extraction = createMockExtraction('paper-stats')
      
      await saveExtraction(extraction)
      
      const saved = mockExtractionData[0]
      const finding = saved.quantitative_extension.statisticalFindings[0]
      
      expect(finding.effectSize).toBe(0.34)
      expect(finding.effectSizeType).toBe('beta')
      expect(finding.pValue).toBe(0.001)
      expect(finding.isSignificant).toBe(true)
    })
    
    it('preserves extraction metadata', async () => {
      const extraction = createMockExtraction('paper-meta')
      
      await saveExtraction(extraction)
      
      const saved = mockExtractionData[0]
      expect(saved.extraction_time_ms).toBe(1500)
      expect(saved.model_used).toBe('gpt-4o')
    })
  })
})
