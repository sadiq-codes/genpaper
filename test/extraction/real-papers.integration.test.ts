/**
 * Real Paper Extraction Integration Tests
 * 
 * These tests use REAL PDFs, GROBID, and REAL LLM calls to verify the extraction pipeline.
 * 
 * WARNING: 
 * - These tests make actual API calls and COST MONEY (~$0.10-0.20 per paper)
 * - Tests are SLOW (30-60 seconds per paper)
 * - Requires OPENAI_API_KEY in environment
 * - Requires GROBID service for PDF extraction
 * 
 * Run manually with:
 *   npm test -- --run test/extraction/real-papers.integration.test.ts
 * 
 * Or run a specific paper:
 *   npm test -- --run test/extraction/real-papers.integration.test.ts -t "Tomato"
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'fs/promises'
import { config } from 'dotenv'
import { downloadPdfBuffer } from '@/lib/pdf/pdf-utils'
import { extractPdfMetadataTiered, type TieredExtractionResult } from '@/lib/pdf/tiered-extractor'
import { classifyPaperType, quickClassifyPaperType } from '@/lib/extraction/paper-classifier'
import { extractPaper } from '@/lib/extraction/extractor'
import type { ExtractionInput, ExtractionResult, PaperType } from '@/lib/extraction/types'

// Load environment variables from .env.local
config({ path: '.env.local' })

// Test configuration
const TEST_TIMEOUT = 120000 // 2 minutes per test
const SKIP_SLOW_TESTS = process.env.SKIP_SLOW_TESTS === 'true'

// Test papers configuration
const TEST_PAPERS = {
  cellStress: {
    name: 'Cell Stress (Terrisse 2023)',
    url: 'http://www.cell-stress.com/wp-content/uploads/2023A-Terrisse-Cell-Stress.pdf',
    expectedTypes: ['quantitative', 'review'] as PaperType[],
    description: 'Biomedical research paper on cell stress'
  },
  coreAcUk: {
    name: 'Core.ac.uk Paper',
    url: 'https://files01.core.ac.uk/download/74325531.pdf',
    expectedTypes: ['quantitative', 'qualitative', 'theoretical', 'review', 'mixed_methods'] as PaperType[],
    description: 'Academic paper from Core repository'
  },
  greenland: {
    name: 'Greenland Securitization (Baulund)',
    localPath: '/Users/ameer/Projects/sass/genpaper/lbaulund,+What+kind+of+nation+state+will+Greenland+be_+Securitization+theory+as+a+strategy+for+analyzing+identity+politics++.pdf',
    expectedTypes: ['theoretical', 'qualitative', 'humanities'] as PaperType[],
    description: 'Political science paper on securitization theory'
  },
  tomato: {
    name: 'Tomato Research (Garba)',
    localPath: '/Users/ameer/Projects/sass/genpaper/AJPB+2022+4+2+no+4+Garba+Tomato+28+31+-+Copy.pdf',
    expectedTypes: ['quantitative'] as PaperType[],
    description: 'Agricultural research on tomato cultivation'
  }
}

/**
 * Extract PDF using GROBID (production method)
 */
async function extractPdf(pdfBuffer: Buffer): Promise<TieredExtractionResult> {
  console.log(`   GROBID_URL: ${process.env.GROBID_URL || 'not set (using localhost)'}`)
  
  return await extractPdfMetadataTiered(pdfBuffer, {
    grobidUrl: process.env.GROBID_URL || 'http://localhost:8070',
    enableOcr: false, // Disable OCR for faster tests
    maxTimeoutMs: 60000
  })
}

// Helper to load PDF buffer from URL or local file
async function loadPdfBuffer(paper: { url?: string; localPath?: string }): Promise<Buffer> {
  if (paper.localPath) {
    return await readFile(paper.localPath)
  } else if (paper.url) {
    return await downloadPdfBuffer(paper.url)
  }
  throw new Error('Paper must have either url or localPath')
}

// Helper to create extraction input from PDF result
function createExtractionInput(paperId: string, pdfResult: TieredExtractionResult): ExtractionInput {
  return {
    paperId,
    title: pdfResult.title || 'Unknown Title',
    abstract: pdfResult.abstract,
    fullText: pdfResult.fullText
  }
}

describe('Real Paper Extraction (Integration)', () => {
  beforeAll(() => {
    if (SKIP_SLOW_TESTS) {
      console.log('⏭️  Skipping slow integration tests (SKIP_SLOW_TESTS=true)')
    }
    if (!process.env.OPENAI_API_KEY) {
      console.warn('⚠️  OPENAI_API_KEY not set - LLM-based tests may fail')
    }
    if (!process.env.GROBID_URL) {
      console.warn('⚠️  GROBID_URL not set - will try localhost:8070')
    }
    console.log(`   OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'SET' : 'NOT SET'}`)
    console.log(`   GROBID_URL: ${process.env.GROBID_URL || 'not set'}`)
  })

  // =============================================================================
  // Paper 1: Cell Stress (Terrisse 2023) - Biomedical
  // =============================================================================
  describe('Paper 1: Cell Stress (Terrisse 2023)', () => {
    let pdfBuffer: Buffer
    let pdfResult: TieredExtractionResult
    let extractionResult: ExtractionResult

    it('downloads PDF from URL', async () => {
      if (SKIP_SLOW_TESTS) return
      
      pdfBuffer = await loadPdfBuffer(TEST_PAPERS.cellStress)
      
      expect(pdfBuffer).toBeDefined()
      expect(pdfBuffer.length).toBeGreaterThan(1000)
      console.log(`📥 Downloaded Cell Stress PDF: ${(pdfBuffer.length / 1024).toFixed(1)} KB`)
    }, TEST_TIMEOUT)

    it('extracts text via GROBID', async () => {
      if (SKIP_SLOW_TESTS || !pdfBuffer) return
      
      pdfResult = await extractPdf(pdfBuffer)
      
      expect(pdfResult).toBeDefined()
      expect(pdfResult.fullText || pdfResult.abstract).toBeTruthy()
      
      console.log(`📄 Extracted via: ${pdfResult.extractionMethod}`)
      console.log(`   Title: ${pdfResult.title?.slice(0, 60)}...`)
      console.log(`   Text length: ${pdfResult.fullText?.length || 0} chars`)
    }, TEST_TIMEOUT)

    it('classifies paper type', async () => {
      if (SKIP_SLOW_TESTS || !pdfResult) return
      
      const title = pdfResult.title || TEST_PAPERS.cellStress.name
      const text = pdfResult.fullText || pdfResult.abstract || ''
      
      // Quick classification
      const quickResult = quickClassifyPaperType(title, text.slice(0, 2000))
      console.log(`   Quick: ${quickResult.primaryType} (${(quickResult.confidenceScore * 100).toFixed(0)}%)`)
      
      // Full classification with LLM
      const fullResult = await classifyPaperType(title, text.slice(0, 2000), {
        fullText: text.slice(0, 8000)
      })
      
      console.log(`   Full: ${fullResult.primaryType} (${(fullResult.confidenceScore * 100).toFixed(0)}%)`)
      console.log(`   Indicators: ${fullResult.indicators.slice(0, 3).join(', ')}`)
      
      expect(TEST_PAPERS.cellStress.expectedTypes).toContain(fullResult.primaryType)
    }, TEST_TIMEOUT)

    it('performs full extraction', async () => {
      if (SKIP_SLOW_TESTS || !pdfResult) return
      
      const input = createExtractionInput('cell-stress-test', pdfResult)
      extractionResult = await extractPaper(input)
      
      expect(extractionResult.success).toBe(true)
      expect(extractionResult.extraction).toBeDefined()
      
      const core = extractionResult.extraction?.core
      expect(core?.mainClaims.length).toBeGreaterThan(0)
      
      console.log(`\n📊 Extraction Results:`)
      console.log(`   Paper type: ${core?.paperType.primaryType}`)
      console.log(`   Claims: ${core?.mainClaims.length}`)
      console.log(`   Contributions: ${core?.keyContributions.length}`)
      console.log(`   Domain: ${core?.context.domain}`)
      console.log(`   Extensions: ${extractionResult.extraction?.extensions.join(', ') || 'none'}`)
      
      if (core?.mainClaims[0]) {
        console.log(`\n   First claim: "${core.mainClaims[0].text.slice(0, 100)}..."`)
      }
    }, TEST_TIMEOUT)
  })

  // =============================================================================
  // Paper 2: Core.ac.uk Paper
  // =============================================================================
  describe('Paper 2: Core.ac.uk Paper', () => {
    let pdfBuffer: Buffer
    let pdfResult: TieredExtractionResult
    let extractionResult: ExtractionResult

    it('downloads PDF from URL', async () => {
      if (SKIP_SLOW_TESTS) return
      
      pdfBuffer = await loadPdfBuffer(TEST_PAPERS.coreAcUk)
      
      expect(pdfBuffer).toBeDefined()
      expect(pdfBuffer.length).toBeGreaterThan(1000)
      console.log(`📥 Downloaded Core.ac.uk PDF: ${(pdfBuffer.length / 1024).toFixed(1)} KB`)
    }, TEST_TIMEOUT)

    it('extracts text via GROBID', async () => {
      if (SKIP_SLOW_TESTS || !pdfBuffer) return
      
      pdfResult = await extractPdf(pdfBuffer)
      
      expect(pdfResult).toBeDefined()
      expect(pdfResult.fullText || pdfResult.abstract).toBeTruthy()
      
      console.log(`📄 Extracted via: ${pdfResult.extractionMethod}`)
      console.log(`   Title: ${pdfResult.title?.slice(0, 60) || 'Unknown'}`)
    }, TEST_TIMEOUT)

    it('classifies and extracts paper', async () => {
      if (SKIP_SLOW_TESTS || !pdfResult) return
      
      const input = createExtractionInput('core-ac-uk-test', pdfResult)
      extractionResult = await extractPaper(input)
      
      expect(extractionResult.success).toBe(true)
      
      const core = extractionResult.extraction?.core
      console.log(`\n📊 Results: ${core?.paperType.primaryType}, ${core?.mainClaims.length} claims, domain: ${core?.context.domain}`)
    }, TEST_TIMEOUT)
  })

  // =============================================================================
  // Paper 3: Greenland Securitization (Local PDF)
  // =============================================================================
  describe('Paper 3: Greenland Securitization (Baulund)', () => {
    let pdfBuffer: Buffer
    let pdfResult: TieredExtractionResult
    let extractionResult: ExtractionResult

    it('reads local PDF file', async () => {
      if (SKIP_SLOW_TESTS) return
      
      pdfBuffer = await loadPdfBuffer(TEST_PAPERS.greenland)
      
      expect(pdfBuffer).toBeDefined()
      expect(pdfBuffer.length).toBeGreaterThan(1000)
      console.log(`📥 Read Greenland PDF: ${(pdfBuffer.length / 1024).toFixed(1)} KB`)
    }, TEST_TIMEOUT)

    it('extracts text via GROBID', async () => {
      if (SKIP_SLOW_TESTS || !pdfBuffer) return
      
      pdfResult = await extractPdf(pdfBuffer)
      
      expect(pdfResult).toBeDefined()
      expect(pdfResult.fullText || pdfResult.abstract).toBeTruthy()
      
      console.log(`📄 Extracted via: ${pdfResult.extractionMethod}`)
      console.log(`   Title: ${pdfResult.title?.slice(0, 60) || 'Unknown'}`)
    }, TEST_TIMEOUT)

    it('classifies as theoretical/qualitative', async () => {
      if (SKIP_SLOW_TESTS || !pdfResult) return
      
      const title = pdfResult.title || TEST_PAPERS.greenland.name
      const text = pdfResult.fullText || pdfResult.abstract || ''
      
      const result = await classifyPaperType(title, text.slice(0, 2000), {
        fullText: text.slice(0, 8000)
      })
      
      console.log(`   Classification: ${result.primaryType} (${(result.confidenceScore * 100).toFixed(0)}%)`)
      expect(TEST_PAPERS.greenland.expectedTypes).toContain(result.primaryType)
    }, TEST_TIMEOUT)

    it('performs full extraction', async () => {
      if (SKIP_SLOW_TESTS || !pdfResult) return
      
      const input = createExtractionInput('greenland-test', pdfResult)
      extractionResult = await extractPaper(input)
      
      expect(extractionResult.success).toBe(true)
      
      const core = extractionResult.extraction?.core
      console.log(`\n📊 Results: ${core?.paperType.primaryType}, ${core?.mainClaims.length} claims`)
      
      if (extractionResult.extraction?.theoretical) {
        console.log(`   Theoretical concepts: ${extractionResult.extraction.theoretical.concepts?.length || 0}`)
      }
      if (extractionResult.extraction?.qualitative) {
        console.log(`   Qualitative themes: ${extractionResult.extraction.qualitative.themes?.length || 0}`)
      }
    }, TEST_TIMEOUT)
  })

  // =============================================================================
  // Paper 4: Tomato Research (Local PDF)
  // =============================================================================
  describe('Paper 4: Tomato Research (Garba)', () => {
    let pdfBuffer: Buffer
    let pdfResult: TieredExtractionResult
    let extractionResult: ExtractionResult

    it('reads local PDF file', async () => {
      if (SKIP_SLOW_TESTS) return
      
      pdfBuffer = await loadPdfBuffer(TEST_PAPERS.tomato)
      
      expect(pdfBuffer).toBeDefined()
      expect(pdfBuffer.length).toBeGreaterThan(1000)
      console.log(`📥 Read Tomato PDF: ${(pdfBuffer.length / 1024).toFixed(1)} KB`)
    }, TEST_TIMEOUT)

    it('extracts text via GROBID', async () => {
      if (SKIP_SLOW_TESTS || !pdfBuffer) return
      
      pdfResult = await extractPdf(pdfBuffer)
      
      expect(pdfResult).toBeDefined()
      expect(pdfResult.fullText || pdfResult.abstract).toBeTruthy()
      
      console.log(`📄 Extracted via: ${pdfResult.extractionMethod}`)
      console.log(`   Title: ${pdfResult.title?.slice(0, 60) || 'Unknown'}`)
    }, TEST_TIMEOUT)

    it('classifies as quantitative', async () => {
      if (SKIP_SLOW_TESTS || !pdfResult) return
      
      const title = pdfResult.title || TEST_PAPERS.tomato.name
      const text = pdfResult.fullText || pdfResult.abstract || ''
      
      const result = await classifyPaperType(title, text.slice(0, 2000), {
        fullText: text.slice(0, 8000)
      })
      
      console.log(`   Classification: ${result.primaryType} (${(result.confidenceScore * 100).toFixed(0)}%)`)
      expect(TEST_PAPERS.tomato.expectedTypes).toContain(result.primaryType)
    }, TEST_TIMEOUT)

    it('performs full extraction with quantitative data', async () => {
      if (SKIP_SLOW_TESTS || !pdfResult) return
      
      const input = createExtractionInput('tomato-test', pdfResult)
      extractionResult = await extractPaper(input)
      
      expect(extractionResult.success).toBe(true)
      
      const core = extractionResult.extraction?.core
      console.log(`\n📊 Results: ${core?.paperType.primaryType}, ${core?.mainClaims.length} claims`)
      
      if (extractionResult.extraction?.quantitative) {
        const quant = extractionResult.extraction.quantitative
        console.log(`   Sample size: ${quant.sampleSize || 'N/A'}`)
        console.log(`   Statistical findings: ${quant.statisticalFindings?.length || 0}`)
        console.log(`   Study design: ${quant.studyDesign}`)
        
        if (quant.statisticalFindings?.[0]) {
          const f = quant.statisticalFindings[0]
          console.log(`\n   First finding: "${f.description?.slice(0, 80)}..."`)
        }
      }
    }, TEST_TIMEOUT)
  })

  // =============================================================================
  // Summary
  // =============================================================================
  describe('Summary', () => {
    it('logs test summary', () => {
      if (SKIP_SLOW_TESTS) {
        console.log('\n⏭️  Tests skipped. Run with: npm test -- --run test/extraction/real-papers.integration.test.ts')
        return
      }
      
      console.log('\n' + '='.repeat(60))
      console.log('📋 Real Paper Extraction Test Complete')
      console.log('='.repeat(60))
    })
  })
})
