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
import { type SectionType, inferSectionType, getPaperTypeConfig } from '@/lib/generation/paper-type-config'

// =============================================================================
// Literature-Focused Section Detection
// =============================================================================

/**
 * Determine if a section should receive synthesis enrichment.
 * Uses sectionType when available, falls back to key-based inference.
 */
export function isLiteratureFocusedSection(
  sectionKey: string,
  paperType: PaperTypeKey,
  sectionType?: SectionType
): boolean {
  const type = sectionType ?? inferSectionType(sectionKey)

  if (type === 'non-content') return false

  // For literature reviews, almost ALL content sections are literature-focused
  if (paperType === 'literatureReview') return true

  // For other paper types: methodology and results are empirical
  if (type === 'methodology' || type === 'results') return false

  return true
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
  
  const requiredSections: SectionConstraint[] = profile.structure.appropriateSections.map(section => ({
    key: section.key,
    name: section.title || section.key,
    isLiteratureFocused: section.isLiteratureFocused !== undefined 
      ? section.isLiteratureFocused 
      : isLiteratureFocusedSection(section.key, paperType, section.sectionType),
    required: true,
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

function getSectionLimits(paperType: PaperTypeKey): { min: number; max: number } {
  return getPaperTypeConfig(paperType).sectionLimits
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
    sectionType?: SectionType
  }>,
  paperType: PaperTypeKey
): Array<{
  sectionKey: string
  title: string
  expectedWords?: number
  keyPoints?: string[]
  sectionType?: SectionType
  isLiteratureFocused: boolean
}> {
  return outlineSections.map(section => ({
    ...section,
    isLiteratureFocused: isLiteratureFocusedSection(section.sectionKey, paperType, section.sectionType)
  }))
}

/**
 * Get default word allocation for a section based on its type and paper type
 */
export function getDefaultWordAllocation(
  sectionKey: string,
  paperType: PaperTypeKey,
  totalWordTarget: number
): number {
  const type = inferSectionType(sectionKey)

  const litReviewAllocations: Record<SectionType, number> = {
    introduction: 0.10,
    literature: 0.50,
    methodology: 0.10,
    results: 0.10,
    discussion: 0.15,
    conclusion: 0.10,
    'non-content': 0,
  }

  const defaultAllocations: Record<SectionType, number> = {
    introduction: 0.12,
    literature: 0.20,
    methodology: 0.18,
    results: 0.20,
    discussion: 0.20,
    conclusion: 0.10,
    'non-content': 0,
  }

  const allocations = paperType === 'literatureReview' ? litReviewAllocations : defaultAllocations
  return Math.round(totalWordTarget * (allocations[type] || 0.15))
}
