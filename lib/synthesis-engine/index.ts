/**
 * Synthesis Engine
 * 
 * Complete hybrid synthesis system combining:
 * - Structured extraction and analysis (the brain)
 * - RAG chunk retrieval (the brawn)
 * 
 * Phase 3: Plan Builder - Creates structured synthesis plans
 * Phase 4: Writer - Generates prose using data-driven approach
 * Phase 5: Hybrid System - Combines structured data with RAG chunks
 * 
 * @module lib/synthesis-engine
 */

// =============================================================================
// Types - Planning (Phase 3)
// =============================================================================
export type {
  SynthesisPlan,
  SynthesisPlanInput,
  SynthesisPlanResult,
  SectionPlan,
  PatternPlan,
  ContradictionPlan,
  GapPlan,
  PaperInfo
} from './types'

// =============================================================================
// Types - Writing (Phase 4)
// =============================================================================
export type {
  WriterInput,
  WriterOutput,
  GeneratedSection
} from './writer'

// =============================================================================
// Types - Hybrid (Phase 5)
// =============================================================================
export type {
  HybridWriterInput,
  HybridWriterOutput,
  HybridGeneratedSection
} from './hybrid-writer'

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

// =============================================================================
// Functions - Writing (Phase 4 - Data-only, no chunks)
// =============================================================================
export { writeSynthesis, writeSingleSection } from './writer'

// =============================================================================
// Functions - Hybrid Writing (Phase 5 - Data + Chunks)
// =============================================================================
export { writeHybridSynthesis } from './hybrid-writer'

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
// Functions - Theme Adapter (Pipeline Integration)
// =============================================================================
export { analysisResultToThemeAnalysis } from './theme-adapter'

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
