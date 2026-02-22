/**
 * Cross-Document Analysis Module
 * 
 * Analyzes findings across multiple papers to identify patterns,
 * contradictions, and gaps in the literature.
 * 
 * @module lib/analysis/cross-document
 * 
 * @example
 * ```typescript
 * import { analyzeFindings, saveAnalysis } from '@/lib/analysis/cross-document'
 * 
 * const result = await analyzeFindings({
 *   projectId: 'xxx',
 *   findings: findingsWithPaperContext
 * })
 * 
 * console.log(result.patterns)       // Patterns across papers
 * console.log(result.contradictions) // Disagreements
 * console.log(result.gaps)           // Missing research
 * console.log(result.summary)        // Overall narrative
 * 
 * await saveAnalysis(result)
 * ```
 */

// Main analysis function
export { analyzeFindings } from './analyzer'
export {
  isAnalysisReadyForSynthesis,
  getAnalysisReadinessIssue,
} from './contract'

// Database functions
export {
  saveAnalysis,
  getAnalysis,
  getCachedAnalysis,
  hasValidAnalysis,
  cleanupOldAnalyses
} from './db'

// Types
export type {
  // Core result types
  Pattern,
  Contradiction,
  Gap,
  AnalysisResult,
  
  // Supporting types
  PaperSupport,
  FindingWithPaper,
  AnalysisInput,
  
  // Database types
  ProjectAnalysisRow
} from './types'
