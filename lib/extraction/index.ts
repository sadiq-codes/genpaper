/**
 * Structured Extraction System
 * 
 * This module provides structured data extraction from academic papers.
 * It extracts machine-analyzable data (claims, findings, effect sizes, themes)
 * that can be used for cross-document analysis and synthesis.
 * 
 * Architecture:
 * - Core + Extensions: Universal fields for all papers + type-specific data
 * - Paper Types: quantitative, qualitative, theoretical, humanities, review, etc.
 * - Extraction Pipeline: classify → core extraction → extension extraction
 * 
 * @module lib/extraction
 * 
 * @example
 * ```typescript
 * import { extractPaper } from '@/lib/extraction'
 * 
 * const result = await extractPaper({
 *   paperId: 'abc123',
 *   title: 'Effects of...',
 *   abstract: '...',
 *   fullText: '...'
 * })
 * 
 * if (result.success) {
 *   const { core, quantitative } = result.extraction
 *   console.log(core.mainClaims)
 *   console.log(quantitative?.statisticalFindings)
 * }
 * ```
 */

// Main extraction functions
export {
  extractPaper,
  extractPapersBatch,
  extractFromDatabasePaper,
  type BatchExtractionProgress
} from './extractor'

// Database functions
export {
  saveExtraction,
  getExtraction,
  getExtractions,
  hasExtraction,
  getPapersNeedingExtraction,
  getStatisticalFindings,
  getFindingsByDirection,
  getThematicFindings,
  getAggregateStats
} from './db'

// Classification
export {
  classifyPaperType,
  quickClassifyPaperType,
  type ClassificationOptions
} from './paper-classifier'

// Core extraction
export {
  extractCore,
  extractCoreBatch,
  type CoreExtractionInput,
  type CoreExtractionOptions
} from './core-extractor'

// Extension extractors
export { extractQuantitative } from './extensions/quantitative'
export { extractQualitative } from './extensions/qualitative'
export { extractTheoretical } from './extensions/theoretical'
export { extractHumanities } from './extensions/humanities'
export { extractReview } from './extensions/review'

// Types
export type {
  // Paper classification
  PaperType,
  PaperTypeClassification,
  ConfidenceLevel,
  
  // Core extraction
  CoreExtraction,
  Claim,
  ClaimType,
  PaperSection,
  ResearchContext,
  ExtractionMetadata,
  
  // Quantitative extension
  QuantitativeExtension,
  StatisticalFinding,
  VariableInfo,
  StudyDesign,
  EffectSizeType,
  RelationshipType,
  
  // Qualitative extension
  QualitativeExtension,
  QualitativeTheme,
  QualitativeMethodology,
  QualitativeDataSource,
  ParticipantQuote,
  
  // Theoretical extension
  TheoreticalExtension,
  TheoreticalConcept,
  Proposition,
  TheoreticalContributionType,
  
  // Humanities extension
  HumanitiesExtension,
  InterpretiveClaim,
  HumanitiesApproach,
  
  // Review extension
  ReviewExtension,
  ReviewType,
  
  // Complete extraction
  PaperExtraction,
  ExtensionType,
  
  // Input/Output
  ExtractionInput,
  ExtractionOptions,
  ExtractionResult,
  
  // Database types
  PaperExtractionRow,
  PaperFindingRow
} from './types'
