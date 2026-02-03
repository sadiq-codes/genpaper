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
 * A pattern detected across multiple papers.
 * No hardcoded enums - LLM describes what it finds.
 */
export interface Pattern {
  id: string
  
  // What the pattern is (LLM synthesizes)
  claim: string                    // "Bacillus subtilis is prevalent in spoiled tomatoes"
  summary: string                  // Brief explanation of the pattern
  
  // Support from papers
  support: {
    papers: PaperSupport[]         // Which papers, what they found
    count: number                  // How many papers support this
    total: number                  // Total papers analyzed
  }
  
  // Nature of the pattern (LLM describes, not enum)
  direction?: string               // "positive", "negative", "descriptive", etc.
  consistency: string              // "consistent", "mostly consistent", "conflicting"
  
  // Aggregated values (if quantitative)
  values?: {
    summary: string                // "ranging from 24% to 34%"
    individual: string[]           // ["24%", "28%", "34%"]
  }
  
  // Quality assessment
  confidence: number               // 0-1
  limitations?: string             // Any caveats about this pattern
}

// =============================================================================
// Contradiction - Conflicting findings across papers
// =============================================================================

/**
 * A contradiction or disagreement between papers
 */
export interface Contradiction {
  id: string
  description: string              // What's contradictory
  
  // The different positions
  sides: {
    position: string               // "X increases Y" vs "X has no effect"
    papers: PaperSupport[]         // Papers supporting this position
  }[]
  
  // Analysis
  possibleExplanation?: string     // LLM-generated explanation for disagreement
  severity: string                 // "minor", "significant", "fundamental"
  confidence: number
}

// =============================================================================
// Gap - Missing research identified
// =============================================================================

/**
 * A gap in the literature
 */
export interface Gap {
  id: string
  description: string              // What's missing
  type: string                     // LLM describes: "methodological", "population", "temporal", etc.
  relevance: string                // Why it matters
  suggestedBy: string[]            // Paper IDs that mention this gap
  confidence: number
}

// =============================================================================
// Complete Analysis Result
// =============================================================================

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
  summary: string                  // LLM-generated overview of the literature
  keyInsights: string[]            // Top takeaways
  
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
