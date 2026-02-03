/**
 * Synthesis Engine Types
 * 
 * Types for planning and generating literature synthesis.
 * No hardcoded enums - LLM decides structure and approach.
 * 
 * @module lib/synthesis-engine/types
 */

import type { Pattern, Contradiction, Gap, AnalysisResult } from '@/lib/analysis/cross-document'
import type { Finding } from '@/lib/extraction'

// =============================================================================
// Synthesis Plan - LLM-Generated Structure
// =============================================================================

/**
 * A planned section of the synthesis
 * LLM decides structure, approach, and content allocation
 */
export interface SectionPlan {
  id: string
  
  // What this section covers (LLM decides)
  title: string                    // Section title
  purpose: string                  // What this section accomplishes
  
  // Content to include
  content: {
    patterns: PatternPlan[]        // Which patterns to discuss
    contradictions: ContradictionPlan[]
    gaps: GapPlan[]
    additionalPoints: string[]     // Other points to make
  }
  
  // Papers to cite
  papers: {
    primary: string[]              // Must cite (paper IDs)
    supporting: string[]           // Can cite if needed
  }
  
  // Writing guidance (LLM decides approach)
  writingGuidance: {
    approach: string               // e.g., "Start with strongest evidence, then address limitations"
    tone: string                   // e.g., "analytical", "critical", "descriptive"
    transitionFrom?: string        // How to connect from previous section
    transitionTo?: string          // How to lead into next section
  }
  
  // Targets
  targetWordCount: number
  keyPointsToMake: string[]        // Main takeaways for this section
}

/**
 * Plan for discussing a pattern
 */
export interface PatternPlan {
  patternId: string
  claim: string                    // The pattern claim
  
  // How to present (LLM decides)
  importance: string               // "central", "supporting", "minor"
  presentationApproach: string     // e.g., "Lead with statistics, then explain mechanism"
  
  // Data to include
  data: {
    supportStatement: string       // e.g., "6 of 8 studies (75%) found..."
    valuesSummary?: string         // e.g., "ranging from 24% to 34%"
    contextNotes?: string          // Any important context
  }
  
  // Papers supporting this pattern
  supportingPaperIds: string[]
}

/**
 * Plan for discussing a contradiction
 */
export interface ContradictionPlan {
  contradictionId: string
  description: string
  
  // How to present
  presentationApproach: string     // e.g., "Present both sides fairly, then offer explanation"
  resolutionStrategy?: string      // How to address/explain the contradiction
  
  // Papers on each side
  sides: {
    position: string
    paperIds: string[]
  }[]
}

/**
 * Plan for discussing a gap
 */
export interface GapPlan {
  gapId: string
  description: string
  
  // How to present
  importance: string               // Why this gap matters
  suggestedFutureWork?: string     // What research could address it
}

/**
 * Complete synthesis plan
 */
export interface SynthesisPlan {
  id: string
  projectId: string
  
  // Overall structure (LLM decides)
  overview: {
    title: string                  // Suggested title for the synthesis
    abstract: string               // Brief overview of what the synthesis covers
    totalSections: number
    totalWordCount: number
    narrativeStrategy: string      // Overall approach to the synthesis
  }
  
  // Sections in order
  sections: SectionPlan[]
  
  // Global guidance
  globalGuidance: {
    audienceLevel: string          // e.g., "academic", "practitioner", "general"
    writingStyle: string           // e.g., "formal academic", "accessible"
    citationApproach: string       // e.g., "integrate naturally", "use parenthetical"
    keyThemes: string[]            // Themes that should run through the synthesis
  }
  
  // Metadata
  generatedAt: Date
  generationTimeMs: number
  modelUsed: string
  
  // Input summary
  inputSummary: {
    totalPapers: number
    totalFindings: number
    patternsFound: number
    contradictionsFound: number
    gapsFound: number
  }
}

// =============================================================================
// Input Types
// =============================================================================

/**
 * Input for synthesis plan generation
 */
export interface SynthesisPlanInput {
  projectId: string
  
  // Analysis results
  analysis: AnalysisResult
  
  // Optional guidance
  targetWordCount?: number         // Default ~3000
  targetSections?: number          // Default: LLM decides
  focusAreas?: string[]            // Specific aspects to emphasize
  audienceLevel?: string           // Who is this for
  
  // Paper metadata for citation
  papers: PaperInfo[]
}

/**
 * Paper info for citation planning
 */
export interface PaperInfo {
  id: string
  title: string
  authors: string[]
  year?: number
  domain: string
}

/**
 * Result of plan generation
 */
export interface SynthesisPlanResult {
  success: boolean
  plan?: SynthesisPlan
  error?: string
  timeMs: number
}
