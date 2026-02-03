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
 * A finding extracted from a paper.
 * This is intentionally flexible - the LLM describes what it found
 * rather than filling predetermined fields.
 */
export interface Finding {
  id: string
  
  // What was found (required)
  claim: string                    // The finding statement
  
  // Evidence (required) 
  evidence: string                 // Direct quote from paper supporting this
  
  // Quantitative value if present (LLM extracts in natural format)
  value?: string                   // "24%", "β=0.34", "n=847", "r=0.52, p<.001"
  valueType?: string               // LLM describes: "prevalence", "correlation", "sample size"
  
  // Nature of the finding (LLM interprets)
  direction?: string               // "positive", "negative", "no effect", "descriptive", "mixed"
  
  // Comparison context
  comparedTo?: string              // What this was compared against
  
  // Study context for this finding
  context?: string                 // Population, setting, conditions
  
  // Importance
  isMainFinding: boolean           // Primary result vs background/secondary
  
  // Extraction quality
  confidence: number               // 0-1
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
