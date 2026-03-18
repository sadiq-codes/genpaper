/**
 * Paper Extraction Types
 * 
 * Minimal, flexible schema for extracting findings from papers.
 * 
 * Key principles:
 * - No hardcoded field values (LLM describes what it finds)
 * - Findings are the core unit (not paper type)
 * - LLM provides context in natural language
 * - Structure emerges from the data, not predetermined schemas
 * 
 * @module lib/extraction/types
 */

// =============================================================================
// Core Finding Type - The Universal Unit
// =============================================================================

/**
 * Evidence type classification for discipline-aware synthesis.
 */
export type EvidenceType = 
  | 'empirical_quantitative'       // Stats, experiments, surveys with numbers
  | 'empirical_qualitative'        // Interviews, observations, themes
  | 'theoretical'                  // Arguments, frameworks, propositions
  | 'methodological'               // Methods, techniques, procedures
  | 'descriptive'                  // Facts, definitions, descriptions

/**
 * A finding extracted from a paper.
 * Designed for MAXIMUM SPECIFICITY to enable high-quality synthesis.
 */
export interface Finding {
  id: string
  
  // What was found (required) - MUST be specific
  claim: string                    // SPECIFIC statement: WHO/WHAT, FINDING, MAGNITUDE, CONTEXT
  
  // Evidence (required) 
  evidence: string                 // EXACT quote from paper (not paraphrased)
  
  // Quantitative value - MUST be numeric when available
  value?: string                   // "24%", "r=0.67", "β=0.34", "d=0.8", "N=500", "3 themes"
  valueType?: string               // Specific: "percentage", "correlation_r", "effect_size_d", "sample_size", "theme_count"
  confidenceInterval?: string      // "95% CI [1.5-3.4]"
  pValue?: string                  // "p<0.001" or "p=0.034"
  
  // Nature of the finding
  direction?: string               // "positive", "negative", "no_effect", "mixed", "descriptive"
  
  // Comparison context
  comparedTo?: string              // What this was compared against
  
  // Study context for this finding
  context?: string                 // Population, setting, conditions
  
  // Importance
  isMainFinding: boolean           // Primary result vs background/secondary
  
  // Extraction quality
  confidence: number               // 0.7-1.0
  
  // NEW: Evidence type for discipline-aware synthesis
  // Optional for backward compatibility with existing DB records
  evidenceType?: EvidenceType
}

// =============================================================================
// Paper Metadata - LLM Extracted, Not Hardcoded
// =============================================================================

/**
 * Paper metadata extracted by LLM from the text.
 * No pattern matching or heuristics - LLM reads and identifies.
 */
export interface PaperMetadata {
  title: string                    // Actual paper title
  authors: string[]                // Author names
  year?: number                    // Publication year if identifiable
  
  // LLM-identified characteristics (free text)
  domain: string                   // "microbiology", "political science", "psychology"
  paperType: string                // "empirical study", "theoretical paper", "literature review"
  methodology: string              // Brief description of how they did the research
}

// =============================================================================
// Complete Extraction Result
// =============================================================================

/**
 * Complete extraction result for a paper.
 * Minimal structure, maximum flexibility.
 */
export interface PaperExtraction {
  paperId: string
  
  // Metadata
  metadata: PaperMetadata
  
  // Core content - all findings from the paper
  findings: Finding[]
  
  // High-level summary
  researchQuestion?: string        // Main question if stated
  contributions: string[]          // What's novel/new
  limitations: string[]            // Acknowledged limitations
  
  // Extraction quality
  extractionConfidence: number     // Overall confidence
  extractionNotes: string[]        // Issues, uncertainties, observations
  
  // Timing
  extractedAt: Date
  extractionTimeMs: number
  modelUsed: string
}

// =============================================================================
// Extraction Input/Output
// =============================================================================

export interface ExtractionInput {
  paperId: string
  text: string                     // Full text to extract from
  maxFindings?: number             // Optional limit (default: extract all)
}

export interface ExtractionResult {
  success: boolean
  extraction?: PaperExtraction
  error?: string
  timeMs: number
}
