/**
 * Synthesis Engine
 * 
 * Plans and generates literature synthesis from cross-document analysis.
 * 
 * Phase 3: Plan Builder - Creates structured synthesis plans
 * Phase 4: Writer - Generates prose from plans using data-driven approach
 * 
 * @module lib/synthesis-engine
 */

// Types - Planning
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

// Types - Writing
export type {
  WriterInput,
  WriterOutput,
  GeneratedSection
} from './writer'

// Types - Formatters
export type {
  FormattedPattern,
  FormattedContradiction,
  FormattedGap,
  FormattedWritingGuidance,
  FormattedSynthesisSummary,
  SynthesisPromptData
} from './formatters'

// Functions - Planning (Phase 3)
export { buildSynthesisPlan } from './plan-builder'

// Functions - Writing (Phase 4)
export { writeSynthesis, writeSingleSection } from './writer'

// Functions - Formatters
export {
  formatSectionForPrompt,
  formatPlanOverviewForPrompt,
  formatAllPatterns,
  formatAllContradictions,
  formatAllGaps,
  mergeSynthesisIntoPromptData
} from './formatters'
