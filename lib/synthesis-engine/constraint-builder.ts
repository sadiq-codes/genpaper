/**
 * Constraint Builder
 * 
 * Builds structural constraints from PaperProfile for the synthesis plan builder.
 * Determines which sections are literature-focused and should receive synthesis enrichment.
 * 
 * @module lib/synthesis-engine/constraint-builder
 */

import type { PaperProfile } from '@/lib/generation/paper-profile-types'
import type { PaperTypeKey } from '@/types/simplified'
import type { StructuralConstraints, SectionConstraint } from './types'

// =============================================================================
// Literature-Focused Section Detection
// =============================================================================

/**
 * Section keys that are literature-focused and should receive synthesis enrichment
 * These sections discuss existing literature rather than describe original work
 */
const LITERATURE_FOCUSED_SECTIONS = new Set([
  'introduction',
  'literatureReview',
  'literature_review',
  'background',
  'theoreticalFramework',
  'theoretical_framework',
  'relatedWork',
  'related_work',
  'discussion',
  'conclusion',
  'conclusions',
  'thematicSection',
  'thematic_section',
  // For literature reviews, these are also literature-focused
  'thematicAnalysis',
  'thematic_analysis',
  'criticalAnalysis',
  'critical_analysis'
])

/**
 * Section keys that are NOT literature-focused (describe original work)
 * These should NOT receive synthesis patterns/contradictions/gaps
 * 
 * NOTE: For literature reviews, ONLY non-content sections are truly empirical.
 * Sections like "methodology" (literature search) and "findings" (synthesized findings)
 * ARE literature-focused in a literature review context.
 */
const EMPIRICAL_SECTIONS = new Set([
  'materials',
  'materialsAndMethods',
  'materials_and_methods',
  'dataAnalysis',
  'data_analysis',
  'appendix',
  'appendices',
  'supplementary',
  'acknowledgements',
  'references',
  'bibliography'
])

/**
 * Section keys that are empirical ONLY in research articles (not literature reviews)
 * These describe original research methodology/results
 */
const EMPIRICAL_IN_RESEARCH_ONLY = new Set([
  'methodology',
  'methods',
  'results',
  'findings'
])

/**
 * Determine if a section should receive synthesis enrichment
 * 
 * @param sectionKey - The section key to check
 * @param paperType - The paper type (affects what's considered literature-focused)
 * @returns true if the section should be enriched with synthesis patterns
 */
export function isLiteratureFocusedSection(
  sectionKey: string,
  paperType: PaperTypeKey
): boolean {
  const normalizedKey = sectionKey.toLowerCase().replace(/[-_\s]/g, '')
  
  // Always exclude non-content sections (appendix, references, etc.)
  if (EMPIRICAL_SECTIONS.has(sectionKey)) {
    return false
  }
  
  // For literature reviews, almost ALL content sections are literature-focused
  // because even "methodology" (literature search) and "findings" (synthesized findings)
  // are about the literature, not original research
  if (paperType === 'literatureReview') {
    // Only appendix/references/etc. are not literature-focused
    // Everything else in a literature review discusses literature
    return true
  }
  
  // For other paper types (research articles, theses, etc.):
  // Methodology/Methods/Results/Findings are empirical (describe original work)
  if (EMPIRICAL_IN_RESEARCH_ONLY.has(sectionKey)) {
    return false
  }
  
  // Check if explicitly literature-focused
  if (LITERATURE_FOCUSED_SECTIONS.has(sectionKey)) {
    return true
  }
  
  // Check normalized key for variations
  if (
    normalizedKey.includes('literature') ||
    normalizedKey.includes('review') ||
    normalizedKey.includes('discussion') ||
    normalizedKey.includes('introduction') ||
    normalizedKey.includes('background') ||
    normalizedKey.includes('theoretical') ||
    normalizedKey.includes('related') ||
    normalizedKey.includes('thematic')
  ) {
    return true
  }
  
  // Default: not literature-focused
  return false
}

// =============================================================================
// Constraint Building
// =============================================================================

/**
 * Build structural constraints from a PaperProfile
 * 
 * This extracts the section rules from the profile and determines
 * which sections should receive synthesis enrichment.
 * 
 * @param profile - The paper profile with structure guidance
 * @returns Structural constraints for the plan builder
 */
export function buildConstraintsFromProfile(profile: PaperProfile): StructuralConstraints {
  const paperType = profile.paperType as PaperTypeKey
  
  // Build required sections from profile
  // Use AI-determined isLiteratureFocused if available, otherwise fall back to heuristic
  const requiredSections: SectionConstraint[] = profile.structure.appropriateSections.map(section => ({
    key: section.key,
    name: section.title || section.key,
    // Prefer AI's determination, fall back to heuristic for backwards compatibility
    isLiteratureFocused: section.isLiteratureFocused !== undefined 
      ? section.isLiteratureFocused 
      : isLiteratureFocusedSection(section.key, paperType),
    required: true, // All appropriate sections are required by default
    purpose: section.purpose,
    minWords: section.minWords,
    maxWords: section.maxWords
  }))
  
  // Build forbidden sections list
  const forbiddenSections = profile.structure.inappropriateSections.map(section => section.name)
  
  // Calculate section limits based on paper type
  const sectionLimits = getSectionLimits(paperType)
  
  return {
    paperType,
    disciplineContext: profile.discipline.primary,
    requiredSections,
    forbiddenSections,
    minSections: Math.max(sectionLimits.min, requiredSections.filter(s => s.required).length),
    maxSections: sectionLimits.max,
    minSources: profile.sourceExpectations.minimumUniqueSources,
    idealSources: profile.sourceExpectations.idealSourceCount
  }
}

/**
 * Get default section limits by paper type
 */
function getSectionLimits(paperType: PaperTypeKey): { min: number; max: number } {
  switch (paperType) {
    case 'literatureReview':
      return { min: 4, max: 10 } // Intro, 2-6 thematic, Discussion, Conclusion
    case 'phdDissertation':
      return { min: 6, max: 15 } // Multiple chapters
    case 'mastersThesis':
      return { min: 5, max: 10 }
    case 'capstoneProject':
      return { min: 5, max: 8 }
    case 'researchArticle':
    default:
      return { min: 5, max: 8 } // IMRAD + variations
  }
}

// =============================================================================
// Outline Section Helpers
// =============================================================================

/**
 * Annotate outline sections with literature-focus flags
 * 
 * @param outlineSections - Sections from GeneratedOutline
 * @param paperType - The paper type
 * @returns Sections with isLiteratureFocused flag added
 */
export function annotateOutlineSections(
  outlineSections: Array<{
    sectionKey: string
    title: string
    expectedWords?: number
    keyPoints?: string[]
  }>,
  paperType: PaperTypeKey
): Array<{
  sectionKey: string
  title: string
  expectedWords?: number
  keyPoints?: string[]
  isLiteratureFocused: boolean
}> {
  return outlineSections.map(section => ({
    ...section,
    isLiteratureFocused: isLiteratureFocusedSection(section.sectionKey, paperType)
  }))
}

/**
 * Get default word allocation for sections based on paper type and total target
 */
export function getDefaultWordAllocation(
  sectionKey: string,
  paperType: PaperTypeKey,
  totalWordTarget: number
): number {
  // Literature reviews allocate most words to thematic sections
  if (paperType === 'literatureReview') {
    const allocations: Record<string, number> = {
      introduction: 0.10,
      literatureReview: 0.15, // If there's a separate overview
      thematicSection: 0.50, // Bulk of the paper
      discussion: 0.15,
      conclusion: 0.10
    }
    const allocation = allocations[sectionKey] || 0.15
    return Math.round(totalWordTarget * allocation)
  }
  
  // Research articles have more balanced allocation
  const allocations: Record<string, number> = {
    introduction: 0.12,
    literatureReview: 0.20,
    methodology: 0.18,
    results: 0.20,
    discussion: 0.20,
    conclusion: 0.10
  }
  
  const allocation = allocations[sectionKey] || 0.15
  return Math.round(totalWordTarget * allocation)
}
