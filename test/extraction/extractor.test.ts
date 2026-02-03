/**
 * Integration Tests for Paper Extraction System
 * 
 * Tests the full extraction pipeline:
 * 1. Classification → Core Extraction → Extension Extraction
 * 2. Data structure validation
 * 3. Error handling
 * 
 * Note: LLM calls are mocked to avoid costs and flakiness.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock server-only
vi.mock('server-only', () => ({}))

// Mock the AI SDK's generateObject
const mockGenerateObject = vi.fn()
vi.mock('ai', () => ({
  generateObject: (...args: unknown[]) => mockGenerateObject(...args)
}))

// Mock the vercel client
vi.mock('@/lib/ai/vercel-client', () => ({
  getLanguageModel: vi.fn(() => ({
    doGenerate: vi.fn()
  })),
  getModel: vi.fn(() => 'gpt-4o')
}))

// Mock the extension extractors to simplify testing
const mockExtractQuantitative = vi.fn()
const mockExtractQualitative = vi.fn()

vi.mock('@/lib/extraction/extensions/quantitative', () => ({
  extractQuantitative: (...args: unknown[]) => mockExtractQuantitative(...args)
}))

vi.mock('@/lib/extraction/extensions/qualitative', () => ({
  extractQualitative: (...args: unknown[]) => mockExtractQualitative(...args)
}))

import { extractPaper } from '@/lib/extraction/extractor'
import type { ExtractionInput, ExtractionResult, QuantitativeExtension, StatisticalFinding, VariableInfo } from '@/lib/extraction/types'

// Helper to create mock LLM responses
const createMockClassification = () => ({
  primaryType: 'quantitative',
  secondaryType: undefined,
  confidence: 0.85,
  reasoning: 'Paper uses statistical analysis and hypothesis testing',
  indicators: ['regression', 'p-value', 'sample size']
})

const createMockCoreExtraction = () => ({
  researchQuestion: 'What is the relationship between leadership and performance?',
  objectives: ['Test the effect of transformational leadership', 'Examine moderating role of trust'],
  mainClaims: [
    {
      text: 'Transformational leadership positively affects employee performance',
      type: 'finding',
      evidenceQuote: 'Results show a significant positive relationship (β=0.34, p<0.001)',
      section: 'results',
      confidence: 0.9
    },
    {
      text: 'Trust moderates the leadership-performance relationship',
      type: 'finding',
      section: 'results',
      confidence: 0.85
    }
  ],
  keyContributions: [
    'First study to examine trust as moderator in this context',
    'Large sample from multiple industries'
  ],
  methodologySummary: 'Survey-based quantitative study with 500 participants',
  dataSource: 'Survey data from employees in 50 organizations',
  context: {
    domain: 'organizational behavior',
    subDomain: 'leadership',
    geographic: 'United States',
    population: 'Full-time employees',
    setting: 'Multiple industries'
  },
  limitations: [
    'Cross-sectional design limits causal inference',
    'Self-report measures may have common method bias'
  ],
  futureWork: [
    'Longitudinal studies to establish causality',
    'Examination in non-Western contexts'
  ],
  peerReviewed: true,
  overallConfidence: 0.85
})

const createMockQuantitativeExtension = (): Partial<QuantitativeExtension> => ({
  paperId: 'test-paper-123',
  studyDesign: 'cross_sectional',
  sampleSize: 500,
  sampleDescription: 'Full-time employees from 50 organizations',
  variables: {
    independent: [{ name: 'Transformational Leadership', measurementType: 'continuous' }],
    dependent: [{ name: 'Employee Performance', measurementType: 'continuous' }],
    moderator: [{ name: 'Trust', measurementType: 'continuous' }]
  },
  analysisMethod: ['hierarchical regression'],
  statisticalFindings: [
    {
      id: 'finding-1',
      independentVariable: 'Transformational Leadership',
      dependentVariable: 'Employee Performance',
      relationship: 'positive',
      description: 'Main effect of transformational leadership on performance',
      statisticalTest: 'regression',
      effectSize: 0.34,
      effectSizeType: 'beta',
      pValue: 0.001,
      sampleSize: 500,
      isSignificant: true,
      rawQuote: 'β=0.34, p<0.001',
      confidence: 0.9
    }
  ],
  effectSizeReported: true,
  confidenceIntervalsReported: false,
  extractionConfidence: 0.85
})

// Helper to setup all mocks for a successful extraction
function setupSuccessfulExtractionMocks() {
  // Mock classification
  mockGenerateObject.mockResolvedValueOnce({
    object: createMockClassification()
  })
  
  // Mock core extraction
  mockGenerateObject.mockResolvedValueOnce({
    object: createMockCoreExtraction()
  })
  
  // Mock quantitative extension
  mockExtractQuantitative.mockResolvedValueOnce(createMockQuantitativeExtension())
}

describe('Paper Extractor', () => {
  
  beforeEach(() => {
    vi.clearAllMocks()
  })
  
  describe('extractPaper', () => {
    
    it('successfully extracts from a quantitative paper', async () => {
      setupSuccessfulExtractionMocks()
      
      const input: ExtractionInput = {
        paperId: 'test-paper-123',
        title: 'The Effect of Transformational Leadership on Employee Performance',
        abstract: 'Using hierarchical regression analysis on a sample of 500 employees, we tested our hypotheses. Results show a significant positive relationship (β=0.34, p<0.001).',
        fullText: 'Introduction... Methods... Results show significance (p<0.001)... Discussion...'
      }
      
      const result = await extractPaper(input)
      
      expect(result.success).toBe(true)
      expect(result.extraction).toBeDefined()
      expect(result.extraction?.core).toBeDefined()
      expect(result.extraction?.core.paperId).toBe('test-paper-123')
      expect(result.extraction?.core.mainClaims.length).toBeGreaterThan(0)
      expect(result.extraction?.extensions).toContain('quantitative')
    })
    
    it('extracts core fields correctly', async () => {
      setupSuccessfulExtractionMocks()
      
      const input: ExtractionInput = {
        paperId: 'test-paper-456',
        title: 'Leadership Study',
        abstract: 'A quantitative study using regression analysis with n=500.'
      }
      
      const result = await extractPaper(input)
      
      expect(result.success).toBe(true)
      
      const core = result.extraction?.core
      expect(core?.researchQuestion).toBeDefined()
      expect(core?.objectives).toBeInstanceOf(Array)
      expect(core?.mainClaims).toBeInstanceOf(Array)
      expect(core?.keyContributions).toBeInstanceOf(Array)
      expect(core?.methodologySummary).toBeDefined()
      expect(core?.context.domain).toBeDefined()
      expect(core?.limitations).toBeInstanceOf(Array)
      expect(core?.futureWork).toBeInstanceOf(Array)
    })
    
    it('includes extraction metadata', async () => {
      setupSuccessfulExtractionMocks()
      
      const input: ExtractionInput = {
        paperId: 'test-paper-789',
        title: 'Test Paper',
        abstract: 'Using regression with p<0.05 and n=200 participants.'
      }
      
      const result = await extractPaper(input)
      
      expect(result.success).toBe(true)
      expect(result.totalTimeMs).toBeGreaterThanOrEqual(0)
      expect(result.classificationTimeMs).toBeGreaterThanOrEqual(0)
      expect(result.coreExtractionTimeMs).toBeGreaterThanOrEqual(0)
      
      const metadata = result.extraction?.core.extractionMetadata
      expect(metadata?.extractionVersion).toBe('1.0.0')
      expect(metadata?.extractedAt).toBeInstanceOf(Date)
      expect(metadata?.modelUsed).toBeDefined()
    })
    
    it('handles classification failure gracefully', async () => {
      // Mock classification failure
      mockGenerateObject.mockRejectedValueOnce(new Error('API rate limit exceeded'))
      
      const input: ExtractionInput = {
        paperId: 'test-paper-fail',
        title: 'Statistical Analysis Paper',
        abstract: 'Using regression analysis with p<0.05 we found significance.'
      }
      
      const result = await extractPaper(input)
      
      // Should fallback to rule-based classification and continue
      expect(result).toBeDefined()
      expect(result.totalTimeMs).toBeGreaterThanOrEqual(0)
    })
    
    it('handles core extraction failure gracefully', async () => {
      // Mock classification success
      mockGenerateObject.mockResolvedValueOnce({
        object: createMockClassification()
      })
      
      // Mock core extraction failure
      mockGenerateObject.mockRejectedValueOnce(new Error('API error'))
      
      const input: ExtractionInput = {
        paperId: 'test-paper-fail-core',
        title: 'Test Paper',
        abstract: 'Some abstract with regression analysis.'
      }
      
      const result = await extractPaper(input)
      
      // Should return a result (even if not fully successful)
      expect(result).toBeDefined()
      // Extraction continues with minimal core when LLM fails
      expect(result.totalTimeMs).toBeGreaterThanOrEqual(0)
      // The extractor may return success with minimal extraction or failure
      // depending on implementation - we just verify it doesn't throw
    })
    
    it('skips core extraction when skipCore option is set', async () => {
      // Mock classification
      mockGenerateObject.mockResolvedValueOnce({
        object: createMockClassification()
      })
      
      // Mock extension
      mockExtractQuantitative.mockResolvedValueOnce(createMockQuantitativeExtension())
      
      const input: ExtractionInput = {
        paperId: 'test-skip-core',
        title: 'Test Paper',
        abstract: 'Regression analysis with p<0.001 and n=500.'
      }
      
      const result = await extractPaper(input, { skipCore: true })
      
      expect(result.success).toBe(true)
      // Core should be minimal when skipped
      expect(result.extraction?.core.mainClaims).toHaveLength(0)
    })
    
    it('forces specific paper type when specified', async () => {
      // Mock core extraction (no classification needed when type is forced)
      mockGenerateObject.mockResolvedValueOnce({
        object: createMockCoreExtraction()
      })
      
      // Mock qualitative extension
      mockExtractQualitative.mockResolvedValueOnce({
        paperId: 'test-force-type',
        methodology: { approach: 'thematic_analysis' },
        themes: [],
        extractionConfidence: 0.8
      })
      
      const input: ExtractionInput = {
        paperId: 'test-force-type',
        title: 'Interview Study',
        abstract: 'We conducted semi-structured interviews with 25 participants.'
      }
      
      const result = await extractPaper(input, { forcePaperType: 'qualitative' })
      
      expect(result.success).toBe(true)
      expect(result.extraction?.core.paperType.primaryType).toBe('qualitative')
      expect(result.extraction?.extensions).toContain('qualitative')
    })
  })
  
  describe('claims extraction', () => {
    it('extracts claims with proper structure', async () => {
      setupSuccessfulExtractionMocks()
      
      const input: ExtractionInput = {
        paperId: 'test-claims',
        title: 'Test Paper',
        abstract: 'Regression analysis with statistical significance.'
      }
      
      const result = await extractPaper(input)
      
      expect(result.success).toBe(true)
      
      const claims = result.extraction?.core.mainClaims || []
      expect(claims.length).toBeGreaterThan(0)
      
      // Each claim should have required fields
      for (const claim of claims) {
        expect(claim.id).toBeDefined() // UUID generated
        expect(claim.text).toBeDefined()
        expect(claim.type).toBeDefined()
        expect(claim.section).toBeDefined()
        expect(claim.confidence).toBeGreaterThanOrEqual(0)
        expect(claim.confidence).toBeLessThanOrEqual(1)
      }
    })
    
    it('includes evidence quotes when available', async () => {
      setupSuccessfulExtractionMocks()
      
      const input: ExtractionInput = {
        paperId: 'test-evidence',
        title: 'Test Paper',
        abstract: 'Results show significance with regression.'
      }
      
      const result = await extractPaper(input)
      
      const claims = result.extraction?.core.mainClaims || []
      const claimWithEvidence = claims.find(c => c.evidenceQuote)
      
      expect(claimWithEvidence).toBeDefined()
      expect(claimWithEvidence?.evidenceQuote).toContain('β=0.34')
    })
  })
  
  describe('quantitative extension', () => {
    it('extracts statistical findings', async () => {
      setupSuccessfulExtractionMocks()
      
      const input: ExtractionInput = {
        paperId: 'test-stats',
        title: 'Statistical Study',
        abstract: 'Regression analysis with p<0.001 and n=500.'
      }
      
      const result = await extractPaper(input)
      
      expect(result.success).toBe(true)
      expect(result.extraction?.quantitative).toBeDefined()
      
      const quant = result.extraction?.quantitative
      expect(quant?.statisticalFindings).toBeInstanceOf(Array)
      expect(quant?.statisticalFindings.length).toBeGreaterThan(0)
      
      const finding = quant?.statisticalFindings[0]
      expect(finding?.effectSize).toBe(0.34)
      expect(finding?.pValue).toBe(0.001)
      expect(finding?.isSignificant).toBe(true)
      expect(finding?.relationship).toBe('positive')
    })
    
    it('extracts sample information', async () => {
      setupSuccessfulExtractionMocks()
      
      const input: ExtractionInput = {
        paperId: 'test-sample',
        title: 'Survey Study',
        abstract: 'Sample of n=500 participants using regression.'
      }
      
      const result = await extractPaper(input)
      
      expect(result.extraction?.quantitative?.sampleSize).toBeDefined()
      expect(result.extraction?.quantitative?.sampleSize).toBe(500)
    })
    
    it('extracts variable information', async () => {
      setupSuccessfulExtractionMocks()
      
      const input: ExtractionInput = {
        paperId: 'test-vars',
        title: 'Variable Study',
        abstract: 'IV and DV analysis with regression.'
      }
      
      const result = await extractPaper(input)
      
      const vars = result.extraction?.quantitative?.variables
      expect(vars).toBeDefined()
      
      // Variables are organized by type
      const ivs = vars?.independent || []
      const dvs = vars?.dependent || []
      
      expect(ivs.length).toBeGreaterThan(0)
      expect(dvs.length).toBeGreaterThan(0)
    })
  })
  
  describe('extraction result structure', () => {
    it('returns proper ExtractionResult structure', async () => {
      setupSuccessfulExtractionMocks()
      
      const input: ExtractionInput = {
        paperId: 'test-structure',
        title: 'Test Paper',
        abstract: 'Regression analysis study.'
      }
      
      const result: ExtractionResult = await extractPaper(input)
      
      // Check all expected fields
      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('totalTimeMs')
      expect(result).toHaveProperty('classificationTimeMs')
      expect(result).toHaveProperty('coreExtractionTimeMs')
      expect(result).toHaveProperty('extensionExtractionTimeMs')
      
      if (result.success) {
        expect(result).toHaveProperty('extraction')
        expect(result.extraction).toHaveProperty('core')
        expect(result.extraction).toHaveProperty('extensions')
        expect(result.extraction).toHaveProperty('overallConfidence')
        expect(result.extraction).toHaveProperty('validationStatus')
      }
    })
    
    it('sets validationStatus to pending for new extractions', async () => {
      setupSuccessfulExtractionMocks()
      
      const input: ExtractionInput = {
        paperId: 'test-validation-status',
        title: 'Test Paper',
        abstract: 'Some abstract with regression analysis.'
      }
      
      const result = await extractPaper(input)
      
      expect(result.extraction?.validationStatus).toBe('pending')
    })
  })
})
