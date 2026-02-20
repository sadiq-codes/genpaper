/**
 * Synthesis Engine
 * 
 * Paper-type-aware hybrid synthesis system combining:
 * - Structured extraction and analysis (the brain)
 * - RAG chunk retrieval (the brawn)
 * - Paper type constraints from PaperProfile
 * 
 * Key components:
 * - Plan Builder: Creates paper-type-aware synthesis plans
 * - Constraint Builder: Extracts structural rules from PaperProfile
 * - Outline Enricher: Maps synthesis content to outline sections
 * 
 * @module lib/synthesis-engine
 */

// =============================================================================
// Types - Core (Planning & Constraints)
// =============================================================================
export type {
  SynthesisPlan,
  SynthesisPlanInput,
  SynthesisPlanResult,
  SectionPlan,
  PatternPlan,
  ContradictionPlan,
  GapPlan,
  PaperInfo,
  StructuralConstraints,
  SectionConstraint,
  OutlineSectionInput
} from './types'

export type {
  HybridSectionContext,
  HybridContextConfig
} from './hybrid-context'

export type {
  TargetedChunk,
  PatternChunks,
  RetrievalConfig
} from './hybrid-retrieval'

// =============================================================================
// Types - Formatters
// =============================================================================
export type {
  FormattedPattern,
  FormattedContradiction,
  FormattedGap,
  FormattedWritingGuidance,
  FormattedSynthesisSummary,
  SynthesisPromptData
} from './formatters'

// =============================================================================
// Functions - Planning (Phase 3)
// =============================================================================
export { buildSynthesisPlan } from './plan-builder'

export {
  buildHybridSectionContext,
  buildAllHybridContexts,
  formatHybridContextForPrompt
} from './hybrid-context'

export {
  retrieveChunksForPattern,
  retrieveChunksForContradiction,
  retrieveChunksForSection,
  getChunksByPaperIds
} from './hybrid-retrieval'

// =============================================================================
// Functions - Formatters
// =============================================================================
export {
  formatSectionForPrompt,
  formatPlanOverviewForPrompt,
  formatAllPatterns,
  formatAllContradictions,
  formatAllGaps,
  mergeSynthesisIntoPromptData
} from './formatters'

// =============================================================================
// Pipeline Integration (Server-only)
// =============================================================================
// Note: Pipeline integration functions are exported from a separate file
// to avoid 'server-only' contaminating the main exports.
// Import directly from './pipeline-integration' for server components
// or from this file for test scripts (which don't need those functions)

// Types are safe to re-export
export type {
  HybridThemeExtractionResult
} from './pipeline-integration'

// DO NOT re-export server-only functions here
// They are available via: import { ... } from '@/lib/synthesis-engine/pipeline-integration'
// Functions: extractThemesHybrid, canUseHybridSynthesis
