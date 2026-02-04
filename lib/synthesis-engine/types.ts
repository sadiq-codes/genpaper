/**
 * Synthesis Engine Types
 * 
 * Types for planning and generating literature synthesis.
 * Paper-type aware with structural constraints from PaperProfile.
 * 
 * @module lib/synthesis-engine/types
 */

import type { AnalysisResult } from '@/lib/analysis/cross-document'
// Note: Pattern, Contradiction, Gap, Finding types are used via the re-exported AnalysisResult
import type { PaperProfile } from '@/lib/generation/paper-profile-types'
import type { PaperTypeKey } from '@/types/simplified'

// =============================================================================
// Paper Type Constraints - From PaperProfile
// =============================================================================

/**
 * Section constraint from profile
 */
export interface SectionConstraint {
  key: string                        // e.g., "introduction", "literatureReview"
  name: string                       // Human-readable name
  isLiteratureFocused: boolean       // Should this section get synthesis enrichment?
  required: boolean                  // Is this section required for this paper type?
  minWords?: number
  maxWords?: number
  purpose?: string                   // What this section should accomplish
}

/**
 * Structural constraints derived from PaperProfile
 * Determines what sections are allowed/required and which get synthesis enrichment
 */
export interface StructuralConstraints {
  paperType: PaperTypeKey
  disciplineContext: string          // e.g., "Computer Science", "Psychology"
  
  // Section rules
  requiredSections: SectionConstraint[]
  forbiddenSections: string[]        // Section names that should NOT appear
  
  // Overall limits
  minSections: number
  maxSections: number
  
  // Source expectations
  minSources: number
  idealSources: number
}

// =============================================================================
// Synthesis Plan - LLM-Generated Structure
// =============================================================================

/**
 * Paragraph structure strategy for section writing
 */
export type ParagraphStrategy = 
  | 'pattern_first'       // Lead with main pattern, then supporting evidence
  | 'chronological'       // Trace development over time
  | 'compare_contrast'    // Juxtapose different findings/views
  | 'problem_solution'    // Present issue, then approaches
  | 'general_to_specific' // Start broad, narrow down
  | 'specific_to_general' // Start with examples, build to principles

/**
 * Synthesis intensity level
 */
export type SynthesisLevel = 'high' | 'moderate' | 'low'

/**
 * Structured key point with supporting evidence
 */
export interface StructuredKeyPoint {
  point: string
  supportingPatternIds: string[]
  requiredCitations: string[]
}

/**
 * A planned section of the synthesis
 * Must align with outline sections and paper type constraints
 */
export interface SectionPlan {
  id: string
  
  // Link to outline section (required for pipeline integration)
  outlineSectionKey: string          // Maps to GeneratedOutline section key
  isLiteratureFocused: boolean       // Should this section get synthesis enrichment?
  
  // What this section covers
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
    // NEW: Structured paragraph guidance
    paragraphStrategy?: ParagraphStrategy
    synthesisLevel: SynthesisLevel // high = heavy integration, moderate = some, low = mostly descriptive
  }
  
  // Targets
  targetWordCount: number
  keyPointsToMake: StructuredKeyPoint[]  // Structured key points with supporting evidence
  
  // NEW: Repetition prevention
  mustNotRepeat: string[]          // Claims already established - do not restate
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
 * Now paper-type aware with structural constraints
 */
export interface SynthesisPlanInput {
  projectId: string
  
  // Analysis results
  analysis: AnalysisResult
  
  // Paper metadata for citation
  papers: PaperInfo[]
  
  // NEW: Required paper type context
  paperType: PaperTypeKey
  paperProfile: PaperProfile
  structuralConstraints: StructuralConstraints
  
  // NEW: Outline sections to align with
  outlineSections: OutlineSectionInput[]
  
  // Optional guidance
  targetWordCount?: number         // Default ~3000
  focusAreas?: string[]            // Specific aspects to emphasize
  audienceLevel?: string           // Who is this for
}

/**
 * Outline section input for plan alignment
 */
export interface OutlineSectionInput {
  sectionKey: string               // e.g., "introduction", "literatureReview"
  title: string                    // Human-readable title
  expectedWords?: number
  keyPoints?: string[]
  isLiteratureFocused: boolean     // Should this section get synthesis enrichment?
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
