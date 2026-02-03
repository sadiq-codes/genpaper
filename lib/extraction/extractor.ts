/**
 * Main Extraction Orchestrator
 * 
 * Coordinates the full extraction pipeline:
 * 1. Classify paper type
 * 2. Extract core fields
 * 3. Extract type-specific extensions
 * 4. Validate and score confidence
 * 
 * @module lib/extraction/extractor
 */

import { classifyPaperType, type ClassificationOptions } from './paper-classifier'
import { extractCore, type CoreExtractionInput, type CoreExtractionOptions } from './core-extractor'
import { extractQuantitative } from './extensions/quantitative'
import { extractQualitative } from './extensions/qualitative'
import { extractTheoretical } from './extensions/theoretical'
import { extractHumanities } from './extensions/humanities'
import { extractReview } from './extensions/review'
import type {
  PaperExtraction,
  ExtractionInput,
  ExtractionOptions,
  ExtractionResult,
  ExtensionType,
  PaperTypeClassification,
  CoreExtraction
} from './types'

// =============================================================================
// Main Extraction Function
// =============================================================================

/**
 * Extract structured data from an academic paper
 * 
 * This is the main entry point for the extraction system.
 * It orchestrates classification, core extraction, and extension extraction.
 * 
 * @param input Paper data to extract from
 * @param options Extraction options
 * @returns Complete extraction result
 */
export async function extractPaper(
  input: ExtractionInput,
  options: ExtractionOptions = {}
): Promise<ExtractionResult> {
  const startTime = Date.now()
  let classificationTimeMs = 0
  let coreExtractionTimeMs = 0
  let extensionExtractionTimeMs = 0
  
  try {
    console.log(`\n🔬 Starting extraction for: "${input.title.slice(0, 60)}..."`)
    
    // Step 1: Classify paper type
    const classificationStart = Date.now()
    const classification = options.forcePaperType
      ? createForcedClassification(options.forcePaperType)
      : await classifyPaperType(
          input.title,
          input.abstract || '',
          {
            fullText: input.fullText,
            forceLLM: true // Use LLM for better accuracy
          }
        )
    classificationTimeMs = Date.now() - classificationStart
    
    console.log(`   📋 Classified as: ${classification.primaryType} (${(classification.confidenceScore * 100).toFixed(0)}%)`)
    
    // Step 2: Extract core fields
    const coreStart = Date.now()
    const coreInput: CoreExtractionInput = {
      paperId: input.paperId,
      title: input.title,
      abstract: input.abstract,
      fullText: input.fullText,
      classification,
      metadata: input.metadata
    }
    
    const core = options.skipCore
      ? createMinimalCore(input, classification)
      : await extractCore(coreInput, {
          maxFullTextTokens: 8000
        })
    coreExtractionTimeMs = Date.now() - coreStart
    
    // Step 3: Determine which extensions to extract
    const extensionsToExtract = options.extensions || classification.suggestedExtensions
    
    console.log(`   🔧 Extracting extensions: ${extensionsToExtract.join(', ') || 'none'}`)
    
    // Step 4: Extract extensions
    const extensionStart = Date.now()
    const extraction = await extractExtensions(
      input,
      extensionsToExtract,
      core,
      options
    )
    extensionExtractionTimeMs = Date.now() - extensionStart
    
    const totalTimeMs = Date.now() - startTime
    
    console.log(`   ✅ Extraction complete in ${totalTimeMs}ms`)
    console.log(`      - Classification: ${classificationTimeMs}ms`)
    console.log(`      - Core: ${coreExtractionTimeMs}ms`)
    console.log(`      - Extensions: ${extensionExtractionTimeMs}ms`)
    
    return {
      success: true,
      extraction,
      classificationTimeMs,
      coreExtractionTimeMs,
      extensionExtractionTimeMs,
      totalTimeMs
    }
  } catch (error) {
    const totalTimeMs = Date.now() - startTime
    console.error(`   ❌ Extraction failed:`, error)
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown extraction error',
      classificationTimeMs,
      coreExtractionTimeMs,
      extensionExtractionTimeMs,
      totalTimeMs
    }
  }
}

// =============================================================================
// Extension Extraction
// =============================================================================

async function extractExtensions(
  input: ExtractionInput,
  extensionsToExtract: ExtensionType[],
  core: CoreExtraction,
  options: ExtractionOptions
): Promise<PaperExtraction> {
  const extraction: PaperExtraction = {
    core,
    extensions: [],
    overallConfidence: core.extractionMetadata.overallConfidence,
    validationStatus: 'pending'
  }
  
  const extractionInput = {
    paperId: input.paperId,
    title: input.title,
    abstract: input.abstract,
    fullText: input.fullText
  }
  
  // Extract each extension in parallel for speed
  const extensionPromises: Promise<void>[] = []
  
  if (extensionsToExtract.includes('quantitative')) {
    extensionPromises.push(
      extractQuantitative(extractionInput)
        .then(result => {
          extraction.quantitative = result
          extraction.extensions.push('quantitative')
        })
        .catch(err => {
          console.warn('Quantitative extraction failed:', err.message)
        })
    )
  }
  
  if (extensionsToExtract.includes('qualitative')) {
    extensionPromises.push(
      extractQualitative(extractionInput)
        .then(result => {
          extraction.qualitative = result
          extraction.extensions.push('qualitative')
        })
        .catch(err => {
          console.warn('Qualitative extraction failed:', err.message)
        })
    )
  }
  
  if (extensionsToExtract.includes('theoretical')) {
    extensionPromises.push(
      extractTheoretical(extractionInput)
        .then(result => {
          extraction.theoretical = result
          extraction.extensions.push('theoretical')
        })
        .catch(err => {
          console.warn('Theoretical extraction failed:', err.message)
        })
    )
  }
  
  if (extensionsToExtract.includes('humanities')) {
    extensionPromises.push(
      extractHumanities(extractionInput)
        .then(result => {
          extraction.humanities = result
          extraction.extensions.push('humanities')
        })
        .catch(err => {
          console.warn('Humanities extraction failed:', err.message)
        })
    )
  }
  
  if (extensionsToExtract.includes('review')) {
    extensionPromises.push(
      extractReview(extractionInput)
        .then(result => {
          extraction.review = result
          extraction.extensions.push('review')
        })
        .catch(err => {
          console.warn('Review extraction failed:', err.message)
        })
    )
  }
  
  await Promise.all(extensionPromises)
  
  // Calculate overall confidence
  extraction.overallConfidence = calculateOverallConfidence(extraction)
  
  return extraction
}

// =============================================================================
// Helper Functions
// =============================================================================

function createForcedClassification(paperType: string): PaperTypeClassification {
  const extensionMap: Record<string, ExtensionType[]> = {
    'quantitative': ['quantitative'],
    'qualitative': ['qualitative'],
    'mixed_methods': ['quantitative', 'qualitative'],
    'theoretical': ['theoretical'],
    'review': ['review'],
    'humanities': ['humanities'],
    'case_study': ['qualitative'],
    'methodological': ['quantitative']
  }
  
  return {
    primaryType: paperType as any,
    confidence: 'high',
    confidenceScore: 1.0,
    indicators: ['Forced classification'],
    suggestedExtensions: extensionMap[paperType] || []
  }
}

function createMinimalCore(
  input: ExtractionInput,
  classification: PaperTypeClassification
): CoreExtraction {
  return {
    paperId: input.paperId,
    paperType: classification,
    title: input.title,
    objectives: [],
    mainClaims: [],
    keyContributions: [],
    methodologySummary: 'Core extraction skipped',
    context: { domain: 'unknown' },
    limitations: [],
    futureWork: [],
    extractionMetadata: {
      extractionVersion: '1.0.0',
      extractedAt: new Date(),
      modelUsed: 'none',
      extractionTimeMs: 0,
      overallConfidence: 0.5,
      warnings: ['Core extraction was skipped']
    }
  }
}

function calculateOverallConfidence(extraction: PaperExtraction): number {
  const confidences: number[] = [extraction.core.extractionMetadata.overallConfidence]
  
  if (extraction.quantitative) {
    confidences.push(extraction.quantitative.extractionConfidence)
  }
  if (extraction.qualitative) {
    confidences.push(extraction.qualitative.extractionConfidence)
  }
  if (extraction.theoretical) {
    confidences.push(extraction.theoretical.extractionConfidence)
  }
  if (extraction.humanities) {
    confidences.push(extraction.humanities.extractionConfidence)
  }
  if (extraction.review) {
    confidences.push(extraction.review.extractionConfidence)
  }
  
  // Weighted average - core counts more
  const coreWeight = 2
  const total = confidences.slice(1).reduce((sum, c) => sum + c, confidences[0] * coreWeight)
  const weights = confidences.length - 1 + coreWeight
  
  return total / weights
}

// =============================================================================
// Batch Extraction
// =============================================================================

export interface BatchExtractionProgress {
  total: number
  completed: number
  failed: number
  currentPaper?: string
}

/**
 * Extract from multiple papers
 * 
 * @param inputs Array of paper inputs
 * @param options Extraction options
 * @param onProgress Progress callback
 * @returns Array of extraction results
 */
export async function extractPapersBatch(
  inputs: ExtractionInput[],
  options: ExtractionOptions = {},
  onProgress?: (progress: BatchExtractionProgress) => void
): Promise<ExtractionResult[]> {
  const results: ExtractionResult[] = []
  let completed = 0
  let failed = 0
  
  // Process sequentially to avoid rate limits
  for (const input of inputs) {
    onProgress?.({
      total: inputs.length,
      completed,
      failed,
      currentPaper: input.title
    })
    
    const result = await extractPaper(input, options)
    results.push(result)
    
    if (result.success) {
      completed++
    } else {
      failed++
    }
  }
  
  onProgress?.({
    total: inputs.length,
    completed,
    failed
  })
  
  console.log(`\n📊 Batch extraction complete: ${completed}/${inputs.length} successful, ${failed} failed`)
  
  return results
}

// =============================================================================
// Extraction from Database Paper
// =============================================================================

/**
 * Extract from a paper already in the database
 * 
 * @param paperId Paper ID in database
 * @param options Extraction options
 * @returns Extraction result
 */
export async function extractFromDatabasePaper(
  paperId: string,
  getPaperData: (id: string) => Promise<{
    title: string
    abstract?: string
    fullText?: string
    authors?: string[]
    year?: number
    venue?: string
    doi?: string
    citationCount?: number
  } | null>,
  options: ExtractionOptions = {}
): Promise<ExtractionResult> {
  const paper = await getPaperData(paperId)
  
  if (!paper) {
    return {
      success: false,
      error: `Paper not found: ${paperId}`,
      classificationTimeMs: 0,
      coreExtractionTimeMs: 0,
      extensionExtractionTimeMs: 0,
      totalTimeMs: 0
    }
  }
  
  return extractPaper({
    paperId,
    title: paper.title,
    abstract: paper.abstract,
    fullText: paper.fullText,
    metadata: {
      authors: paper.authors,
      year: paper.year,
      venue: paper.venue,
      doi: paper.doi,
      citationCount: paper.citationCount
    }
  }, options)
}
