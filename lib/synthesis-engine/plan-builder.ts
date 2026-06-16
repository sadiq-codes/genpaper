/**
 * Synthesis Plan Builder
 * 
 * Generates a structured plan for writing a literature synthesis.
 * Takes analysis results (patterns, contradictions, gaps) and produces
 * a detailed plan for each section.
 * 
 * Key principles:
 * - Paper-type aware: Respects structural constraints from PaperProfile
 * - Aligns with outline sections when provided
 * - Data-driven: Plan based on actual analysis results
 * - Single LLM call for efficiency
 * 
 * @module lib/synthesis-engine/plan-builder
 */

import { generateObject } from 'ai'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { getLanguageModel } from '@/lib/ai/vercel-client'
import { info, warn } from '@/lib/utils/logger'
import type {
  SynthesisPlan,
  SynthesisPlanInput,
  SynthesisPlanResult,
  SectionPlan
} from './types'
import { type SectionType, inferSectionType } from '@/lib/generation/paper-type-config'

const PLAN_BUILDER_TIMEOUT_MS = 90_000
const PLAN_BUILDER_SCHEMA_RETRIES = 2
const PLAN_BUILDER_TEMPERATURE = 0.1
const PLAN_BUILDER_MAX_OUTPUT_TOKENS = 8_000
const PLAN_BUILDER_RETRY_TOKEN_BUDGETS = [
  PLAN_BUILDER_MAX_OUTPUT_TOKENS,
  10_000,
  12_000,
] as const
const MAX_PATTERN_PAPER_REFS_IN_PROMPT = 6
const MAX_CONTRADICTION_PAPER_REFS_PER_SIDE = 4
const MAX_PAPERS_IN_PROMPT = 60
const MAX_PLANNER_INPUT_PAPERS = 18
const MAX_SUMMARY_LENGTH = 220
const MAX_TITLE_LENGTH = 120

// =============================================================================
// Zod Schema - Flexible, No Hardcoded Enums
// =============================================================================

const PatternPlanSchema = z.object({
  patternId: z.string().describe('ID of the pattern from analysis'),
  claim: z.string().max(240).describe('The pattern claim to discuss'),
  importance: z.string().max(40).describe('How important: "central", "supporting", "minor", etc.'),
  presentationApproach: z.string().max(220).describe('How to present this pattern'),
  data: z.object({
    supportStatement: z.string().max(180).describe('Statement about support, e.g., "6 of 8 studies (75%) found..."'),
    valuesSummary: z.string().max(180).nullable().describe('Summary of quantitative values if available'),
    contextNotes: z.string().max(220).nullable().describe('Important context to mention')
  }),
  supportingPaperIds: z.array(z.string())
})

const ContradictionPlanSchema = z.object({
  contradictionId: z.string().describe('ID of the contradiction from analysis'),
  description: z.string().max(240).describe('What the contradiction is'),
  presentationApproach: z.string().max(220).describe('How to present this fairly'),
  resolutionStrategy: z.string().max(220).nullable().describe('How to explain or resolve'),
  sides: z.array(z.object({
    position: z.string().max(180),
    paperIds: z.array(z.string())
  }))
})

const GapPlanSchema = z.object({
  gapId: z.string().describe('ID of the gap from analysis'),
  description: z.string().max(220).describe('What the gap is'),
  importance: z.string().max(180).describe('Why this gap matters'),
  suggestedFutureWork: z.string().max(220).nullable().describe('Potential research to address it')
})

const SectionPlanSchema = z.object({
  // Link to outline section (required for pipeline integration)
  outlineSectionKey: z.string().describe('The outline section key this maps to, e.g., "introduction", "literatureReview", "discussion"'),
  isLiteratureFocused: z.boolean().describe('True if this section discusses existing literature (should get synthesis enrichment)'),
  
  title: z.string().max(120).describe('Section title'),
  purpose: z.string().max(220).describe('What this section accomplishes'),
  content: z.object({
    patterns: z.array(PatternPlanSchema).describe('Patterns to discuss in this section (only for literature-focused sections)'),
    contradictions: z.array(ContradictionPlanSchema).describe('Contradictions to discuss'),
    gaps: z.array(GapPlanSchema).describe('Gaps to discuss'),
    additionalPoints: z.array(z.string().max(160)).describe('Other points to make')
  }),
  papers: z.object({
    primary: z.array(z.string()).describe('Must cite these paper IDs'),
    supporting: z.array(z.string()).describe('Can cite these if needed')
  }),
  writingGuidance: z.object({
    approach: z.string().max(220).describe('How to write this section: synthesis, critical analysis, comparison, etc.'),
    tone: z.string().max(60).describe('Tone: objective, evaluative, exploratory, etc.'),
    transitionFrom: z.string().max(180).nullable().describe('How to connect from previous section'),
    transitionTo: z.string().max(180).nullable().describe('How to lead into next section'),
    // NEW: Structured paragraph guidance
    paragraphStrategy: z.enum([
      'pattern_first',       // Lead with main pattern, then supporting evidence
      'chronological',       // Trace development over time
      'compare_contrast',    // Juxtapose different findings/views
      'problem_solution',    // Present issue, then approaches
      'general_to_specific', // Start broad, narrow down
      'specific_to_general'  // Start with examples, build to principles
    ]).nullable().describe('How to structure paragraphs in this section'),
    // NEW: Synthesis vs description balance
    synthesisLevel: z.enum(['high', 'moderate', 'low']).describe(
      'high = heavy integration across sources, moderate = some comparison, low = mostly descriptive (for Methods/Results)'
    )
  }),
  targetWordCount: z.number().describe('Target word count for this section'),
  keyPointsToMake: z.array(z.object({
    point: z.string().max(180).describe('The key point to make'),
    supportingPatternIds: z.array(z.string()).describe('Pattern IDs that support this point'),
    requiredCitations: z.array(z.string()).describe('Paper IDs that MUST be cited for this point')
  })).min(2).describe('REQUIRED: At least 2-3 key points per section. Each point should be a specific claim the section will make.'),
  // NEW: Repetition prevention
  mustNotRepeat: z.array(z.string().max(180)).describe('Key claims/points already established in previous sections - do not restate')
})

const SynthesisPlanSchema = z.object({
  overview: z.object({
    title: z.string().max(160).describe('Suggested title for the synthesis'),
    abstract: z.string().max(300).describe('Brief overview of what the synthesis covers'),
    totalSections: z.number(),
    totalWordCount: z.number(),
    narrativeStrategy: z.string().max(220).describe('Overall approach to the synthesis')
  }),
  sections: z.array(SectionPlanSchema),
  globalGuidance: z.object({
    audienceLevel: z.string().max(80).describe('Target audience'),
    writingStyle: z.string().max(120).describe('Writing style to use'),
    citationApproach: z.string().max(160).describe('How to handle citations'),
    keyThemes: z.array(z.string().max(120)).describe('Themes running through the synthesis')
  })
})

function truncateForPrompt(value: string | null | undefined, maxLength: number): string {
  if (!value) return ''
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function formatPaperRefs(
  refs: Array<{ paperTitle: string; paperId: string }>,
  limit: number
): string {
  const visible = refs
    .slice(0, limit)
    .map((ref) => `${truncateForPrompt(ref.paperTitle, 60)} (${ref.paperId})`)

  const remaining = refs.length - visible.length
  if (remaining > 0) {
    visible.push(`+${remaining} more`)
  }

  return visible.join(', ')
}

function isSchemaValidationFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const err = error as {
    name?: unknown
    message?: unknown
    cause?: unknown
  }

  const name = typeof err.name === 'string' ? err.name : ''
  const message = typeof err.message === 'string' ? err.message.toLowerCase() : ''

  if (
    name === 'AI_TypeValidationError' ||
    name === 'TypeValidationError' ||
    name === 'AI_NoObjectGeneratedError' ||
    name === 'NoObjectGeneratedError'
  ) {
    return true
  }

  if (
    message.includes('schema') ||
    message.includes('validation') ||
    message.includes('type validation') ||
    message.includes('no object generated') ||
    message.includes('json')
  ) {
    return true
  }

  return err.cause ? isSchemaValidationFailure(err.cause) : false
}

function uniqueIds(ids: string[], limit = Number.POSITIVE_INFINITY): string[] {
  const deduped: string[] = []
  const seen = new Set<string>()

  for (const id of ids) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    deduped.push(id)
    if (deduped.length >= limit) break
  }

  return deduped
}

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

function compactSupportStatement(statement: string | undefined): string | undefined {
  if (!statement) return undefined
  const normalized = truncateForPrompt(statement, 120)
  const countMatch = normalized.match(/(\d+\s+of\s+\d+\s+papers?(?:\s+\(\d+%\))?)/i)
  return countMatch ? countMatch[1] : normalized
}

function isWeakPlannerText(value: string | undefined): boolean {
  if (!value) return true
  const normalized = value.replace(/\s+/g, ' ').trim().toLowerCase()
  if (!normalized) return true
  if (normalized.length < 45) return true
  const genericLeadIn =
    /^(state|summarize|discuss|analyze|analyse|examine|review|present|describe|highlight|outline|explore|consider|address|cover)\b/
  const hasEvidenceSignal =
    /\b(\d+%?|\d+\s+of\s+\d+|pattern|contradiction|gap|evidence|citation|cross-study|compare|mechanism|limitation|support)\b/
  return genericLeadIn.test(normalized) && !hasEvidenceSignal.test(normalized)
}

function isWeakKeyPoint(
  keyPoint: SectionPlan['keyPointsToMake'][number],
  isLiteratureFocused: boolean
): boolean {
  if (!keyPoint.point || isWeakPlannerText(keyPoint.point)) return true
  if (!isLiteratureFocused) return false
  return keyPoint.supportingPatternIds.length === 0 && keyPoint.requiredCitations.length === 0
}

function normalizeStructuredKeyPoints(
  keyPoints: SectionPlan['keyPointsToMake'],
  limit: number
): SectionPlan['keyPointsToMake'] {
  const deduped: SectionPlan['keyPointsToMake'] = []
  const seen = new Set<string>()

  for (const keyPoint of keyPoints) {
    const point = keyPoint.point.replace(/\s+/g, ' ').trim()
    if (!point) continue
    const normalized = point.toLowerCase()
    if (seen.has(normalized)) continue
    seen.add(normalized)
    deduped.push({
      point,
      supportingPatternIds: uniqueIds(keyPoint.supportingPatternIds, 4),
      requiredCitations: uniqueIds(keyPoint.requiredCitations, 4),
    })
    if (deduped.length >= limit) break
  }

  return deduped
}

function buildPatternKeyPoint(
  pattern: SectionPlan['content']['patterns'][number]
): SectionPlan['keyPointsToMake'][number] {
  const support = compactSupportStatement(pattern.data.supportStatement)
  const values = pattern.data.valuesSummary ? truncateForPrompt(pattern.data.valuesSummary, 48) : undefined
  const evidenceTail = values
    ? `, with reported values ${values}`
    : support
      ? `, supported by ${support}`
      : ''
  const point = `${truncateForPrompt(pattern.claim, 150)}${evidenceTail}`

  return {
    point: truncateForPrompt(point, 180),
    supportingPatternIds: [pattern.patternId],
    requiredCitations: uniqueIds(pattern.supportingPaperIds, 3),
  }
}

function buildContradictionKeyPoint(
  contradiction: SectionPlan['content']['contradictions'][number]
): SectionPlan['keyPointsToMake'][number] {
  return {
    point: truncateForPrompt(`The literature remains divided on ${contradiction.description}`, 180),
    supportingPatternIds: [],
    requiredCitations: uniqueIds(contradiction.sides.flatMap(side => side.paperIds), 4),
  }
}

function buildGapKeyPoint(
  gap: SectionPlan['content']['gaps'][number]
): SectionPlan['keyPointsToMake'][number] {
  const point = gap.suggestedFutureWork
    ? `A key uncertainty remains around ${gap.description}, pointing to ${truncateForPrompt(gap.suggestedFutureWork, 70)}`
    : `A key uncertainty remains around ${gap.description}`
  return {
    point: truncateForPrompt(point, 180),
    supportingPatternIds: [],
    requiredCitations: [],
  }
}

function buildEvidenceFirstApproach(
  section: SectionPlan,
  sectionType: SectionType
): string {
  if (section.content.contradictions.length > 0) {
    return 'Structure the section around the main disagreement, compare the strongest evidence on each side, and then interpret why the studies diverge.'
  }
  if (section.content.gaps.length > 0 && section.content.patterns.length === 0) {
    return 'Use the strongest established findings as context, then show where the literature still stops short and why those gaps matter.'
  }
  if (section.content.patterns.length > 0) {
    return 'Build the section around the strongest findings, using representative evidence and only enough methodological caveat to sharpen the interpretation.'
  }
  if (sectionType === 'introduction') {
    return 'Frame the stakes with the most relevant evidence, narrow to the review scope, and preview the logic of the synthesis without drifting into generic background.'
  }
  return 'Keep the section anchored in concrete findings and let the interpretation grow out of the evidence rather than generic summary.'
}

function strengthenPlannerSections(
  sections: SectionPlan[]
): {
  rewrittenKeyPointSections: string[]
  rewrittenApproachSections: string[]
  expandedPrimarySections: string[]
} {
  const rewrittenKeyPointSections: string[] = []
  const rewrittenApproachSections: string[] = []
  const expandedPrimarySections: string[] = []
  const claimsEstablished: string[] = []

  for (const section of sections) {
    const sectionType = inferSectionType(section.outlineSectionKey, section.title)
    const existingKeyPoints = normalizeStructuredKeyPoints(section.keyPointsToMake, 4)
    const preservedSpecific = existingKeyPoints.filter(kp => !isWeakKeyPoint(kp, section.isLiteratureFocused))

    if (section.isLiteratureFocused) {
      const derivedKeyPoints: SectionPlan['keyPointsToMake'] = []
      const patternLimit = sectionType === 'conclusion' ? 1 : 2
      const contradictionLimit = sectionType === 'introduction' ? 0 : 1
      const gapLimit = sectionType === 'discussion' || sectionType === 'conclusion' ? 2 : 1

      derivedKeyPoints.push(...section.content.patterns.slice(0, patternLimit).map(buildPatternKeyPoint))
      derivedKeyPoints.push(...section.content.contradictions.slice(0, contradictionLimit).map(buildContradictionKeyPoint))
      derivedKeyPoints.push(...section.content.gaps.slice(0, gapLimit).map(buildGapKeyPoint))

      const strengthened = normalizeStructuredKeyPoints(
        [...preservedSpecific, ...derivedKeyPoints],
        4
      )

      const evidenceAnchoredCount = existingKeyPoints.filter(
        kp => kp.supportingPatternIds.length > 0 || kp.requiredCitations.length > 0
      ).length
      const shouldRewriteKeyPoints =
        strengthened.length >= 2 &&
        (
          existingKeyPoints.length < 2 ||
          evidenceAnchoredCount < Math.min(2, existingKeyPoints.length) ||
          existingKeyPoints.every(kp => isWeakKeyPoint(kp, true))
        )

      if (shouldRewriteKeyPoints) {
        section.keyPointsToMake = strengthened
        rewrittenKeyPointSections.push(section.title)
      } else {
        section.keyPointsToMake = existingKeyPoints
      }
    } else {
      section.keyPointsToMake = existingKeyPoints
    }

    if (isWeakPlannerText(section.writingGuidance.approach)) {
      section.writingGuidance.approach = buildEvidenceFirstApproach(section, sectionType)
      rewrittenApproachSections.push(section.title)
    }

    const evidenceDrivenPrimary = uniqueIds([
      ...section.keyPointsToMake.flatMap(keyPoint => keyPoint.requiredCitations),
      ...section.content.patterns.flatMap(pattern => pattern.supportingPaperIds),
      ...section.content.contradictions.flatMap(contradiction => contradiction.sides.flatMap(side => side.paperIds)),
    ], section.isLiteratureFocused ? 10 : 5)

    const mergedPrimary = uniqueIds([...evidenceDrivenPrimary, ...section.papers.primary], section.isLiteratureFocused ? 10 : 5)
    if (mergedPrimary.some(paperId => !section.papers.primary.includes(paperId))) {
      expandedPrimarySections.push(section.title)
    }
    section.papers.primary = mergedPrimary
    section.papers.supporting = uniqueIds(
      [...section.papers.supporting, ...section.papers.primary].filter(id => !section.papers.primary.includes(id)),
      12
    )

    section.mustNotRepeat = claimsEstablished.length > 0 ? uniqueStrings(claimsEstablished, 12) : []
    claimsEstablished.push(...section.keyPointsToMake.map(keyPoint => keyPoint.point))
  }

  return {
    rewrittenKeyPointSections,
    rewrittenApproachSections,
    expandedPrimarySections,
  }
}

type PlannerSectionEvidenceAssignment = {
  outlineSectionKey: string
  title: string
  sectionType: SectionType
  isLiteratureFocused: boolean
  patternIds: string[]
  contradictionIds: string[]
  gapIds: string[]
  paperIds: string[]
}

const PLANNER_TOKEN_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'these', 'those', 'into',
  'within', 'across', 'about', 'under', 'over', 'between', 'during', 'after',
  'before', 'study', 'studies', 'section', 'marine', 'heatwave', 'heatwaves',
  'coastal', 'species', 'effects', 'effect', 'impact', 'impacts'
])

function tokenizePlannerText(value: string | undefined): string[] {
  if (!value) return []
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 4 && !PLANNER_TOKEN_STOPWORDS.has(token))
}

function scoreTokenOverlap(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0
  const rightSet = new Set(right)
  let overlap = 0
  for (const token of left) {
    if (rightSet.has(token)) overlap += 1
  }
  return overlap
}

function getSectionPatternQuota(sectionType: SectionType): number {
  switch (sectionType) {
    case 'introduction':
      return 2
    case 'conclusion':
      return 2
    case 'discussion':
      return 3
    case 'literature':
      return 4
    default:
      return 3
  }
}

function scorePatternForSection(
  section: {
    sectionType: SectionType
    title: string
    sectionKey: string
    keyPoints?: string[]
  },
  pattern: SynthesisPlanInput['analysis']['patterns'][number],
  assignedCount: number
): number {
  const sectionTokens = tokenizePlannerText(
    `${section.sectionKey} ${section.title} ${(section.keyPoints || []).join(' ')}`
  )
  const patternTokens = tokenizePlannerText(
    `${pattern.claim} ${pattern.summary} ${pattern.direction || ''} ${pattern.limitations || ''}`
  )
  const overlap = scoreTokenOverlap(sectionTokens, patternTokens)
  const supportRatio = pattern.support.total > 0 ? pattern.support.count / pattern.support.total : 0
  let score = overlap * 4 + pattern.confidence * 3 + supportRatio * 2

  switch (section.sectionType) {
    case 'literature':
      score += 2
      break
    case 'discussion':
      score += pattern.limitations ? 1.5 : 0.5
      break
    case 'introduction':
      score += supportRatio >= 0.5 ? 1 : 0
      break
    case 'conclusion':
      score += pattern.confidence >= 0.75 ? 1 : 0
      break
    default:
      break
  }

  const quotaPenalty = assignedCount / Math.max(getSectionPatternQuota(section.sectionType), 1)
  return score - quotaPenalty * 2
}

function chooseBestSectionIndex(
  scores: number[]
): number {
  let bestIndex = 0
  let bestScore = Number.NEGATIVE_INFINITY
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > bestScore) {
      bestScore = scores[i]
      bestIndex = i
    }
  }
  return bestIndex
}

function buildPlannerSectionEvidenceAssignments(
  input: SynthesisPlanInput
): PlannerSectionEvidenceAssignment[] {
  const { analysis, papers, outlineSections } = input
  const paperById = new Map(papers.map(paper => [paper.id, paper]))

  const assignments = outlineSections.map((section) => ({
    outlineSectionKey: section.sectionKey,
    title: section.title,
    sectionType: inferSectionType(section.sectionKey, section.title),
    isLiteratureFocused: section.isLiteratureFocused,
    keyPoints: section.keyPoints || [],
    patternIds: [] as string[],
    contradictionIds: [] as string[],
    gapIds: [] as string[],
    paperIds: [] as string[],
  }))

  const literatureSections = assignments.filter(section => section.isLiteratureFocused)
  if (literatureSections.length === 0) {
    return assignments.map(({ keyPoints: _keyPoints, ...assignment }) => assignment)
  }

  const rankedPatterns = [...analysis.patterns].sort((left, right) => {
    const leftScore = left.confidence * 2 + (left.support.total > 0 ? left.support.count / left.support.total : 0)
    const rightScore = right.confidence * 2 + (right.support.total > 0 ? right.support.count / right.support.total : 0)
    return rightScore - leftScore
  })

  for (const pattern of rankedPatterns) {
    const scores = literatureSections.map((section) =>
      scorePatternForSection({ ...section, sectionKey: section.outlineSectionKey }, pattern, section.patternIds.length)
    )
    const targetIndex = chooseBestSectionIndex(scores)
    literatureSections[targetIndex]?.patternIds.push(pattern.id)
  }

  const discussionSections = literatureSections.filter(section => section.sectionType === 'discussion')
  const conclusionSections = literatureSections.filter(section => section.sectionType === 'conclusion')
  const contradictionPreferredSections =
    literatureSections.filter(section =>
      /contradiction|challenge|debate|discussion|method/i.test(`${section.outlineSectionKey} ${section.title}`)
    )
  const contradictionTargets = contradictionPreferredSections.length > 0
    ? contradictionPreferredSections
    : (discussionSections.length > 0 ? discussionSections : literatureSections)

  analysis.contradictions.forEach((contradiction, index) => {
    contradictionTargets[index % contradictionTargets.length]?.contradictionIds.push(contradiction.id)
  })

  const gapPreferredSections =
    literatureSections.filter(section =>
      /future|gap|conclusion|discussion|direction/i.test(`${section.outlineSectionKey} ${section.title}`)
    )
  const gapTargets = gapPreferredSections.length > 0
    ? gapPreferredSections
    : (conclusionSections.length > 0 ? conclusionSections : literatureSections)

  analysis.gaps.forEach((gap, index) => {
    gapTargets[index % gapTargets.length]?.gapIds.push(gap.id)
  })

  for (const section of assignments) {
    const relatedPaperIds = uniqueIds([
      ...section.patternIds.flatMap((patternId) => {
        const pattern = analysis.patterns.find(item => item.id === patternId)
        return pattern ? pattern.support.papers.map(paper => paper.paperId) : []
      }),
      ...section.contradictionIds.flatMap((contradictionId) => {
        const contradiction = analysis.contradictions.find(item => item.id === contradictionId)
        return contradiction ? contradiction.sides.flatMap(side => side.papers.map(paper => paper.paperId)) : []
      }),
      ...section.gapIds.flatMap((gapId) => {
        const gap = analysis.gaps.find(item => item.id === gapId)
        return gap ? gap.suggestedBy : []
      }),
    ], section.isLiteratureFocused ? 10 : 5)

    const sectionTokens = tokenizePlannerText(
      `${section.outlineSectionKey} ${section.title} ${section.keyPoints.join(' ')}`
    )
    const additionalPaperIds = papers
      .map((paper) => ({
        id: paper.id,
        score: scoreTokenOverlap(
          sectionTokens,
          tokenizePlannerText(`${paper.title} ${paper.domain} ${paper.authors.join(' ')}`)
        ),
      }))
      .filter(candidate => candidate.score > 0 && !relatedPaperIds.includes(candidate.id))
      .sort((left, right) => right.score - left.score)
      .slice(0, section.isLiteratureFocused ? 4 : 2)
      .map(candidate => candidate.id)

    const prioritizedPaperIds = uniqueIds(
      [...relatedPaperIds, ...additionalPaperIds].filter(paperId => paperById.has(paperId)),
      section.isLiteratureFocused ? 10 : 5
    )

    section.paperIds = prioritizedPaperIds
  }

  return assignments.map(({ keyPoints: _keyPoints, ...assignment }) => assignment)
}

function computePrimaryDominance(
  sections: SectionPlan[]
): { dominanceRatio: number; uniquePrimaryCount: number } {
  const paperCounts = new Map<string, number>()
  let totalPrimaryAssignments = 0

  for (const section of sections) {
    const primaryIds = uniqueIds(section.papers.primary || [])
    for (const paperId of primaryIds) {
      paperCounts.set(paperId, (paperCounts.get(paperId) || 0) + 1)
      totalPrimaryAssignments++
    }
  }

  let maxCount = 0
  for (const count of paperCounts.values()) {
    if (count > maxCount) maxCount = count
  }

  return {
    dominanceRatio: totalPrimaryAssignments > 0 ? maxCount / totalPrimaryAssignments : 0,
    uniquePrimaryCount: paperCounts.size,
  }
}

function rebalancePrimaryPapersAcrossSections(
  sections: SectionPlan[],
  availablePaperIds: string[]
): {
  rebalanced: boolean
  beforeDominance: number
  afterDominance: number
  uniquePrimaryBefore: number
  uniquePrimaryAfter: number
} {
  const literatureSections = sections.filter(section => section.isLiteratureFocused)
  const validPaperIds = uniqueIds(availablePaperIds)

  if (literatureSections.length < 2 || validPaperIds.length < 6) {
    return {
      rebalanced: false,
      beforeDominance: 0,
      afterDominance: 0,
      uniquePrimaryBefore: 0,
      uniquePrimaryAfter: 0,
    }
  }

  const validSet = new Set(validPaperIds)
  const paperOrder = new Map(validPaperIds.map((paperId, index) => [paperId, index]))

  // Sanitize paper lists before calculating dominance.
  for (const section of sections) {
    const primary = uniqueIds((section.papers.primary || []).filter(id => validSet.has(id)))
    const supporting = uniqueIds(
      (section.papers.supporting || []).filter(id => validSet.has(id) && !primary.includes(id))
    )
    section.papers.primary = primary
    section.papers.supporting = supporting
  }

  const before = computePrimaryDominance(literatureSections)
  const targetPrimaryPerSection = Math.min(
    validPaperIds.length,
    Math.max(3, Math.min(10, Math.ceil(validPaperIds.length / literatureSections.length) + 2))
  )

  const minExpectedUniquePrimary = Math.min(
    validPaperIds.length,
    literatureSections.length * Math.max(2, targetPrimaryPerSection - 2)
  )

  const shouldRebalance =
    before.dominanceRatio > 0.5 ||
    before.uniquePrimaryCount < minExpectedUniquePrimary

  if (!shouldRebalance) {
    return {
      rebalanced: false,
      beforeDominance: before.dominanceRatio,
      afterDominance: before.dominanceRatio,
      uniquePrimaryBefore: before.uniquePrimaryCount,
      uniquePrimaryAfter: before.uniquePrimaryCount,
    }
  }

  const usageByPaper = new Map<string, number>(validPaperIds.map(id => [id, 0]))

  for (const section of literatureSections) {
    const currentPrimary = uniqueIds(section.papers.primary)
    const currentSupporting = uniqueIds(
      section.papers.supporting.filter(id => !currentPrimary.includes(id))
    )

    const keepCount = Math.min(
      currentPrimary.length,
      Math.max(1, Math.floor(targetPrimaryPerSection * 0.35))
    )
    const keptPrimary = currentPrimary.slice(0, keepCount)

    const sortedCandidates = validPaperIds
      .filter(id => !keptPrimary.includes(id))
      .sort((a, b) => {
        const usageDiff = (usageByPaper.get(a) || 0) - (usageByPaper.get(b) || 0)
        if (usageDiff !== 0) return usageDiff
        return (paperOrder.get(a) || 0) - (paperOrder.get(b) || 0)
      })

    const needed = Math.max(0, targetPrimaryPerSection - keptPrimary.length)
    const addedPrimary = sortedCandidates.slice(0, needed)
    const rebalancedPrimary = uniqueIds([...keptPrimary, ...addedPrimary], targetPrimaryPerSection)

    for (const paperId of rebalancedPrimary) {
      usageByPaper.set(paperId, (usageByPaper.get(paperId) || 0) + 1)
    }

    const carryOverPrimary = currentPrimary.filter(id => !rebalancedPrimary.includes(id))
    const rebalancedSupporting = uniqueIds(
      [...currentSupporting, ...carryOverPrimary],
      12
    )

    section.papers.primary = rebalancedPrimary
    section.papers.supporting = rebalancedSupporting
  }

  const after = computePrimaryDominance(literatureSections)

  return {
    rebalanced: true,
    beforeDominance: before.dominanceRatio,
    afterDominance: after.dominanceRatio,
    uniquePrimaryBefore: before.uniquePrimaryCount,
    uniquePrimaryAfter: after.uniquePrimaryCount,
  }
}

// =============================================================================
// Prompt
// =============================================================================

const SYSTEM_PROMPT = `You are an expert academic writer planning a literature synthesis. Your task is to create a detailed plan for writing a synthesis based on cross-document analysis results.

═══════════════════════════════════════════════════════════════════════════════
CRITICAL INSTRUCTIONS
═══════════════════════════════════════════════════════════════════════════════

1. SECTION COUNT (MOST IMPORTANT)
   - You MUST create EXACTLY the same number of sections as specified in the outline
   - Do NOT skip, combine, or add extra sections
   - If outline has 5 sections, your plan MUST have exactly 5 sections

2. SECTION ALIGNMENT
   - Each section MUST specify outlineSectionKey matching the outline EXACTLY
   - Each section MUST specify isLiteratureFocused (copy value from outline)
   - Literature-focused sections: include patterns/contradictions/gaps
   - Non-literature sections (Methods, Results): NO synthesis patterns

3. PAPER TYPE CONSTRAINTS
   - Respect required/forbidden sections for the paper type
   - Match sections to the provided outline structure
   - Allocate content appropriately for the paper type

═══════════════════════════════════════════════════════════════════════════════
WRITING GUIDANCE PER SECTION
═══════════════════════════════════════════════════════════════════════════════

For each section, specify:

SYNTHESIS LEVEL:
- "high": Heavy integration across sources (literature review sections)
- "moderate": Some comparison, but also descriptive (discussion sections)
- "low": Mostly descriptive, minimal synthesis (methods, results sections)

PARAGRAPH STRATEGY (choose most appropriate):
- "pattern_first": Lead with main pattern, then supporting evidence
- "chronological": Trace development over time
- "compare_contrast": Juxtapose different findings/views
- "problem_solution": Present issue, then approaches
- "general_to_specific": Start broad, narrow down
- "specific_to_general": Start with examples, build to principles

═══════════════════════════════════════════════════════════════════════════════
KEY POINTS STRUCTURE (REQUIRED FOR EVERY SECTION)
═══════════════════════════════════════════════════════════════════════════════

EVERY section MUST have at least 2-3 key points. Do NOT leave keyPointsToMake empty.

For each key point, specify:
- point: The specific claim to make (derived from your analysis of the patterns, contradictions, and gaps)
- supportingPatternIds: Which patterns from the analysis support this (can be empty for structural points)
- requiredCitations: Paper IDs that MUST be cited (can be empty for methodological or concluding points)

Literature-focused sections MUST be evidence-first:
- The first 2 key points should be concrete, section-specific claims grounded in the provided patterns, contradictions, or gaps
- Avoid vague planner language like "Discuss impacts" or "Review responses"
- When support statements or values are available, reflect that specificity in the key point
- If a key point makes a literature claim, requiredCitations should usually be non-empty
- Key points should read like substantive claims, not outline placeholders or canned signposting

Section-type guidance:
- Introduction: State the research problem and its significance
- Literature Review/Thematic Analysis: Present synthesized findings with specific evidence from patterns
- Discussion: Interpret findings, explain contradictions, connect to broader implications
- Conclusion: Summarize key contributions and propose future directions

Derive all key points from the actual patterns, contradictions, and gaps provided in the analysis above.
Use the deterministic section evidence candidates as your starting allocation. Refine them only when another section is clearly better suited.

═══════════════════════════════════════════════════════════════════════════════
CONTENT ALLOCATION
═══════════════════════════════════════════════════════════════════════════════

PATTERN PRESENTATION:
- Decide which patterns are central vs supporting
- Include support statements only when denominator scope is explicit
- Only assign patterns to literature-focused sections
- Do not fabricate or merge denominators across different pattern scopes

CONTRADICTIONS:
- Present both sides fairly
- Offer explanations for disagreements
- Don't dismiss valid conflicting findings

GAPS:
- Integrate naturally (typically in Discussion or Conclusion)
- Connect to patterns (what's known vs unknown)
- Suggest concrete future research directions

═══════════════════════════════════════════════════════════════════════════════
PAPER DISTRIBUTION (CRITICAL FOR CITATION DIVERSITY)
═══════════════════════════════════════════════════════════════════════════════

You MUST distribute papers across sections to maximize citation diversity:
- Each paper should appear as "primary" in at least ONE section
- Do NOT assign the same 5-10 papers as primary for every section
- Different sections discuss different aspects → different papers are relevant
- Aim for every available paper to be assigned (primary or supporting) to at least one section
- Literature-focused sections should have the most primary papers (8-15 each)
- Non-literature sections can have fewer (3-5 each)

BAD: Same 8 papers in every section's primary list
GOOD: Introduction cites foundational papers, Lit Review cites empirical studies, Discussion cites recent/contrasting papers

═══════════════════════════════════════════════════════════════════════════════
NARRATIVE FLOW
═══════════════════════════════════════════════════════════════════════════════

- Plan transitions between sections (transitionFrom, transitionTo)
- Maintain a clear argument throughout
- End with synthesis, not just summary
- Avoid repetition: don't restate claims from earlier sections

Remember: This is a PLAN for writing, not the synthesis itself. Be specific about what to write and how.`

function buildPrompt(
  input: SynthesisPlanInput,
  sectionAssignments: PlannerSectionEvidenceAssignment[]
): string {
  const { 
    analysis, 
    papers, 
    targetWordCount, 
    focusAreas, 
    audienceLevel,
    paperType,
    structuralConstraints,
    outlineSections
  } = input
  const paperById = new Map(papers.map((paper) => [paper.id, paper]))
  
  // Format patterns
  const patternsText = analysis.patterns.map(p => {
    let text = `[Pattern ${p.id}]
  Claim: ${truncateForPrompt(p.claim, MAX_SUMMARY_LENGTH)}
  Summary: ${truncateForPrompt(p.summary, MAX_SUMMARY_LENGTH)}
  Support: ${p.support.count}/${p.support.total} papers
  Consistency: ${p.consistency}
  Confidence: ${(p.confidence * 100).toFixed(0)}%`
    
    if (p.values?.summary) {
      text += `\n  Values: ${truncateForPrompt(p.values.summary, 160)}`
    }
    if (p.direction) {
      text += `\n  Direction: ${truncateForPrompt(p.direction, 80)}`
    }
    if (p.limitations) {
      text += `\n  Limitations: ${truncateForPrompt(p.limitations, 160)}`
    }
    
    // List supporting papers
    text += `\n  Papers: ${formatPaperRefs(p.support.papers, MAX_PATTERN_PAPER_REFS_IN_PROMPT)}`
    
    return text
  }).join('\n\n')
  
  // Format contradictions
  const contradictionsText = analysis.contradictions.length > 0
    ? analysis.contradictions.map(c => {
        let text = `[Contradiction ${c.id}]
  Description: ${truncateForPrompt(c.description, MAX_SUMMARY_LENGTH)}
  Severity: ${c.severity}`
        
        c.sides.forEach((s, i) => {
          text += `\n  Side ${i + 1}: ${truncateForPrompt(s.position, 160)}`
          text += `\n    Papers: ${s.papers
            .slice(0, MAX_CONTRADICTION_PAPER_REFS_PER_SIDE)
            .map(p => truncateForPrompt(p.paperTitle, 60))
            .join(', ')}${s.papers.length > MAX_CONTRADICTION_PAPER_REFS_PER_SIDE ? `, +${s.papers.length - MAX_CONTRADICTION_PAPER_REFS_PER_SIDE} more` : ''}`
        })
        
        if (c.possibleExplanation) {
          text += `\n  Possible Explanation: ${truncateForPrompt(c.possibleExplanation, 180)}`
        }
        
        return text
      }).join('\n\n')
    : 'No contradictions found.'
  
  // Format gaps
  const gapsText = analysis.gaps.length > 0
    ? analysis.gaps.map(g => `[Gap ${g.id}]
  Description: ${truncateForPrompt(g.description, 180)}
  Type: ${g.type}
  Relevance: ${truncateForPrompt(g.relevance, 120)}`).join('\n\n')
    : 'No gaps identified.'
  
  const plannerRelevantPaperIds = uniqueIds(
    sectionAssignments.flatMap((assignment) => assignment.paperIds),
    MAX_PLANNER_INPUT_PAPERS
  )
  const promptPapers = (plannerRelevantPaperIds.length > 0
    ? plannerRelevantPaperIds
        .map((paperId) => paperById.get(paperId))
        .filter((paper): paper is PaperInfo => Boolean(paper))
    : papers
  ).slice(0, Math.min(MAX_PAPERS_IN_PROMPT, MAX_PLANNER_INPUT_PAPERS))

  // Format papers
  const papersText = promptPapers.map(p => 
    `- ${truncateForPrompt(p.title, MAX_TITLE_LENGTH)} (${p.id}) - ${truncateForPrompt(p.authors.join(', '), 80)}${p.year ? ` (${p.year})` : ''} - ${truncateForPrompt(p.domain, 60)}`
  ).join('\n')

  const omittedPaperCount = Math.max(0, papers.length - promptPapers.length)
  
  // NEW: Build paper type constraints text
  let paperTypeText = ''
  if (paperType && structuralConstraints) {
    paperTypeText = `
PAPER TYPE CONSTRAINTS:
Paper Type: ${paperType}
Discipline: ${structuralConstraints.disciplineContext}

Required Sections:
${structuralConstraints.requiredSections.map(s => 
  `- ${s.key}: "${s.name}" ${s.isLiteratureFocused ? '[LITERATURE-FOCUSED - include synthesis patterns]' : '[NOT literature-focused - no synthesis patterns]'}`
).join('\n')}

Forbidden Sections (DO NOT CREATE):
${structuralConstraints.forbiddenSections.length > 0 
  ? structuralConstraints.forbiddenSections.map(s => `- ${s}`).join('\n')
  : '(none)'}

Source Requirements:
- Minimum sources: ${structuralConstraints.minSources}
- Ideal sources: ${structuralConstraints.idealSources}
`
  }
  
  // NEW: Build outline sections text
  let outlineText = ''
  if (outlineSections && outlineSections.length > 0) {
    outlineText = `
OUTLINE SECTIONS (REQUIRED - CREATE EXACTLY ${outlineSections.length} SECTIONS):
You MUST create exactly ${outlineSections.length} sections in your plan, one for EACH outline section below.
Do NOT skip any sections. Do NOT combine sections. Do NOT create extra sections.

${outlineSections.map((s, i) => 
  `${i + 1}. ${s.sectionKey}: "${s.title}" ${s.isLiteratureFocused ? '[LITERATURE-FOCUSED]' : '[NOT literature-focused]'} ${s.expectedWords ? `(~${s.expectedWords} words)` : ''}`
).join('\n')}
`
  }

  const sectionEvidenceText = sectionAssignments.length > 0
    ? `
SECTION EVIDENCE CANDIDATES (DETERMINISTIC PRE-ASSIGNMENT):
Use these as the default allocation for section content. You may move an item only if another section is clearly a better fit.

${sectionAssignments.map((assignment, index) => {
  const candidatePapers = assignment.paperIds
    .slice(0, 5)
    .map((paperId) => {
      const paper = paperById.get(paperId)
      return paper
        ? `${truncateForPrompt(paper.title, 60)} (${paperId})`
        : paperId
    })
    .join(', ')

  return `${index + 1}. ${assignment.outlineSectionKey}: "${assignment.title}" [${assignment.sectionType}]
  Candidate patterns: ${assignment.patternIds.length > 0 ? assignment.patternIds.join(', ') : '(none)'}
  Candidate contradictions: ${assignment.contradictionIds.length > 0 ? assignment.contradictionIds.join(', ') : '(none)'}
  Candidate gaps: ${assignment.gapIds.length > 0 ? assignment.gapIds.join(', ') : '(none)'}
  Priority papers: ${candidatePapers || '(none)'}`  
}).join('\n\n')}
`
    : ''
  
  // Build constraints
  const constraints: string[] = []
  if (targetWordCount) {
    constraints.push(`Target word count: ~${targetWordCount} words`)
  }
  if (focusAreas?.length) {
    constraints.push(`Focus areas: ${focusAreas.join(', ')}`)
  }
  if (audienceLevel) {
    constraints.push(`Audience: ${audienceLevel}`)
  }
  
  const constraintsText = constraints.length > 0
    ? `\nCONSTRAINTS:\n${constraints.join('\n')}\n`
    : ''
  
  return `Create a synthesis plan based on the following analysis:
${paperTypeText}
${outlineText}
${sectionEvidenceText}
SUMMARY:
${truncateForPrompt(analysis.summary, 300)}

KEY INSIGHTS:
${analysis.keyInsights.map((k, i) => `${i + 1}. ${truncateForPrompt(k, 140)}`).join('\n')}

PATTERNS (${analysis.patterns.length}):
${patternsText}

CONTRADICTIONS (${analysis.contradictions.length}):
${contradictionsText}

GAPS (${analysis.gaps.length}):
${gapsText}

PAPERS (${papers.length}):
${papersText}
${omittedPaperCount > 0 ? `\n- +${omittedPaperCount} additional papers omitted from the prompt list for brevity; use all provided paper IDs from patterns/contradictions/gaps when planning citation distribution.` : ''}
${constraintsText}
Plan a coherent synthesis that:
1. Creates EXACTLY ${outlineSections?.length || 'the same number of'} sections - one for EACH outline section, including non-literature sections like Methodology, Results, Discussion, Conclusion
2. Each section's outlineSectionKey MUST match an outline section key exactly
3. Marks isLiteratureFocused correctly for each section (copy from outline)
4. For non-literature sections: leave patterns/contradictions/gaps as EMPTY ARRAYS [], but still provide keyPointsToMake, writingGuidance, and papers
5. Covers all important patterns in literature-focused sections
6. Addresses contradictions fairly
7. Places gaps and future directions in Discussion/Conclusion sections
8. Flows logically from section to section with transitions
9. Provides clear writing guidance for EVERY section

CRITICAL: Your sections array MUST have exactly ${outlineSections?.length || 'the same number of'} elements. Do NOT skip non-literature sections - they still need plans with key points and writing guidance.`
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Generate a synthesis plan from analysis results
 */
export async function buildSynthesisPlan(input: SynthesisPlanInput): Promise<SynthesisPlanResult> {
  const startTime = Date.now()
  
  const { projectId, analysis, papers, targetWordCount = 3000 } = input
  
  if (analysis.patterns.length === 0) {
    return {
      success: false,
      error: 'No patterns to synthesize. Analysis must contain at least one pattern.',
      timeMs: Date.now() - startTime
    }
  }
  
  info({
    patterns: analysis.patterns.length,
    contradictions: analysis.contradictions.length,
    gaps: analysis.gaps.length,
    papers: papers.length,
    targetWordCount,
    paperType: input.paperType,
    outlineSections: input.outlineSections?.length || 0
  }, 'Building synthesis plan')
  const sectionAssignments = buildPlannerSectionEvidenceAssignments(input)
  info({
    stage: 'synthesis-pipeline',
    step: 'planner-section-evidence-assignment',
    sections: sectionAssignments.map((assignment) => ({
      outlineKey: assignment.outlineSectionKey,
      sectionType: assignment.sectionType,
      patternCount: assignment.patternIds.length,
      contradictionCount: assignment.contradictionIds.length,
      gapCount: assignment.gapIds.length,
      paperCount: assignment.paperIds.length,
    })),
    plannerInputPapers: uniqueIds(sectionAssignments.flatMap((assignment) => assignment.paperIds), MAX_PLANNER_INPUT_PAPERS).length,
  }, 'Prepared deterministic section evidence assignments for planner')
  
  try {
    let object: z.infer<typeof SynthesisPlanSchema> | null = null

    for (let attempt = 0; attempt <= PLAN_BUILDER_SCHEMA_RETRIES; attempt++) {
      const maxOutputTokens =
        PLAN_BUILDER_RETRY_TOKEN_BUDGETS[attempt] ?? PLAN_BUILDER_RETRY_TOKEN_BUDGETS[PLAN_BUILDER_RETRY_TOKEN_BUDGETS.length - 1]
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), PLAN_BUILDER_TIMEOUT_MS)

      try {
        const result = await generateObject({
          model: getLanguageModel(),
          schema: SynthesisPlanSchema,
          schemaName: 'synthesis_plan',
          schemaDescription: 'Structured section-by-section synthesis plan for an academic paper.',
          system: SYSTEM_PROMPT,
          prompt: buildPrompt(input, sectionAssignments),
          temperature: PLAN_BUILDER_TEMPERATURE,
          maxOutputTokens,
          abortSignal: controller.signal,
          providerOptions: {
            openai: {
              strictJsonSchema: true,
            },
            azure: {
              strictJsonSchema: true,
            },
          },
        })

        object = result.object
        break
      } catch (error) {
        const canRetry =
          attempt < PLAN_BUILDER_SCHEMA_RETRIES &&
          isSchemaValidationFailure(error)

        if (!canRetry) {
          throw error
        }

        warn(
          {
            attempt: attempt + 1,
            maxAttempts: PLAN_BUILDER_SCHEMA_RETRIES + 1,
            maxOutputTokens,
            error_name: error instanceof Error ? error.name : 'UnknownError',
            error_message: error instanceof Error ? error.message : String(error),
          },
          'Plan builder schema validation failed, retrying structured output'
        )
      } finally {
        clearTimeout(timeoutId)
      }
    }

    if (!object) {
      throw new Error('Plan builder did not return a structured object')
    }
    
    const timeMs = Date.now() - startTime
    
    // Log if section count doesn't match outline (should be rare with generateText)
    if (input.outlineSections && input.outlineSections.length > 0) {
      const existingKeys = new Set(object.sections.map(s => s.outlineSectionKey))
      const missingSections = input.outlineSections.filter(s => !existingKeys.has(s.sectionKey))
      
      if (missingSections.length > 0) {
        warn({
          expected: input.outlineSections.length,
          received: object.sections.length,
          outlineKeys: input.outlineSections.map(s => s.sectionKey),
          planKeys: object.sections.map(s => s.outlineSectionKey),
          missing: missingSections.map(s => s.sectionKey)
        }, 'Plan section count mismatch — LLM missed sections (no backfill)')
      }
    }
    
    // Track claims across sections to prevent repetition
    const claimsEstablished: string[] = []
    
    // Transform to final plan with IDs
    const sections: SectionPlan[] = object.sections.map((s, i) => {
      const outlineSection = input.outlineSections?.find(section => section.sectionKey === s.outlineSectionKey)
      // Collect key points as claims that shouldn't be repeated in later sections
      const sectionClaims = s.keyPointsToMake.map(kp => kp.point)
      
      const sectionPlan: SectionPlan = {
        id: uuidv4(),
        outlineSectionKey: s.outlineSectionKey,
        isLiteratureFocused: outlineSection?.isLiteratureFocused ?? s.isLiteratureFocused,
        title: s.title,
        purpose: s.purpose,
        content: {
          patterns: s.content.patterns.map(p => ({
            ...p,
            data: {
              supportStatement: p.data.supportStatement,
              valuesSummary: p.data.valuesSummary || undefined,
              contextNotes: p.data.contextNotes || undefined
            }
          })),
          contradictions: s.content.contradictions.map(c => ({
            ...c,
            resolutionStrategy: c.resolutionStrategy || undefined
          })),
          gaps: s.content.gaps.map(g => ({
            ...g,
            suggestedFutureWork: g.suggestedFutureWork || undefined
          })),
          additionalPoints: s.content.additionalPoints
        },
        papers: s.papers,
        writingGuidance: {
          approach: s.writingGuidance.approach,
          tone: s.writingGuidance.tone,
          transitionFrom: s.writingGuidance.transitionFrom || undefined,
          transitionTo: s.writingGuidance.transitionTo || undefined,
          paragraphStrategy: s.writingGuidance.paragraphStrategy || undefined,
          synthesisLevel: s.writingGuidance.synthesisLevel || 'moderate'
        },
        targetWordCount: s.targetWordCount,
        keyPointsToMake: s.keyPointsToMake,
        mustNotRepeat: i > 0 ? [...claimsEstablished] : []  // Previous sections' claims
      }
      
      // Add this section's claims for future sections
      claimsEstablished.push(...sectionClaims)
      
      return sectionPlan
    })
    
    const plan: SynthesisPlan = {
      id: uuidv4(),
      projectId,
      overview: {
        title: object.overview.title,
        abstract: object.overview.abstract,
        totalSections: object.overview.totalSections,
        totalWordCount: object.overview.totalWordCount,
        narrativeStrategy: object.overview.narrativeStrategy
      },
      sections,
      globalGuidance: {
        audienceLevel: object.globalGuidance.audienceLevel,
        writingStyle: object.globalGuidance.writingStyle,
        citationApproach: object.globalGuidance.citationApproach,
        keyThemes: object.globalGuidance.keyThemes
      },
      generatedAt: new Date(),
      generationTimeMs: timeMs,
      modelUsed: 'gpt-4o',
      inputSummary: {
        totalPapers: papers.length,
        totalFindings: analysis.totalFindings,
        patternsFound: analysis.patterns.length,
        contradictionsFound: analysis.contradictions.length,
        gapsFound: analysis.gaps.length
      }
    }

    // Root enforcement: ensure synthesis items are actually distributed across literature-focused sections.
    // When the LLM under-assigns patterns/contradictions/gaps, the downstream generator becomes evidence-blind,
    // causing low citation diversity and shallow content.
    const litSections = plan.sections.filter(s => s.isLiteratureFocused)
    if (litSections.length > 0) {
      const plannedPatternIds = new Set(plan.sections.flatMap(s => s.content.patterns.map(p => p.patternId)))
      const plannedContradictionIds = new Set(plan.sections.flatMap(s => s.content.contradictions.map(c => c.contradictionId)))
      const plannedGapIds = new Set(plan.sections.flatMap(s => s.content.gaps.map(g => g.gapId)))

      const needsPatternDistribution =
        plannedPatternIds.size < Math.min(input.analysis.patterns.length, litSections.length)
      const needsContradictionDistribution =
        plannedContradictionIds.size < Math.min(input.analysis.contradictions.length, Math.max(1, Math.floor(litSections.length / 2)))
      const needsGapDistribution =
        plannedGapIds.size < Math.min(input.analysis.gaps.length, Math.max(1, Math.floor(litSections.length / 2)))

      if (needsPatternDistribution || needsContradictionDistribution || needsGapDistribution) {
        warn(
          {
            planned: {
              patterns: plannedPatternIds.size,
              contradictions: plannedContradictionIds.size,
              gaps: plannedGapIds.size
            },
            available: {
              patterns: input.analysis.patterns.length,
              contradictions: input.analysis.contradictions.length,
              gaps: input.analysis.gaps.length
            },
            litSections: litSections.map(s => s.outlineSectionKey)
          },
          'Plan under-assigned synthesis items; distributing deterministically'
        )

        const SECTION_TYPE_ORDER: Record<SectionType, number> = {
          literature: 0,
          discussion: 1,
          introduction: 2,
          conclusion: 3,
          methodology: 4,
          results: 4,
          'non-content': 5,
        }
        const sectionOrder = [...litSections].sort((a, b) => {
          const typeA = inferSectionType(a.outlineSectionKey, a.title)
          const typeB = inferSectionType(b.outlineSectionKey, b.title)
          return (SECTION_TYPE_ORDER[typeA] ?? 4) - (SECTION_TYPE_ORDER[typeB] ?? 4)
        })

        const formatSupportStatement = (count: number, total: number) => {
          const pct = total > 0 ? Math.round((count / total) * 100) : 0
          return `Within the analyzed corpus for this pattern, ${count} of ${total} papers (${pct}%) provide support`
        }

        // Distribute missing patterns
        const missingPatterns = input.analysis.patterns.filter(p => !plannedPatternIds.has(p.id))
        for (let i = 0; i < missingPatterns.length; i++) {
          const p = missingPatterns[i]
          const target = sectionOrder[i % sectionOrder.length]
          target.content.patterns.push({
            patternId: p.id,
            claim: p.claim,
            importance: i < 3 ? 'central' : 'supporting',
            presentationApproach: 'Present as a cross-study pattern, then support with representative citations and note any limitations.',
            data: {
              supportStatement: formatSupportStatement(p.support.count, p.support.total),
              valuesSummary: p.values?.summary || undefined,
              contextNotes: p.summary || undefined
            },
            supportingPaperIds: (p.support.papers || []).map(sp => sp.paperId).filter(Boolean)
          })
        }

        const discussionSection =
          sectionOrder.find(s => inferSectionType(s.outlineSectionKey, s.title) === 'discussion') || sectionOrder[0]
        const missingContradictions = input.analysis.contradictions.filter(c => !plannedContradictionIds.has(c.id))
        for (const c of missingContradictions) {
          discussionSection.content.contradictions.push({
            contradictionId: c.id,
            description: c.description,
            presentationApproach: 'Present both sides fairly, then explain plausible reasons for disagreement (data, method, context).',
            resolutionStrategy: undefined,
            sides: (c.sides || []).map(s => ({
              position: s.position,
              paperIds: (s.papers || []).map(p => p.paperId).filter(Boolean)
            }))
          })
        }

        const conclusionSection =
          sectionOrder.find(s => inferSectionType(s.outlineSectionKey, s.title) === 'conclusion') || discussionSection
        const missingGaps = input.analysis.gaps.filter(g => !plannedGapIds.has(g.id))
        for (let i = 0; i < missingGaps.length; i++) {
          const g = missingGaps[i]
          const target = i % 2 === 0 ? discussionSection : conclusionSection
          target.content.gaps.push({
            gapId: g.id,
            description: g.description,
            importance: g.relevance || g.priority || 'notable',
            suggestedFutureWork: g.suggestedResearchQuestion || undefined
          })
        }
      }
    }

    const paperRebalance = rebalancePrimaryPapersAcrossSections(
      plan.sections,
      input.papers.map(p => p.id)
    )

    if (paperRebalance.rebalanced) {
      info(
        {
          stage: 'synthesis-pipeline',
          step: 'paper-priority-rebalance',
          beforeDominance: Number((paperRebalance.beforeDominance * 100).toFixed(1)),
          afterDominance: Number((paperRebalance.afterDominance * 100).toFixed(1)),
          uniquePrimaryBefore: paperRebalance.uniquePrimaryBefore,
          uniquePrimaryAfter: paperRebalance.uniquePrimaryAfter,
        },
        'Rebalanced section paper priorities for stronger citation diversity'
      )
    }

    const plannerStrengthening = strengthenPlannerSections(plan.sections)
    if (
      plannerStrengthening.rewrittenKeyPointSections.length > 0 ||
      plannerStrengthening.rewrittenApproachSections.length > 0 ||
      plannerStrengthening.expandedPrimarySections.length > 0
    ) {
      info(
        {
          stage: 'synthesis-pipeline',
          step: 'plan-strengthening',
          rewrittenKeyPointSections:
            plannerStrengthening.rewrittenKeyPointSections.length > 0
              ? plannerStrengthening.rewrittenKeyPointSections
              : null,
          rewrittenApproachSections:
            plannerStrengthening.rewrittenApproachSections.length > 0
              ? plannerStrengthening.rewrittenApproachSections
              : null,
          expandedPrimarySections:
            plannerStrengthening.expandedPrimarySections.length > 0
              ? plannerStrengthening.expandedPrimarySections
              : null,
        },
        'Strengthened weak planner sections with evidence-first guidance'
      )
    }
    
    // Diagnostic logging for synthesis pipeline debugging
    const emptyKeyPointsSections = plan.sections
      .filter(s => s.keyPointsToMake.length === 0)
      .map(s => s.title)
    
    const sectionsWithNoMustNotRepeat = plan.sections
      .filter((s, i) => i > 0 && s.mustNotRepeat.length === 0)
      .map(s => s.title)
    
    info({
      stage: 'synthesis-pipeline',
      step: 'plan-builder-complete',
      title: plan.overview.title,
      sections: plan.sections.length,
      totalWords: plan.overview.totalWordCount,
      timeMs,
      sectionDetails: plan.sections.map(s => ({
        title: s.title,
        outlineKey: s.outlineSectionKey,
        isLitFocused: s.isLiteratureFocused,
        keyPointsCount: s.keyPointsToMake.length,
        mustNotRepeatCount: s.mustNotRepeat.length,
        patternsCount: s.content.patterns.length,
        contradictionsCount: s.content.contradictions.length,
        gapsCount: s.content.gaps.length,
        synthesisLevel: s.writingGuidance.synthesisLevel,
        paragraphStrategy: s.writingGuidance.paragraphStrategy || 'none'
      })),
      warnings: {
        emptyKeyPointsSections: emptyKeyPointsSections.length > 0 ? emptyKeyPointsSections : null,
        sectionsWithNoMustNotRepeat: sectionsWithNoMustNotRepeat.length > 0 ? sectionsWithNoMustNotRepeat : null
      }
    }, 'Synthesis plan complete')
    
    // Log warnings explicitly for visibility
    if (emptyKeyPointsSections.length > 0) {
      warn({
        stage: 'synthesis-pipeline',
        issue: 'empty-key-points',
        sections: emptyKeyPointsSections
      }, `⚠️ ${emptyKeyPointsSections.length} sections have 0 key points - mustNotRepeat will be incomplete`)
    }
    
    return {
      success: true,
      plan,
      timeMs
    }
    
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    warn({
      error_name: err.name,
      error_message: err.message,
      error_stack: err.stack,
      patterns: input.analysis.patterns.length,
      contradictions: input.analysis.contradictions.length,
      gaps: input.analysis.gaps.length,
      sectionCount: input.outlineSections.length,
    }, 'Plan generation failed')
    return {
      success: false,
      error: err.message,
      timeMs: Date.now() - startTime
    }
  }
}
