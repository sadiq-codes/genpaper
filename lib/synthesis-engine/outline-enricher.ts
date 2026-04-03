/**
 * Outline Enricher
 * 
 * Bridges the gap between structure-driven outline and content-driven synthesis.
 * Enriches outline sections with synthesis patterns, contradictions, and gaps.
 * Only literature-focused sections receive synthesis enrichment.
 * 
 * @module lib/synthesis-engine/outline-enricher
 */

import type { GeneratedOutline, SectionContext } from '@/lib/prompts/types'
import type { PaperProfile } from '@/lib/generation/paper-profile-types'
import type { PaperWithAuthors } from '@/types/simplified'
import type { AnalysisResult } from '@/lib/analysis/cross-document'
import type { 
  SynthesisPlan, 
  PatternPlan, 
  ContradictionPlan, 
  GapPlan,
  PaperInfo,
  OutlineSectionInput
} from './types'
import { buildSynthesisPlan } from './plan-builder'
import { buildConstraintsFromProfile, annotateOutlineSections } from './constraint-builder'
import { GenerationContextService } from '@/lib/rag/generation-context'
import { info, warn } from '@/lib/utils/logger'
import { type SectionType, resolveSectionType } from '@/lib/generation/paper-type-config'

// =============================================================================
// Types
// =============================================================================

/**
 * Writing guidance for a section
 */
export interface SectionWritingGuidance {
  approach: string
  tone: string
  keyPointsToMake: string[]
  transitionFrom?: string
  transitionTo?: string
  // NEW: From Phase 4 enhancements
  paragraphStrategy?: string
  synthesisLevel?: string
  mustNotRepeat?: string[]  // Claims from previous sections
}

/**
 * Synthesis content to include in a section
 */
export interface SynthesisContent {
  patterns: PatternPlan[]
  contradictions: ContradictionPlan[]
  gaps: GapPlan[]
}

/**
 * Paper citation priorities
 */
export interface PaperPriority {
  primary: string[]    // Must cite these papers
  supporting: string[] // Can cite these papers
}

/**
 * Extended SectionContext with synthesis enrichment
 * This is the key type that bridges synthesis analysis with the prompt system
 */
export interface EnrichedSectionContext extends SectionContext {
  // All original SectionContext fields are inherited
  
  // NEW: Flag for conditional template rendering
  hasSynthesisEnrichment: boolean
  
  // NEW: Whether this section discusses existing literature (for table requirement)
  isLiteratureFocused: boolean
  
  // NEW: Synthesis content (only for literature-focused sections)
  synthesisContent?: SynthesisContent
  
  // NEW: Section-specific writing guidance
  writingGuidance?: SectionWritingGuidance
  
  // NEW: Paper citation priorities from synthesis plan
  paperPriority?: PaperPriority
}

type SynthesisEnrichmentMode = 'auto' | 'planner_only' | 'fallback_only'

// =============================================================================
// Main Enrichment Function
// =============================================================================

/**
 * Enrich outline sections with synthesis analysis content
 * 
 * Process:
 * 1. Build structural constraints from profile
 * 2. Annotate outline sections with literature-focus flags
 * 3. Call buildSynthesisPlan with constraints
 * 4. Map plan sections to outline sections
 * 5. Add RAG chunks to all sections
 * 6. Return enriched contexts
 * 
 * @param outline - The generated outline (structure)
 * @param analysisResult - Cross-document analysis (patterns, contradictions, gaps)
 * @param profile - Paper profile with structure guidance
 * @param papers - All papers with full metadata
 * @param topic - The paper topic
 * @returns Enriched section contexts ready for unified generator
 */
export async function enrichOutlineSections(
  outline: GeneratedOutline,
  analysisResult: AnalysisResult,
  profile: PaperProfile,
  papers: PaperWithAuthors[],
  topic: string
): Promise<EnrichedSectionContext[]> {
  const startTime = Date.now()
  const enrichmentMode = getSynthesisEnrichmentMode()
  
  // Step 1: Build structural constraints from profile
  const constraints = buildConstraintsFromProfile(profile)
  
  // Step 2: Annotate outline sections with literature-focus flags
  const annotatedSections = annotateOutlineSections(
    outline.sections.map(s => ({
      sectionKey: s.sectionKey,
      title: s.title,
      expectedWords: s.expectedWords,
      keyPoints: s.keyPoints
    })),
    constraints.paperType
  )
  
  // Step 3: Build paper info for synthesis plan
  const paperInfos: PaperInfo[] = papers.map(p => ({
    id: p.id,
    title: p.title,
    authors: p.author_names || [],
    year: p.publication_date ? new Date(p.publication_date).getFullYear() : undefined,
    domain: profile.discipline.primary
  }))
  
  // Step 4: Try to build synthesis plan
  let synthesisPlan: SynthesisPlan | undefined

  if (enrichmentMode !== 'fallback_only') {
    try {
      const planResult = await buildSynthesisPlan({
        projectId: 'enrichment',
        analysis: analysisResult,
        papers: paperInfos,
        paperType: constraints.paperType,
        paperProfile: profile,
        structuralConstraints: constraints,
        outlineSections: annotatedSections as OutlineSectionInput[],
        targetWordCount: outline.totalEstimatedWords || 
          outline.sections.reduce((sum, s) => sum + (s.expectedWords || 300), 0),
        audienceLevel: 'academic'
      })
      
      if (planResult.success && planResult.plan) {
        const hasCompleteCoverage = hasCompletePlanCoverage(planResult.plan, annotatedSections)
        if (hasCompleteCoverage) {
          synthesisPlan = planResult.plan
        } else if (enrichmentMode === 'planner_only') {
          throw new Error('Planner-only mode requires complete plan coverage for all outline sections')
        }

        info({
          sections: planResult.plan.sections.length,
          patternsPlanned: planResult.plan.sections.reduce((sum, s) => sum + s.content.patterns.length, 0),
          contradictionsPlanned: planResult.plan.sections.reduce((sum, s) => sum + s.content.contradictions.length, 0),
          gapsPlanned: planResult.plan.sections.reduce((sum, s) => sum + s.content.gaps.length, 0),
          enrichmentMode,
          hasCompleteCoverage,
        }, 'Synthesis plan built for outline enrichment')
      } else if (enrichmentMode === 'planner_only') {
        throw new Error(planResult.error || 'Planner-only mode requires a successful synthesis plan')
      }
    } catch (planError) {
      if (enrichmentMode === 'planner_only') {
        throw planError
      }
      warn({ error: planError, enrichmentMode }, 'Synthesis plan failed, will enrich with raw analysis data')
    }
  }
  
  // Step 5: Build basic section contexts with RAG chunks
  const baseContexts = await GenerationContextService.buildContexts(
    outline,
    topic,
    papers
  )
  
  // Step 6: Enrich each section
  const establishedClaims: string[] = []
  const literatureSectionIndexes = annotatedSections
    .map((section, index) => (section.isLiteratureFocused ? index : -1))
    .filter(index => index >= 0)
  let fallbackSectionsUsed = 0
  const enrichedContexts: EnrichedSectionContext[] = baseContexts.map((baseContext, index) => {
    const outlineSection = outline.sections[index]
    const annotatedSection = annotatedSections[index]
    const isLitFocused = annotatedSection.isLiteratureFocused
    const literatureSectionPosition = literatureSectionIndexes.indexOf(index)
    
    // Find matching plan section (if we have a plan)
    const planSection = synthesisPlan?.sections.find(
      ps => ps.outlineSectionKey === outlineSection.sectionKey ||
            ps.title.toLowerCase() === outlineSection.title.toLowerCase()
    )
    
    // Build enriched context
    // hasSynthesisEnrichment is true when we have ANY plan data (writing guidance, paper priority, or synthesis content)
    const enriched: EnrichedSectionContext = {
      ...baseContext,
      hasSynthesisEnrichment: !!planSection || (isLitFocused && analysisResult.patterns.length > 0),
      isLiteratureFocused: isLitFocused
    }

    const fallbackSynthesisContent = isLitFocused && !planSection
      ? distributeAnalysisToSection(
          outlineSection.sectionKey,
          outlineSection.title,
          analysisResult,
          literatureSectionPosition,
          literatureSectionIndexes.length
        )
      : undefined

    if (isLitFocused && !planSection) {
      fallbackSectionsUsed += 1
    }
    
    // Add writing guidance and paper priority for ALL sections (from plan)
    if (planSection) {
      // Convert structured key points to strings for template
      let keyPointStrings = planSection.keyPointsToMake.map(kp => kp.point)
      if (keyPointStrings.length === 0) {
        keyPointStrings = deriveFallbackKeyPoints(
          outlineSection.keyPoints,
          isLitFocused ? {
            patterns: planSection.content.patterns,
            contradictions: planSection.content.contradictions,
            gaps: planSection.content.gaps,
          } : undefined
        )
      }

      const fallbackMustNotRepeat = index > 0 ? uniqueStrings(establishedClaims, 12) : []
      
      enriched.writingGuidance = {
        approach: planSection.writingGuidance.approach,
        tone: planSection.writingGuidance.tone,
        keyPointsToMake: keyPointStrings,
        transitionFrom: planSection.writingGuidance.transitionFrom || undefined,
        transitionTo: planSection.writingGuidance.transitionTo || undefined,
        paragraphStrategy: planSection.writingGuidance.paragraphStrategy || undefined,
        synthesisLevel: planSection.writingGuidance.synthesisLevel || undefined,
        mustNotRepeat: planSection.mustNotRepeat.length > 0
          ? planSection.mustNotRepeat
          : (fallbackMustNotRepeat.length > 0 ? fallbackMustNotRepeat : undefined)
      }
      
      enriched.paperPriority = {
        primary: planSection.papers.primary,
        supporting: planSection.papers.supporting
      }
    } else {
      // Deterministic fallback guidance keeps repetition controls active even
      // when planner output is unavailable.
      const keyPointsToMake = deriveFallbackKeyPoints(
        outlineSection.keyPoints,
        fallbackSynthesisContent
      )
      const mustNotRepeat = index > 0 ? uniqueStrings(establishedClaims, 12) : []
      const secType = resolveSectionType({ key: outlineSection.sectionKey, title: outlineSection.title })

      enriched.writingGuidance = {
        approach: getFallbackApproach(secType, isLitFocused),
        tone: isLitFocused ? 'analytical' : 'objective',
        keyPointsToMake,
        transitionFrom: index > 0 ? `Build directly on the prior section's claims without restating them.` : undefined,
        transitionTo: index < baseContexts.length - 1 ? 'Close with a bridge to the next section.' : undefined,
        paragraphStrategy: isLitFocused ? 'pattern_first' : 'general_to_specific',
        synthesisLevel: isLitFocused ? 'high' : 'moderate',
        mustNotRepeat: mustNotRepeat.length > 0 ? mustNotRepeat : undefined
      }

      enriched.paperPriority = buildFallbackPaperPriority(
        baseContext.candidatePaperIds,
        fallbackSynthesisContent,
        isLitFocused,
        analysisResult
      )
    }
    
    // Only add synthesis content (patterns, contradictions, gaps) for literature-focused sections
    if (isLitFocused) {
      if (planSection) {
        enriched.synthesisContent = {
          patterns: planSection.content.patterns,
          contradictions: planSection.content.contradictions,
          gaps: planSection.content.gaps
        }
      } else {
        enriched.synthesisContent = fallbackSynthesisContent
      }
    }

    if (enriched.writingGuidance?.keyPointsToMake?.length) {
      establishedClaims.push(...enriched.writingGuidance.keyPointsToMake)
    }
    
    // Diagnostic logging for each section
    info({
      stage: 'synthesis-pipeline',
      step: 'section-enrichment',
      enrichmentMode,
      sectionIndex: index,
      section: {
        key: outlineSection.sectionKey,
        title: outlineSection.title,
        isLiteratureFocused: isLitFocused
      },
      planMatch: {
        found: !!planSection,
        matchedBy: planSection 
          ? (planSection.outlineSectionKey === outlineSection.sectionKey ? 'key' : 'title')
          : null,
        planSectionTitle: planSection?.title || null
      },
      enrichment: {
        hasWritingGuidance: !!enriched.writingGuidance,
        keyPointsCount: enriched.writingGuidance?.keyPointsToMake?.length || 0,
        mustNotRepeatCount: enriched.writingGuidance?.mustNotRepeat?.length || 0,
        hasSynthesisContent: !!enriched.synthesisContent,
        patternsCount: enriched.synthesisContent?.patterns?.length || 0,
        usedFallback: isLitFocused && !planSection
      }
    }, `Section enrichment: ${outlineSection.title}`)
    
    // Warn if literature-focused section is missing mustNotRepeat (except first section)
    if (isLitFocused && index > 0 && (!enriched.writingGuidance?.mustNotRepeat || enriched.writingGuidance.mustNotRepeat.length === 0)) {
      warn({
        stage: 'synthesis-pipeline',
        issue: 'missing-must-not-repeat',
        section: outlineSection.title,
        sectionIndex: index
      }, `⚠️ Section "${outlineSection.title}" has no mustNotRepeat - repetition prevention disabled`)
    }
    
    return enriched
  })
  
  info({
    enrichmentMode,
    resolvedPath: synthesisPlan
      ? (fallbackSectionsUsed > 0 ? 'partial_fallback' : 'planner')
      : 'fallback',
    plannerUsed: !!synthesisPlan,
    fallbackSectionsUsed,
    totalSections: enrichedContexts.length,
    enrichedSections: enrichedContexts.filter(s => s.hasSynthesisEnrichment).length,
    durationMs: Date.now() - startTime
  }, 'Outline enrichment complete')
  
  return enrichedContexts
}

// =============================================================================
// Helper Functions
// =============================================================================

function uniqueStrings(values: string[], limit = Number.POSITIVE_INFINITY): string[] {
  const deduped: string[] = []
  const seen = new Set<string>()

  for (const value of values) {
    const normalized = value.replace(/\s+/g, ' ').trim()
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(normalized)
    if (deduped.length >= limit) break
  }

  return deduped
}

function getSynthesisEnrichmentMode(): SynthesisEnrichmentMode {
  const rawValue = process.env.SYNTHESIS_ENRICHMENT_MODE?.trim().toLowerCase()
  if (rawValue === 'planner_only' || rawValue === 'fallback_only' || rawValue === 'auto') {
    return rawValue
  }
  return 'auto'
}

function hasCompletePlanCoverage(
  plan: SynthesisPlan,
  outlineSections: OutlineSectionInput[]
): boolean {
  const outlineKeys = new Set(outlineSections.map(section => section.sectionKey))
  return outlineSections.every((section) =>
    plan.sections.some((planSection) =>
      planSection.outlineSectionKey === section.sectionKey ||
      (!outlineKeys.has(planSection.outlineSectionKey) &&
        planSection.title.toLowerCase() === section.title.toLowerCase())
    )
  )
}

function deriveFallbackKeyPoints(
  outlineKeyPoints: string[] | undefined,
  synthesisContent: SynthesisContent | undefined
): string[] {
  const points: string[] = []

  if (Array.isArray(outlineKeyPoints) && outlineKeyPoints.length > 0) {
    points.push(...outlineKeyPoints)
  }

  if (synthesisContent) {
    points.push(
      ...synthesisContent.patterns.slice(0, 3).map(p => `Synthesize evidence for: ${p.claim}`),
      ...synthesisContent.contradictions.slice(0, 1).map(c => `Explain the disagreement around: ${c.description}`),
      ...synthesisContent.gaps.slice(0, 1).map(g => `Highlight this unresolved gap: ${g.description}`)
    )
  }

  const deduped = uniqueStrings(points, 4)
  if (deduped.length >= 2) return deduped

  const fallback = [
    ...deduped,
    'State the section claim and support it with cited evidence.',
    'Connect the section argument to the overall review objective.',
  ]
  return uniqueStrings(fallback, 3)
}

const FALLBACK_APPROACHES: Record<SectionType, string> = {
  introduction: 'Frame scope and objectives, define boundaries, and set up the evidence narrative.',
  literature: 'Integrate cross-paper evidence, quantify agreement where possible, and note caveats.',
  methodology: 'Present a focused argument with concise transitions and explicit links to the paper objective.',
  results: 'Present a focused argument with concise transitions and explicit links to the paper objective.',
  discussion: 'Compare converging and conflicting evidence, then interpret implications and limitations.',
  conclusion: 'Synthesize the strongest findings and end with concrete future directions.',
  'non-content': 'Present a focused argument with concise transitions and explicit links to the paper objective.',
}

function getFallbackApproach(
  type: SectionType,
  isLiteratureFocused: boolean
): string {
  const specific = FALLBACK_APPROACHES[type]
  if (specific && type !== 'methodology' && type !== 'results' && type !== 'non-content') return specific
  return isLiteratureFocused
    ? 'Integrate cross-paper evidence, quantify agreement where possible, and note caveats.'
    : 'Present a focused argument with concise transitions and explicit links to the paper objective.'
}

function buildFallbackPaperPriority(
  candidatePaperIds: string[],
  synthesisContent: SynthesisContent | undefined,
  isLiteratureFocused: boolean,
  analysis: AnalysisResult
): PaperPriority {
  const selectedGapIds = new Set(synthesisContent?.gaps.map(gap => gap.gapId) ?? [])
  const gapPaperIds = analysis.gaps
    .filter(gap => selectedGapIds.has(gap.id))
    .flatMap(gap => gap.suggestedBy)
  const synthesisPaperIds = synthesisContent ? uniqueStrings([
    ...synthesisContent.patterns.flatMap(p => p.supportingPaperIds),
    ...synthesisContent.contradictions.flatMap(c => c.sides.flatMap(s => s.paperIds)),
    ...gapPaperIds,
  ]) : []

  const preferredPrimaryCount = isLiteratureFocused ? 8 : 4
  const primary = uniqueStrings([...synthesisPaperIds, ...candidatePaperIds], preferredPrimaryCount)
  const supporting = uniqueStrings(
    candidatePaperIds.filter(id => !primary.includes(id)),
    isLiteratureFocused ? 10 : 6
  )

  return {
    primary,
    supporting,
  }
}

/**
 * Distribute raw analysis data to a section based on its semantic type.
 * Used when synthesis plan building fails.
 */
function distributeAnalysisToSection(
  sectionKey: string,
  sectionTitle: string,
  analysis: AnalysisResult,
  literatureSectionPosition: number,
  literatureSectionCount: number
): SynthesisContent {
  const type = resolveSectionType({ key: sectionKey, title: sectionTitle })
  const literaturePosition = literatureSectionPosition >= 0 ? literatureSectionPosition : 0
  const literatureCount = Math.max(literatureSectionCount, 1)
  const literaturePatterns = takeDistributedSlice(analysis.patterns, literaturePosition, literatureCount, {
    perSection: 3,
    overlap: 1,
  }).map(patternToPatternPlan)
  const literatureContradictions = takeDistributedSlice(
    analysis.contradictions,
    literaturePosition,
    Math.max(Math.min(literatureCount, analysis.contradictions.length || 1), 1),
    { perSection: 1, overlap: 0 }
  ).map(contradictionToContradictionPlan)
  const literatureGaps = takeDistributedSlice(
    analysis.gaps,
    literaturePosition,
    Math.max(Math.min(literatureCount, analysis.gaps.length || 1), 1),
    { perSection: 1, overlap: 0 }
  ).map(gapToGapPlan)

  switch (type) {
    case 'introduction':
      return {
        patterns: literaturePatterns.slice(0, 2),
        contradictions: [],
        gaps: [],
      }
    case 'literature':
      return {
        patterns: literaturePatterns,
        contradictions: literatureContradictions,
        gaps: [],
      }
    case 'discussion':
      return {
        patterns: literaturePatterns.filter(p => p.importance !== 'minor').slice(0, 3),
        contradictions: literatureContradictions,
        gaps: literatureGaps,
      }
    case 'conclusion':
      return {
        patterns: [],
        contradictions: [],
        gaps: literatureGaps,
      }
    default:
      return {
        patterns: literaturePatterns,
        contradictions: literatureContradictions,
        gaps: [],
      }
  }
}

function takeDistributedSlice<T>(
  items: T[],
  sectionPosition: number,
  sectionCount: number,
  options: { perSection: number; overlap: number }
): T[] {
  if (items.length === 0) return []

  const normalizedSectionCount = Math.max(sectionCount, 1)
  const normalizedPosition = Math.min(Math.max(sectionPosition, 0), normalizedSectionCount - 1)
  const baseChunkSize = Math.max(Math.ceil(items.length / normalizedSectionCount), 1)
  const windowSize = Math.max(options.perSection, baseChunkSize)
  const stride = Math.max(windowSize - options.overlap, 1)
  const maxStart = Math.max(items.length - windowSize, 0)
  const start = Math.min(normalizedPosition * stride, maxStart)
  const slice = items.slice(start, start + windowSize)

  if (slice.length > 0) {
    return slice
  }

  return items.slice(-windowSize)
}

/**
 * Convert Pattern to PatternPlan
 */
function patternToPatternPlan(pattern: AnalysisResult['patterns'][0]): PatternPlan {
  const supportCount = pattern.support.count
  const supportTotal = pattern.support.total
  const supportPct = supportTotal > 0
    ? Math.round((supportCount / supportTotal) * 100)
    : 0

  return {
    patternId: pattern.id,
    claim: pattern.claim,
    importance: pattern.confidence > 0.8 ? 'central' : pattern.confidence > 0.6 ? 'supporting' : 'minor',
    presentationApproach: 'State denominator scope before reporting this aggregate, then interpret the implication.',
    data: {
      supportStatement: `Within the analyzed corpus for this pattern, ${supportCount} of ${supportTotal} papers (${supportPct}%) provide support.`,
      valuesSummary: pattern.values?.summary || undefined,
      contextNotes: pattern.limitations || undefined
    },
    supportingPaperIds: pattern.support.papers.map(p => p.paperId)
  }
}

/**
 * Convert Contradiction to ContradictionPlan
 */
function contradictionToContradictionPlan(contradiction: AnalysisResult['contradictions'][0]): ContradictionPlan {
  return {
    contradictionId: contradiction.id,
    description: contradiction.description,
    presentationApproach: 'Present both sides fairly before discussing possible explanations',
    resolutionStrategy: contradiction.possibleExplanation || undefined,
    sides: contradiction.sides.map(side => ({
      position: side.position,
      paperIds: side.papers.map(p => p.paperId)
    }))
  }
}

/**
 * Convert Gap to GapPlan
 */
function gapToGapPlan(gap: AnalysisResult['gaps'][0]): GapPlan {
  return {
    gapId: gap.id,
    description: gap.description,
    importance: gap.relevance,
    suggestedFutureWork: `Research could address this ${gap.type} gap`
  }
}

// =============================================================================
// Exports
// =============================================================================

export {
  isLiteratureFocusedSection,
  buildConstraintsFromProfile,
  annotateOutlineSections
} from './constraint-builder'
