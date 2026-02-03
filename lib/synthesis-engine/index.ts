/**
 * Synthesis Engine
 * 
 * Plans and generates literature synthesis from cross-document analysis.
 * 
 * @module lib/synthesis-engine
 */

// Types
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

// Functions
export { buildSynthesisPlan } from './plan-builder'
