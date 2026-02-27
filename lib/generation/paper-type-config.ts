/**
 * Centralized Paper Type Configuration
 *
 * Single source of truth for all paper-type-specific settings.
 * Replaces scattered hardcoded values across the codebase.
 */

import type { PaperTypeKey } from '@/types/simplified'

// ─────────────────────────────────────────────────────────────────────────────
// Section Type Classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Semantic classification of a paper section.
 * Assigned by the LLM during profile generation; inferred from key/title as fallback.
 */
export type SectionType =
  | 'introduction'
  | 'literature'
  | 'methodology'
  | 'results'
  | 'discussion'
  | 'conclusion'
  | 'non-content'

const SECTION_TYPE_PATTERNS: Array<[SectionType, RegExp]> = [
  ['introduction', /intro|background/],
  ['literature', /literature|review|thematic|related|theoretical/],
  ['methodology', /method|approach|design|materials|procedure/],
  ['results', /result|finding|data\s?analysis/],
  ['discussion', /discussion|interpret|implication/],
  ['conclusion', /conclusion|summary|future/],
  ['non-content', /appendix|appendices|reference|bibliograph|acknowledge|supplementary/],
]

/**
 * Infer sectionType from a section key and/or title.
 * Used as fallback when sectionType is not explicitly set in the profile.
 */
export function inferSectionType(key: string, title?: string): SectionType {
  const normalized = `${key} ${title || ''}`.toLowerCase().replace(/[-_]/g, '')

  for (const [type, pattern] of SECTION_TYPE_PATTERNS) {
    if (pattern.test(normalized)) return type
  }

  return 'non-content'
}

/**
 * Resolve a section's type from profile data with fallback inference.
 */
export function resolveSectionType(section: {
  key: string
  title?: string
  sectionType?: SectionType
}): SectionType {
  return section.sectionType ?? inferSectionType(section.key, section.title)
}

// ─────────────────────────────────────────────────────────────────────────────
// Paper Type Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface PaperTypeConfig {
  label: string
  safetyMinSources: number
  idealSourceMultiplier: number
  sectionLimits: { min: number; max: number }
  requiresSubsections: boolean
  academicLevel: 'undergraduate' | 'masters' | 'doctoral' | 'faculty'
  diversityTargetPct: number
  defaultWordRange: string
  styleGuidance: string
  guardrails: string
  guardrailsOriginalResearch?: string
}

export const PAPER_TYPE_CONFIGS: Record<PaperTypeKey, PaperTypeConfig> = {
  literatureReview: {
    label: 'Literature Review',
    safetyMinSources: 25,
    idealSourceMultiplier: 2.0,
    sectionLimits: { min: 4, max: 10 },
    requiresSubsections: false,
    academicLevel: 'masters',
    diversityTargetPct: 60,
    defaultWordRange: '3,000-8,000 words total',
    styleGuidance:
      'Synthesizing voice that compares and contrasts sources. Emphasize connections, themes, and gaps across studies. Organize thematically rather than chronologically when possible.',
    guardrails: `### Paper-Type Guardrails: Literature Review
- Do not present original data collection or experimental/statistical results.
- "Methodology" should describe literature search/selection, not primary empirical procedures.
- Organize around synthesis, debate, and gaps across existing scholarship.
- Most substantive claims should be evidence-cited.`,
  },

  researchArticle: {
    label: 'Research Article',
    safetyMinSources: 10,
    idealSourceMultiplier: 1.5,
    sectionLimits: { min: 5, max: 8 },
    requiresSubsections: false,
    academicLevel: 'masters',
    diversityTargetPct: 40,
    defaultWordRange: '4,000-8,000 words total',
    styleGuidance:
      'Formal academic prose with empirical focus. Present findings objectively with appropriate statistical hedging. Use passive voice for methods, active voice for interpretations.',
    guardrails: `### Paper-Type Guardrails: Research Article (Secondary Analysis)
- Do not invent primary data or empirical statistics.
- Methodology should define source selection and analytical procedure for secondary evidence.
- Results/analysis should present your argument using cited sources.`,
    guardrailsOriginalResearch: `### Paper-Type Guardrails: Research Article (Primary Empirical)
- Include a clear Methodology and Results based on your own data/analysis.
- Report specific findings (metrics, themes, or interpretive evidence as appropriate to discipline).
- Use citations heavily in introduction/background, lightly in primary-results reporting.`,
  },

  mastersThesis: {
    label: "Master's Thesis",
    safetyMinSources: 20,
    idealSourceMultiplier: 1.5,
    sectionLimits: { min: 5, max: 10 },
    requiresSubsections: true,
    academicLevel: 'masters',
    diversityTargetPct: 55,
    defaultWordRange: '15,000-25,000 words total',
    styleGuidance:
      'Thorough academic style demonstrating mastery of the field. Balance depth with accessibility. Show clear progression of argument and methodology.',
    guardrails: `### Paper-Type Guardrails: Master's Thesis
- Demonstrate both literature command and a clear scholarly contribution.
- Maintain structured chapters with explicit links from findings to prior scholarship.
- Include a concrete contribution statement and acknowledge key methodological trade-offs.`,
  },

  phdDissertation: {
    label: 'PhD Dissertation',
    safetyMinSources: 30,
    idealSourceMultiplier: 1.5,
    sectionLimits: { min: 6, max: 15 },
    requiresSubsections: true,
    academicLevel: 'doctoral',
    diversityTargetPct: 70,
    defaultWordRange: '40,000-80,000 words total',
    styleGuidance:
      'Authoritative scholarly voice with original contribution emphasis. Rigorous argumentation with comprehensive literature engagement. Appropriate theoretical framing.',
    guardrails: `### Paper-Type Guardrails: PhD Dissertation
- Prioritize original contribution to knowledge with strong theoretical/methodological grounding.
- Maintain high rigor in argument structure, evidence handling, and limitations.
- State contributions explicitly and defend scope boundaries with reflexive clarity.`,
  },

  capstoneProject: {
    label: 'Capstone Project',
    safetyMinSources: 15,
    idealSourceMultiplier: 1.5,
    sectionLimits: { min: 5, max: 8 },
    requiresSubsections: true,
    academicLevel: 'undergraduate',
    diversityTargetPct: 50,
    defaultWordRange: '5,000-10,000 words total',
    styleGuidance:
      'Professional academic style demonstrating applied knowledge. Balance theoretical foundation with practical application. Clear methodology and actionable conclusions.',
    guardrails: `### Paper-Type Guardrails: Capstone Project
- Connect scholarship to practical or applied outcomes.
- Keep methods and findings appropriate to the chosen capstone subtype.
- End with explicit contribution and realistic implementation/implication framing.`,
  },
}

export function getPaperTypeConfig(paperType: string): PaperTypeConfig {
  return PAPER_TYPE_CONFIGS[paperType as PaperTypeKey] ?? PAPER_TYPE_CONFIGS.researchArticle
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Thresholds (stable defaults, centralized for easy tuning)
// ─────────────────────────────────────────────────────────────────────────────

/** Minimum cross-document findings to enable synthesis enrichment */
export const SYNTHESIS_FINDINGS_THRESHOLD = 5

/** Word threshold above which a section is split into subsections during generation */
export const SUBSECTION_SPLIT_THRESHOLD_GENERATE = 1800

/** Word threshold above which a section is split into subsections during rewrite */
export const SUBSECTION_SPLIT_THRESHOLD_REWRITE = 2500

/** Minimum character length to consider a paper's content as "full text" (~1200 words) */
export const MIN_FULL_TEXT_CHARS = 5000

export function getPaperTypeGuardrails(paperType: string, hasOriginalResearch?: boolean): string {
  const config = getPaperTypeConfig(paperType)
  if (hasOriginalResearch && config.guardrailsOriginalResearch) {
    return config.guardrailsOriginalResearch
  }
  return config.guardrails
}
