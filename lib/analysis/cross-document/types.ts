/**
 * Cross-Document Analysis Types
 * 
 * Types for analyzing patterns across multiple papers.
 * No hardcoded enums - LLM describes what it finds.
 * 
 * @module lib/analysis/cross-document/types
 */

import type { Finding, PaperMetadata } from '@/lib/extraction'

// =============================================================================
// Pattern - A finding that appears across multiple papers
// =============================================================================

/**
 * Evidence from a specific paper supporting a pattern
 */
export interface PaperSupport {
  paperId: string
  paperTitle: string
  findingId: string
  claim: string                    // The specific finding from this paper
  value?: string                   // The value if any ("24%", "β=0.34")
  valueType?: string               // Type of value
  evidence: string                 // Quote from paper
  confidence: number
}

/**
 * Pattern strength classification
 */
export type PatternStrength = 'strong' | 'moderate' | 'emerging'

/**
 * Value range for quantitative patterns
 */
export interface PatternValueRange {
  min?: string
  max?: string
  median?: string
  heterogeneity?: 'low' | 'moderate' | 'high'
}

/**
 * A pattern detected across multiple papers.
 * Enhanced with strength classification and value ranges.
 */
export interface Pattern {
  id: string
  
  // What the pattern is - SPECIFIC claim
  claim: string                    // "6 of 8 studies (75%) found positive correlation between X and Y, with effect sizes ranging from r=0.45 to r=0.72"
  summary: string                  // Brief explanation of the pattern and its significance
  
  // Support from papers
  support: {
    papers: PaperSupport[]         // Which papers, what they found
    count: number                  // How many papers support this
    total: number                  // Total papers analyzed
  }
  
  // Nature of the pattern
  direction?: string               // "positive", "negative", "no_effect", "descriptive", etc.
  consistency: string              // "consistent" (all agree), "mostly_consistent" (75%+), "mixed" (<75%)
  
  // Pattern strength classification
  strength: PatternStrength        // strong (≥50% or ≥4), moderate (3 or 30-49%), emerging (2)
  
  // Aggregated values (if quantitative)
  values?: {
    summary: string                // "effect sizes ranged from d=0.3 to d=0.9 (median d=0.55)"
    individual: string[]           // ["d=0.3", "d=0.5", "d=0.9"]
    range?: PatternValueRange      // Structured range data
  }
  
  // Quality assessment
  confidence: number               // 0-1
  limitations?: string             // Specific caveats about this pattern
}

// =============================================================================
// Contradiction - Conflicting findings across papers
// =============================================================================

/**
 * Contradiction type classification
 */
export type ContradictionType = 
  | 'direct'        // Opposite conclusions: X causes Y vs X does not cause Y
  | 'magnitude'     // Same direction, different strength
  | 'conditional'   // Works in some contexts, not others
  | 'methodological' // Different methods yield different conclusions

/**
 * Evidence strength for contradiction positions
 */
export type EvidenceStrength = 'strong' | 'moderate' | 'weak'

/**
 * A contradiction or disagreement between papers
 */
export interface Contradiction {
  id: string
  description: string              // SPECIFIC description of what's contradictory
  
  // Type of contradiction
  contradictionType?: ContradictionType
  
  // The different positions
  sides: {
    position: string               // "X increases Y" vs "X has no effect"
    papers: PaperSupport[]         // Papers supporting this position
    evidenceStrength?: EvidenceStrength // Quality of evidence for this position
  }[]
  
  // Analysis
  possibleExplanation?: string     // SPECIFIC explanation: methodology, population, temporal context
  resolutionSuggestion?: string    // How might this contradiction be resolved?
  severity: 'minor' | 'moderate' | 'major' // minor (nuance), moderate (reconcilable), major (fundamental)
  confidence: number
}

// =============================================================================
// Gap - Missing research identified
// =============================================================================

/**
 * Gap type classification
 */
export type GapType = 
  | 'population'      // Who is not studied
  | 'methodological'  // What designs/measures are missing
  | 'temporal'        // What time periods are not covered
  | 'geographic'      // Where hasn't been studied
  | 'theoretical'     // What mechanisms are unexplained
  | 'replication'     // What hasn't been confirmed

/**
 * Gap priority level
 */
export type GapPriority = 'high' | 'medium' | 'low'

/**
 * A gap in the literature
 */
export interface Gap {
  id: string
  description: string              // SPECIFIC description of what's missing
  type: GapType                    // Type of gap
  relevance: string                // WHY this gap matters
  suggestedResearchQuestion?: string // CONCRETE research question to address this gap
  suggestedBy: string[]            // Paper IDs that mention this gap
  priority?: GapPriority           // How important is filling this gap?
  confidence: number
}

// =============================================================================
// Complete Analysis Result
// =============================================================================

/**
 * Synthesis strength assessment
 */
export interface SynthesisStrength {
  overallConfidence: 'high' | 'moderate' | 'low'
  evidenceBase: string              // "8 empirical studies, 3 theoretical papers"
  methodologicalDiversity: 'high' | 'moderate' | 'low'
  geographicDiversity: 'high' | 'moderate' | 'low'
  temporalSpread?: string           // "2015-2023"
}

/**
 * Field maturity assessment
 */
export type FieldMaturity = 
  | 'emerging'     // Few studies, many gaps, fundamental questions open
  | 'developing'   // Growing body, some consensus, significant gaps remain
  | 'established'  // Strong consensus, well-replicated findings
  | 'contested'    // Many studies but fundamental disagreements persist

/**
 * Analysis completeness contract.
 * - complete: all analysis batches/calls succeeded
 * - partial: some batches failed but analyzer returned usable output
 * - failed: no usable analysis output could be produced
 */
export interface AnalysisCompleteness {
  status: 'complete' | 'partial' | 'failed'
  totalBatches?: number
  failedBatches?: number
  failedBatchIndexes?: number[]
}

/**
 * Analyzer diagnostics for observability and integrity tracing.
 */
export interface AnalysisDiagnostics {
  packedFindings?: number
  droppedFindings?: number
  truncatedFields?: number
  integrityRepairApplied?: boolean
  integrityErrors?: string[]
}

/**
 * Complete cross-document analysis result
 */
export interface AnalysisResult {
  id: string
  projectId: string
  
  // What was analyzed
  analyzedPapers: number
  totalFindings: number
  
  // Results
  patterns: Pattern[]
  contradictions: Contradiction[]
  gaps: Gap[]
  
  // High-level summary
  summary: string                  // LLM-generated synthesis narrative
  keyInsights: string[]            // Top 5-7 specific takeaways
  
  // NEW: Synthesis quality assessment
  synthesisStrength?: SynthesisStrength
  fieldMaturity?: FieldMaturity

  // NEW: Completeness and diagnostics metadata
  completeness?: AnalysisCompleteness
  diagnostics?: AnalysisDiagnostics
  
  // Metadata
  analyzedAt: Date
  analysisTimeMs: number
  modelUsed: string
  
  // For cache invalidation
  findingsHash: string
}

// =============================================================================
// Input Types
// =============================================================================

/**
 * Input for cross-document analysis
 */
export interface AnalysisInput {
  projectId: string
  findings: FindingWithPaper[]     // All findings with paper context
  topic?: string                   // Optional topic/focus for analysis
  signal?: AbortSignal             // Cancellation signal checked between batches
}

/**
 * Finding with paper metadata attached
 */
export interface FindingWithPaper extends Finding {
  paperId: string
  paperTitle: string
  paperYear?: number
  paperDomain: string
}

// =============================================================================
// Database Types
// =============================================================================

export interface ProjectAnalysisRow {
  id: string
  project_id: string
  patterns: Pattern[]
  contradictions: Contradiction[]
  gaps: Gap[]
  summary: string
  key_insights: string[]
  findings_hash: string
  analyzed_papers: number
  total_findings: number
  analyzed_at: string
  analysis_time_ms: number
  model_used: string
}
