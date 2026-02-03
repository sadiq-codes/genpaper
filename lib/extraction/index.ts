/**
 * Paper Extraction System
 * 
 * Extracts structured findings from academic papers using LLM.
 * 
 * Key principles:
 * - No hardcoded field values - LLM describes what it finds
 * - Findings are the core unit - works for any paper type
 * - Flexible structure - adapts to any domain or methodology
 * 
 * @module lib/extraction
 * 
 * @example
 * ```typescript
 * import { extractPaper, saveExtraction } from '@/lib/extraction'
 * 
 * const result = await extractPaper({
 *   paperId: 'abc123',
 *   text: fullPaperText
 * })
 * 
 * if (result.success) {
 *   console.log(result.extraction.metadata.title)
 *   console.log(result.extraction.findings)
 *   await saveExtraction(result.extraction)
 * }
 * ```
 */

// Main extraction function
export { extractPaper } from './extractor'

// Database functions (server component version - requires cookies)
export {
  saveExtraction,
  getExtraction,
  getExtractions,
  hasExtraction,
  getPapersNeedingExtraction,
  getFindings,
  getMainFindings,
  getFindingsByDirection,
  getQuantitativeFindings,
  getAggregateStats
} from './db'

// Database functions (service version - for background processing)
export {
  saveExtractionService,
  getExtractionService,
  getExtractionsService,
  hasExtractionService,
  getPapersNeedingExtractionService
} from './db-service'

// Types
export type {
  Finding,
  PaperMetadata,
  PaperExtraction,
  ExtractionInput,
  ExtractionResult
} from './types'
