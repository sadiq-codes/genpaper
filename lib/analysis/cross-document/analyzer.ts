/**
 * Cross-Document Analyzer
 * 
 * Analyzes findings across multiple papers to identify patterns,
 * contradictions, and gaps in the literature.
 * 
 * Key principles:
 * - No hardcoded categories - LLM discovers patterns
 * - Decomposed structured generation to reduce JSON truncation risk
 * - Works with flexible Finding type from extraction
 * 
 * @module lib/analysis/cross-document/analyzer
 */

import { generateObject } from 'ai'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { createHash } from 'crypto'
import { getAnalysisLanguageModel } from '@/lib/ai/vercel-client'
import type {
  AnalysisInput,
  AnalysisResult,
  Pattern,
  Contradiction,
  Gap,
  PaperSupport,
  FindingWithPaper
} from './types'

// =============================================================================
// Zod Schema - Flexible, No Hardcoded Enums
// =============================================================================

const _PaperSupportSchema = z.object({
  paperId: z.string(),
  paperTitle: z.string(),
  findingId: z.string(),
  claim: z.string(),
  value: z.string().nullable(),
  valueType: z.string().nullable(),
  evidence: z.string(),
  confidence: z.number().min(0).max(1)
})

const PatternSchema = z.object({
  claim: z.string().max(220).describe('SPECIFIC pattern statement - what multiple papers found, including magnitude and context'),
  summary: z.string().max(220).describe('Brief explanation of this pattern and its significance'),
  supportingPaperIds: z.array(z.string()).max(8).describe('Paper IDs that support this pattern'),
  supportingFindingIds: z.array(z.string()).max(14).describe('Finding IDs that support this pattern'),
  direction: z.string().nullable().describe('Nature: "positive", "negative", "descriptive", "no_effect", etc.'),
  consistency: z.string().describe('How consistent: "consistent" (all agree), "mostly_consistent" (75%+), "mixed" (<75%)'),
  valuesSummary: z.string().max(180).nullable().describe('SPECIFIC value summary: "effect sizes ranged from d=0.3 to d=0.9 (median d=0.55)" or "3 of 5 qualitative studies identified this as primary theme"'),
  valueRange: z.object({
    min: z.string().nullable(),
    max: z.string().nullable(),
    median: z.string().nullable(),
    heterogeneity: z.enum(['low', 'moderate', 'high']).nullable()
  }).nullable().describe('Structured value range when quantitative data available'),
  strength: z.enum(['strong', 'moderate', 'emerging']).describe('Pattern strength: strong (≥50% or ≥4 papers), moderate (3 papers or 30-49%), emerging (2 papers)'),
  confidence: z.number().min(0).max(1),
  limitations: z.string().max(180).nullable().describe('Specific caveats about this pattern')
})

const ContradictionSchema = z.object({
  description: z.string().max(220).describe('SPECIFIC description of what is contradictory'),
  contradictionType: z.enum([
    'direct',        // Opposite conclusions: X causes Y vs X does not cause Y
    'magnitude',     // Same direction, different strength: large effect vs small effect
    'conditional',   // Works in some contexts: effect in population A, no effect in population B
    'methodological' // Different methods yield different conclusions
  ]).describe('Type of contradiction'),
  sides: z.array(z.object({
    position: z.string().max(160).describe('One side of the disagreement with specific claim'),
    paperIds: z.array(z.string()).max(8).describe('Papers supporting this position'),
    findingIds: z.array(z.string()).max(16).describe('Finding IDs for this position'),
    evidenceStrength: z.enum(['strong', 'moderate', 'weak']).describe('Quality of evidence for this position')
  })).max(3),
  possibleExplanation: z.string().max(180).nullable().describe('SPECIFIC explanation: methodology difference, population difference, temporal context, etc.'),
  severity: z.enum(['minor', 'moderate', 'major']).describe('minor (nuance), moderate (significant but reconcilable), major (fundamental disagreement)'),
  resolutionSuggestion: z.string().max(180).nullable().describe('How might this contradiction be resolved?'),
  confidence: z.number().min(0).max(1)
})

const GapSchema = z.object({
  description: z.string().max(220).describe('SPECIFIC description of what is missing'),
  type: z.enum([
    'population',      // Who is not studied: certain demographics, regions, contexts
    'methodological',  // How: study designs, measures, durations not used
    'temporal',        // When: time periods, longitudinal tracking not covered
    'geographic',      // Where: regions or settings not examined
    'theoretical',     // What: mechanisms, frameworks, explanations not explored
    'replication'      // Whether: findings not replicated or confirmed
  ]).describe('Type of gap'),
  relevance: z.string().max(180).describe('WHY this gap matters for understanding the topic'),
  suggestedResearchQuestion: z.string().max(180).describe('CONCRETE research question that would address this gap. Example: "How does [factor] affect [outcome] in [underrepresented population]?"'),
  suggestedByPaperIds: z.array(z.string()).max(10).describe('Papers that mention or imply this gap'),
  priority: z.enum(['high', 'medium', 'low']).describe('How important is filling this gap?'),
  confidence: z.number().min(0).max(1)
})

const SynthesisStrengthSchema = z.object({
  overallConfidence: z.enum(['high', 'moderate', 'low']).describe('Overall confidence in synthesis'),
  evidenceBase: z.string().max(120).describe('Description: "8 empirical studies, 3 theoretical papers"'),
  methodologicalDiversity: z.enum(['high', 'moderate', 'low']).describe('Variety in study designs'),
  geographicDiversity: z.enum(['high', 'moderate', 'low']).describe('Variety in study locations'),
  temporalSpread: z.string().max(60).nullable().describe('Time range: "2015-2023"')
}).describe('Assessment of evidence base quality')

const FieldMaturitySchema = z.enum([
  'emerging',     // Few studies, many gaps, fundamental questions open
  'developing',   // Growing body, some consensus, significant gaps remain
  'established',  // Strong consensus, well-replicated, incremental questions
  'contested'     // Many studies but fundamental disagreements persist
]).describe('Maturity level of this research area')

const _AnalysisSchema = z.object({
  patterns: z.array(PatternSchema).max(8).describe('Patterns found across papers - aim for 4-8 patterns'),
  contradictions: z.array(ContradictionSchema).max(6).describe('Contradictions between papers - identify key disagreements'),
  gaps: z.array(GapSchema).max(6).describe('Gaps in the literature - prioritize the most important gaps'),
  summary: z.string().max(640).describe('Overall synthesis narrative of what the literature shows'),
  keyInsights: z.array(z.string().max(180)).max(5).describe('Top 4-5 key takeaways with specific evidence'),
  
  // NEW: Synthesis quality metadata
  synthesisStrength: SynthesisStrengthSchema,
  
  fieldMaturity: FieldMaturitySchema
})

// =============================================================================
// Prompt
// =============================================================================

const SYSTEM_PROMPT = `You perform cross-document synthesis across academic findings.

Output must be specific, evidence-grounded, and use IDs exactly as provided.

Rules:
- PATTERNS: identify recurring findings; quantify support (count + percentage), include value ranges when available, and classify strength:
  - strong: >=50% of papers or >=4 papers
  - moderate: 3 papers or 30-49%
  - emerging: 2 papers
- CONTRADICTIONS: identify disagreements and classify each as direct, magnitude, conditional, or methodological.
- GAPS: identify concrete missing areas (population, methodological, temporal, geographic, theoretical, replication) and include a concrete research question for each.
- SUMMARY + KEY INSIGHTS: synthesize, do not list.
- SYNTHESIS QUALITY: assess confidence, evidence base, diversity, and field maturity.

Specificity requirements:
- Use provided paper IDs and finding IDs.
- Use quantified wording only when denominator scope is explicit and claim-specific.
- Do not merge or compare aggregates from different denominators without labeling scope differences.
- Include concrete values/context when available.
- Avoid generic statements like "more research is needed."

Output compactness requirements:
- Keep text concise and avoid long prose.
- Prefer only the strongest supporting IDs per item.
- Stay within schema maxima (patterns<=8, contradictions<=6, gaps<=6, keyInsights<=5).`

type AnalysisObject = z.infer<typeof _AnalysisSchema>

const PART_OUTPUT_TOKEN_BUDGETS = [2200, 3600]
const FULL_OUTPUT_TOKEN_BUDGETS = [3600, 5200]
const ANALYSIS_PART_TIMEOUT_MS = Number(process.env.ANALYSIS_PART_TIMEOUT_MS || 120000)
const PROMPT_INPUT_TOKEN_BUDGET = Number(process.env.ANALYSIS_PROMPT_INPUT_TOKEN_BUDGET || 12000)
const PROMPT_TOKEN_CHAR_RATIO = 4
const STRICT_BATCH_MODE = process.env.ANALYSIS_STRICT_BATCH_MODE !== 'false'
const STRICT_INTEGRITY_MODE = process.env.ANALYSIS_STRICT_INTEGRITY_MODE !== 'false'

const PatternsOnlySchema = z.object({
  patterns: z.array(PatternSchema).max(8),
})

const ContradictionsOnlySchema = z.object({
  contradictions: z.array(ContradictionSchema).max(6),
})

const GapsOnlySchema = z.object({
  gaps: z.array(GapSchema).max(6),
})

const AnalysisMetaSchema = z.object({
  summary: z.string().max(640),
  keyInsights: z.array(z.string().max(180)).max(5),
  synthesisStrength: SynthesisStrengthSchema,
  fieldMaturity: FieldMaturitySchema,
})

const PART_INSTRUCTIONS = {
  patterns: `Return ONLY this schema: { "patterns": Pattern[] }.
Do not include contradictions, gaps, summary, keyInsights, synthesisStrength, or fieldMaturity.
Use only paperId/findingId values present in input.`,
  contradictions: `Return ONLY this schema: { "contradictions": Contradiction[] }.
Do not include patterns, gaps, summary, keyInsights, synthesisStrength, or fieldMaturity.
Use only paperId/findingId values present in input.`,
  gaps: `Return ONLY this schema: { "gaps": Gap[] }.
Do not include patterns, contradictions, summary, keyInsights, synthesisStrength, or fieldMaturity.
Use only paperId values present in input.`,
  meta: `Return ONLY this schema: { "summary": string, "keyInsights": string[], "synthesisStrength": object, "fieldMaturity": string }.
Do not include patterns, contradictions, or gaps.
Base all statements on the provided findings.`,
} as const

type AnalysisPartName = keyof typeof PART_INSTRUCTIONS

type PromptPackingMetadata = {
  packedFindings: number
  droppedFindings: number
  truncatedFields: number
}

type PromptBuildResult = {
  prompt: string
  packing: PromptPackingMetadata
}

type AnalysisGenerationResult = {
  object: AnalysisObject
  packing: PromptPackingMetadata
}

function getErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function isLikelyLengthOrParseTruncation(error: unknown): boolean {
  const text = getErrorText(error).toLowerCase()
  return (
    text.includes('finishreason') && text.includes('length')
  ) || text.includes('unterminated string') ||
    text.includes('unexpected end') ||
    text.includes('unexpected end of json') ||
    text.includes('expected \',\' or \'}\'') ||
    text.includes('unexpected non-whitespace character after json') ||
    text.includes('json parsing failed') ||
    text.includes('no object generated')
}

function isLikelyTimeoutOrAbort(error: unknown): boolean {
  const text = getErrorText(error).toLowerCase()
  return (
    text.includes('aborterror') ||
    text.includes('aborted') ||
    text.includes('timeout') ||
    text.includes('timed out')
  )
}

function isRateLimitError(error: unknown): boolean {
  const text = getErrorText(error).toLowerCase()
  return (
    text.includes('429') ||
    text.includes('rate limit') ||
    text.includes('too many requests')
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function generateObjectWithRateLimitRetry<T>(
  execute: () => Promise<{ object: T }>,
  scope: string,
  partName: AnalysisPartName
): Promise<{ object: T }> {
  const RATE_LIMIT_RETRY_COUNT = 3
  const RATE_LIMIT_BASE_BACKOFF_MS = 30000
  let lastError: unknown = null

  for (let rateLimitRetry = 0; rateLimitRetry <= RATE_LIMIT_RETRY_COUNT; rateLimitRetry++) {
    try {
      return await execute()
    } catch (error) {
      lastError = error
      const hasRateLimitRetryRemaining = rateLimitRetry < RATE_LIMIT_RETRY_COUNT
      if (isRateLimitError(error) && hasRateLimitRetryRemaining) {
        const backoffMs = RATE_LIMIT_BASE_BACKOFF_MS * (2 ** rateLimitRetry)
        console.warn(
          `⚠️ ${scope} (${partName}) hit rate limit (429); retrying in ${backoffMs}ms (${rateLimitRetry + 1}/${RATE_LIMIT_RETRY_COUNT})`
        )
        await sleep(backoffMs)
        continue
      }
      throw error
    }
  }

  throw lastError || new Error(`${scope} (${partName}) failed after rate limit retries`)
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / PROMPT_TOKEN_CHAR_RATIO)
}

function normalizePromptText(value: string | undefined): string {
  if (!value) return ''
  return value.replace(/\s+/g, ' ').trim()
}

function scoreFindingForPacking(finding: FindingWithPaper): number {
  return (
    finding.confidence * 4 +
    (finding.value ? 1 : 0) +
    (finding.valueType ? 0.5 : 0) +
    (finding.context ? 0.5 : 0) +
    (finding.evidence ? 0.5 : 0)
  )
}

function formatFindingForPrompt(finding: FindingWithPaper): string {
  const pieces = [
    `paperId=${finding.paperId}`,
    `findingId=${finding.id}`,
    `claim="${normalizePromptText(finding.claim)}"`,
    `evidence="${normalizePromptText(finding.evidence)}"`,
  ]

  const value = normalizePromptText(finding.value)
  const valueType = normalizePromptText(finding.valueType)
  const direction = normalizePromptText(finding.direction)
  const context = normalizePromptText(finding.context)
  const evidenceType = normalizePromptText((finding as { evidenceType?: string }).evidenceType)

  if (value) {
    pieces.push(`value="${value}"`)
    if (valueType) pieces.push(`valueType=${valueType}`)
  }
  if (direction) pieces.push(`direction=${direction}`)
  if (context) pieces.push(`context="${context}"`)
  if (evidenceType) pieces.push(`evidenceType=${evidenceType}`)

  return `- ${pieces.join(' | ')}`
}

function formatCompactFindingForPrompt(finding: FindingWithPaper): string {
  const compact = (value: string | undefined, maxChars: number) => {
    const text = normalizePromptText(value)
    return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
  }

  return [
    `- paperId=${finding.paperId}`,
    `findingId=${finding.id}`,
    `claim="${compact(finding.claim, 420)}"`,
    `evidence="${compact(finding.evidence, 420)}"`,
  ].join(' | ')
}

function packFindingsForPrompt(findings: FindingWithPaper[]): {
  lines: string[]
  findingIds: string[]
  packed: number
  dropped: number
  truncatedFields: number
} {
  const ranked = findings
    .map((finding, index) => ({ finding, index, score: scoreFindingForPacking(finding) }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))

  const packed: Array<{ index: number; line: string; findingId: string }> = []
  let dropped = 0
  let usedTokens = 0

  for (const candidate of ranked) {
    const line = formatFindingForPrompt(candidate.finding)
    const tokens = estimateTokens(line) + 2
    if (usedTokens + tokens <= PROMPT_INPUT_TOKEN_BUDGET) {
      packed.push({ index: candidate.index, line, findingId: candidate.finding.id })
      usedTokens += tokens
      continue
    }
    if (packed.length === 0) {
      const compactLine = formatCompactFindingForPrompt(candidate.finding)
      const compactTokens = estimateTokens(compactLine) + 2
      if (usedTokens + compactTokens <= PROMPT_INPUT_TOKEN_BUDGET) {
        packed.push({ index: candidate.index, line: compactLine, findingId: candidate.finding.id })
        usedTokens += compactTokens
        continue
      }
    }
    dropped += 1
  }

  packed.sort((a, b) => a.index - b.index)

  return {
    lines: packed.map(item => item.line),
    findingIds: packed.map(item => item.findingId),
    packed: packed.length,
    dropped,
    truncatedFields: 0,
  }
}

function getTokenBudgetsForPart(): number[] {
  return PART_OUTPUT_TOKEN_BUDGETS
}

function getTokenBudgetsForFull(): number[] {
  return FULL_OUTPUT_TOKEN_BUDGETS
}

async function generateAnalysisPartWithRetry<T>(
  schema: z.ZodType<T>,
  basePrompt: string,
  _findingsCount: number,
  scope: string,
  partName: AnalysisPartName,
  signal?: AbortSignal
): Promise<T> {
  const prompt = `${basePrompt}

Part-specific output requirement:
${PART_INSTRUCTIONS[partName]}

Only return JSON matching the provided schema.`
  const tokenBudgets = getTokenBudgetsForPart()
  let lastError: unknown = null

  for (let attempt = 0; attempt < tokenBudgets.length; attempt++) {
    if (signal?.aborted) {
      throw new Error('Run was cancelled')
    }
    const maxOutputTokens = tokenBudgets[attempt]
    try {
      const { object } = await generateObjectWithRateLimitRetry(
        async () => {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), ANALYSIS_PART_TIMEOUT_MS)
          const onAbort = () => controller.abort()
          if (signal) {
            if (signal.aborted) {
              controller.abort()
            } else {
              signal.addEventListener('abort', onAbort, { once: true })
            }
          }
          try {
            return await generateObject({
              model: getAnalysisLanguageModel(),
              schema,
              system: SYSTEM_PROMPT,
              prompt,
              temperature: 0.2,
              maxOutputTokens,
              abortSignal: controller.signal,
            })
          } finally {
            clearTimeout(timeout)
            if (signal) {
              signal.removeEventListener('abort', onAbort)
            }
          }
        },
        scope,
        partName
      )
      return object
    } catch (error) {
      if (signal?.aborted) {
        throw new Error('Run was cancelled')
      }
      lastError = error
      const canRetryReason =
        isLikelyLengthOrParseTruncation(error) ||
        isLikelyTimeoutOrAbort(error)
      const canRetry = attempt < tokenBudgets.length - 1 && canRetryReason
      if (canRetry) {
        if (isLikelyTimeoutOrAbort(error)) {
          console.warn(
            `⚠️ ${scope} (${partName}) timed out at ${ANALYSIS_PART_TIMEOUT_MS}ms; retrying with ${tokenBudgets[attempt + 1]} tokens`
          )
        } else {
          console.warn(
            `⚠️ ${scope} (${partName}) produced truncated/invalid JSON at ${maxOutputTokens} tokens; retrying with ${tokenBudgets[attempt + 1]} tokens`
          )
        }
        continue
      }
      throw error
    }
  }

  throw lastError || new Error(`${scope} (${partName}) failed: unknown error`)
}

function pickHighestPriority(
  left: 'high' | 'medium' | 'low',
  right: 'high' | 'medium' | 'low'
): 'high' | 'medium' | 'low' {
  const rank: Record<'high' | 'medium' | 'low', number> = { high: 3, medium: 2, low: 1 }
  return rank[right] > rank[left] ? right : left
}

function pickHighestSeverity(
  left: 'major' | 'moderate' | 'minor',
  right: 'major' | 'moderate' | 'minor'
): 'major' | 'moderate' | 'minor' {
  const rank: Record<'major' | 'moderate' | 'minor', number> = { major: 3, moderate: 2, minor: 1 }
  return rank[right] > rank[left] ? right : left
}

function pickStrongerEvidenceStrength(
  left: 'strong' | 'moderate' | 'weak',
  right: 'strong' | 'moderate' | 'weak'
): 'strong' | 'moderate' | 'weak' {
  const rank: Record<'strong' | 'moderate' | 'weak', number> = { strong: 3, moderate: 2, weak: 1 }
  return rank[right] > rank[left] ? right : left
}

function mergeEvidenceStrength(
  left: 'strong' | 'moderate' | 'weak' | undefined,
  right: 'strong' | 'moderate' | 'weak' | undefined
): 'strong' | 'moderate' | 'weak' | undefined {
  if (!left) return right
  if (!right) return left
  return pickStrongerEvidenceStrength(left, right)
}

function mergeGapPriority(
  left: 'high' | 'medium' | 'low' | undefined,
  right: 'high' | 'medium' | 'low' | undefined
): 'high' | 'medium' | 'low' | undefined {
  if (!left) return right
  if (!right) return left
  return pickHighestPriority(left, right)
}

function normalizeKey(value: string | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function reconcileAnalysisParts(object: AnalysisObject): AnalysisObject {
  const patterns = object.patterns.map((pattern) => ({
    ...pattern,
    supportingPaperIds: dedupeStrings(pattern.supportingPaperIds),
    supportingFindingIds: dedupeStrings(pattern.supportingFindingIds),
  }))

  const contradictionMap = new Map<string, AnalysisObject['contradictions'][number]>()
  for (const contradiction of object.contradictions) {
    const sidesKey = contradiction.sides
      .map(side => dedupeStrings(side.paperIds).sort().join(','))
      .sort()
      .join('|')
    const key = `${contradiction.contradictionType}|${normalizeKey(contradiction.description)}|${sidesKey}`
    const existing = contradictionMap.get(key)
    if (!existing) {
      contradictionMap.set(key, {
        ...contradiction,
        sides: contradiction.sides.map(side => ({
          ...side,
          paperIds: dedupeStrings(side.paperIds),
          findingIds: dedupeStrings(side.findingIds),
        })),
      })
      continue
    }

    const mergedSides = [...existing.sides]
    for (const side of contradiction.sides) {
      const normalizedPosition = normalizeKey(side.position)
      const sideIndex = mergedSides.findIndex(s => normalizeKey(s.position) === normalizedPosition)
      if (sideIndex === -1) {
        mergedSides.push({
          ...side,
          paperIds: dedupeStrings(side.paperIds),
          findingIds: dedupeStrings(side.findingIds),
        })
        continue
      }
      const prior = mergedSides[sideIndex]
      mergedSides[sideIndex] = {
        ...prior,
        paperIds: dedupeStrings([...prior.paperIds, ...side.paperIds]),
        findingIds: dedupeStrings([...prior.findingIds, ...side.findingIds]),
        evidenceStrength: pickStrongerEvidenceStrength(prior.evidenceStrength, side.evidenceStrength),
      }
    }

    contradictionMap.set(key, {
      ...existing,
      sides: mergedSides,
      confidence: Math.max(existing.confidence, contradiction.confidence),
      severity: pickHighestSeverity(existing.severity, contradiction.severity),
      possibleExplanation:
        (contradiction.possibleExplanation || '').length > (existing.possibleExplanation || '').length
          ? contradiction.possibleExplanation
          : existing.possibleExplanation,
      resolutionSuggestion:
        (contradiction.resolutionSuggestion || '').length > (existing.resolutionSuggestion || '').length
          ? contradiction.resolutionSuggestion
          : existing.resolutionSuggestion,
    })
  }

  const gapMap = new Map<string, AnalysisObject['gaps'][number]>()
  for (const gap of object.gaps) {
    const key = `${gap.type}|${normalizeKey(gap.description)}`
    const existing = gapMap.get(key)
    if (!existing) {
      gapMap.set(key, {
        ...gap,
        suggestedByPaperIds: dedupeStrings(gap.suggestedByPaperIds),
      })
      continue
    }
    gapMap.set(key, {
      ...existing,
      suggestedByPaperIds: dedupeStrings([...existing.suggestedByPaperIds, ...gap.suggestedByPaperIds]),
      confidence: Math.max(existing.confidence, gap.confidence),
      priority: pickHighestPriority(existing.priority, gap.priority),
      relevance: gap.relevance.length > existing.relevance.length ? gap.relevance : existing.relevance,
      suggestedResearchQuestion:
        gap.suggestedResearchQuestion.length > existing.suggestedResearchQuestion.length
          ? gap.suggestedResearchQuestion
          : existing.suggestedResearchQuestion,
    })
  }

  return {
    ...object,
    patterns,
    contradictions: [...contradictionMap.values()],
    gaps: [...gapMap.values()],
    keyInsights: dedupeStrings(object.keyInsights).slice(0, 5),
    summary: normalizePromptText(object.summary),
  }
}

async function generateAnalysisFullWithRetry(
  basePrompt: string,
  _findingsCount: number,
  scope: string,
  signal?: AbortSignal
): Promise<AnalysisObject> {
  const prompt = `${basePrompt}

Return ONLY JSON matching the full schema with keys:
patterns, contradictions, gaps, summary, keyInsights, synthesisStrength, fieldMaturity.`
  const tokenBudgets = getTokenBudgetsForFull()
  let lastError: unknown = null

  for (let attempt = 0; attempt < tokenBudgets.length; attempt++) {
    if (signal?.aborted) {
      throw new Error('Run was cancelled')
    }
    const maxOutputTokens = tokenBudgets[attempt]
    try {
      const { object } = await generateObjectWithRateLimitRetry(
        async () => {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), ANALYSIS_PART_TIMEOUT_MS)
          const onAbort = () => controller.abort()
          if (signal) {
            if (signal.aborted) {
              controller.abort()
            } else {
              signal.addEventListener('abort', onAbort, { once: true })
            }
          }
          try {
            return await generateObject({
              model: getAnalysisLanguageModel(),
              schema: _AnalysisSchema,
              system: SYSTEM_PROMPT,
              prompt,
              temperature: 0.2,
              maxOutputTokens,
              abortSignal: controller.signal,
            })
          } finally {
            clearTimeout(timeout)
            if (signal) {
              signal.removeEventListener('abort', onAbort)
            }
          }
        },
        scope,
        'meta'
      )
      return object
    } catch (error) {
      if (signal?.aborted) {
        throw new Error('Run was cancelled')
      }
      lastError = error
      const canRetry =
        attempt < tokenBudgets.length - 1 &&
        (isLikelyLengthOrParseTruncation(error) || isLikelyTimeoutOrAbort(error))
      if (canRetry) {
        console.warn(
          `⚠️ ${scope} (full) failed at ${maxOutputTokens} tokens; retrying with ${tokenBudgets[attempt + 1]} tokens`
        )
        continue
      }
      throw error
    }
  }

  throw lastError || new Error(`${scope} (full) failed: unknown error`)
}

async function generateAnalysisObjectWithRetry(
  findings: FindingWithPaper[],
  topic: string | undefined,
  scope: string,
  signal?: AbortSignal
): Promise<AnalysisGenerationResult> {
  if (signal?.aborted) {
    throw new Error('Run was cancelled')
  }
  const builtPrompt = buildPrompt(findings, topic)

  try {
    const object = await generateAnalysisFullWithRetry(
      builtPrompt.prompt,
      findings.length,
      scope,
      signal
    )
    return {
      object: reconcileAnalysisParts(object),
      packing: builtPrompt.packing,
    }
  } catch (error) {
    if (signal?.aborted) {
      throw new Error('Run was cancelled')
    }
    const fallbackAllowed =
      isLikelyLengthOrParseTruncation(error) ||
      isLikelyTimeoutOrAbort(error)
    if (!fallbackAllowed) {
      throw error
    }
    console.warn(`⚠️ ${scope} full-schema generation failed; falling back to split generation`)
  }

  const [patternsPart, contradictionsPart, gapsPart, metaPart] = await Promise.all([
    generateAnalysisPartWithRetry(PatternsOnlySchema, builtPrompt.prompt, findings.length, scope, 'patterns', signal),
    generateAnalysisPartWithRetry(ContradictionsOnlySchema, builtPrompt.prompt, findings.length, scope, 'contradictions', signal),
    generateAnalysisPartWithRetry(GapsOnlySchema, builtPrompt.prompt, findings.length, scope, 'gaps', signal),
    generateAnalysisPartWithRetry(AnalysisMetaSchema, builtPrompt.prompt, findings.length, scope, 'meta', signal),
  ])

  return {
    object: reconcileAnalysisParts({
      patterns: patternsPart.patterns,
      contradictions: contradictionsPart.contradictions,
      gaps: gapsPart.gaps,
      summary: metaPart.summary,
      keyInsights: metaPart.keyInsights,
      synthesisStrength: metaPart.synthesisStrength,
      fieldMaturity: metaPart.fieldMaturity,
    }),
    packing: builtPrompt.packing,
  }
}

function buildPrompt(findings: FindingWithPaper[], topic?: string): PromptBuildResult {
  const uniquePapers = new Set(findings.map(f => f.paperId)).size
  const packed = packFindingsForPrompt(findings)
  const packedFindingIds = new Set(packed.findingIds)

  const packedPaperRegistry = Array.from(
    new Map(
      findings
        .filter(f => packedFindingIds.has(f.id))
        .map(f => [f.paperId, normalizePromptText(f.paperTitle)])
    ).entries()
  )
    .map(([paperId, paperTitle]) => `- ${paperId}: ${paperTitle}`)
    .join('\n')

  const topicLine = topic ? `Topic: ${normalizePromptText(topic)}\n` : ''
  const paperRegistry = packedPaperRegistry || '- none'
  const findingsText = packed.lines.join('\n') || '- none'

  return {
    prompt: `Analyze findings across papers.
${topicLine}Corpus stats:
- totalFindings=${findings.length}
- totalPapers=${uniquePapers}
- packedFindings=${packed.packed}
- droppedFindings=${packed.dropped}
- truncatedFields=${packed.truncatedFields}

Paper registry (for packed findings):
${paperRegistry}

Findings:
${findingsText}

Tasks:
1) Identify patterns with support counts/percentages when denominator scope is explicit, and include value ranges when available.
2) Identify contradictions and classify each as direct, magnitude, conditional, or methodological.
3) Identify concrete gaps and include a concrete research question per gap.
4) Write overall summary + up to 5 key insights.
5) Assess synthesis quality and field maturity.

Use paperId/findingId values exactly as provided in input.`,
    packing: {
      packedFindings: packed.packed,
      droppedFindings: packed.dropped,
      truncatedFields: packed.truncatedFields,
    },
  }
}

function toPaperSupport(finding: FindingWithPaper): PaperSupport {
  return {
    paperId: finding.paperId,
    paperTitle: finding.paperTitle,
    findingId: finding.id,
    claim: finding.claim,
    value: finding.value,
    valueType: finding.valueType,
    evidence: finding.evidence,
    confidence: finding.confidence,
  }
}

function dedupePaperSupports(papers: PaperSupport[]): PaperSupport[] {
  const seen = new Set<string>()
  const deduped: PaperSupport[] = []
  for (const paper of papers) {
    const key = `${paper.paperId}::${paper.findingId}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(paper)
  }
  return deduped
}

function countUniqueSupportPapers(papers: PaperSupport[]): number {
  return new Set(papers.map(p => p.paperId)).size
}

function mergeLimitations(
  original: string | null | undefined,
  appended: string | undefined
): string | undefined {
  const parts = [original || '', appended || '']
    .map(part => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return undefined
  return dedupeStrings(parts).join(' ')
}

function buildPatternFromAnalysisPattern(
  pattern: AnalysisObject['patterns'][number],
  findingsMap: Map<string, FindingWithPaper>,
  totalPapers: number
): Pattern {
  const mappedSupports = dedupePaperSupports(
    dedupeStrings(pattern.supportingFindingIds)
      .map(fid => findingsMap.get(fid))
      .filter((finding): finding is FindingWithPaper => finding !== undefined)
      .map(toPaperSupport)
  )
  const mappedPaperIds = new Set(mappedSupports.map(support => support.paperId))
  const unresolvedPaperIds = dedupeStrings(pattern.supportingPaperIds)
    .filter(paperId => !mappedPaperIds.has(paperId))
  const supportCount = countUniqueSupportPapers(mappedSupports)

  const unresolvedLimitation =
    unresolvedPaperIds.length > 0
      ? `Dropped ${unresolvedPaperIds.length} unresolved supporting paper reference(s): ${unresolvedPaperIds.join(', ')}.`
      : undefined

  return {
    id: uuidv4(),
    claim: pattern.claim,
    summary: pattern.summary,
    support: {
      papers: mappedSupports,
      count: supportCount,
      total: totalPapers,
    },
    direction: pattern.direction || undefined,
    consistency: pattern.consistency,
    strength: pattern.strength,
    values: pattern.valuesSummary ? {
      summary: pattern.valuesSummary,
      individual: dedupeStrings(
        mappedSupports
          .map(paper => paper.value)
          .filter((value): value is string => Boolean(value))
      ),
      range: pattern.valueRange ? {
        min: pattern.valueRange.min || undefined,
        max: pattern.valueRange.max || undefined,
        median: pattern.valueRange.median || undefined,
        heterogeneity: pattern.valueRange.heterogeneity || undefined,
      } : undefined,
    } : undefined,
    confidence: pattern.confidence,
    limitations: mergeLimitations(pattern.limitations, unresolvedLimitation),
  }
}

function mapFindingIdsToPaperSupport(
  findingIds: string[],
  findingsMap: Map<string, FindingWithPaper>
): PaperSupport[] {
  return dedupePaperSupports(
    dedupeStrings(findingIds)
      .map(fid => findingsMap.get(fid))
      .filter((finding): finding is FindingWithPaper => finding !== undefined)
      .map(toPaperSupport)
  )
}

// =============================================================================
// Main Analysis Function
// =============================================================================

/**
 * Analyze findings across papers to identify patterns, contradictions, and gaps
 * 
 * Automatically uses batched analysis for large finding sets (>200) to prevent
 * token overflow and improve pattern detection quality.
 */
export async function analyzeFindings(input: AnalysisInput): Promise<AnalysisResult> {
  const startTime = Date.now()
  
  const { projectId, findings, topic, signal } = input
  if (signal?.aborted) {
    throw new Error('Run was cancelled')
  }
  
  if (findings.length === 0) {
    return {
      id: uuidv4(),
      projectId,
      analyzedPapers: 0,
      totalFindings: 0,
      patterns: [],
      contradictions: [],
      gaps: [],
      summary: 'No findings to analyze.',
      keyInsights: [],
      analyzedAt: new Date(),
      analysisTimeMs: Date.now() - startTime,
      modelUsed: 'gpt-4.1-mini',
      findingsHash: hashFindings(findings),
      completeness: {
        status: 'complete',
        totalBatches: 0,
        failedBatches: 0,
      },
      diagnostics: {
        packedFindings: 0,
        droppedFindings: 0,
        truncatedFields: 0,
        integrityRepairApplied: false,
      },
    }
  }
  
  // Cap findings for performance - sample most confident/main findings if over limit
  let analysisFindings = findings
  if (findings.length > MAX_FINDINGS_FOR_ANALYSIS) {
    console.log(`\n📊 Capping findings from ${findings.length} to ${MAX_FINDINGS_FOR_ANALYSIS} for analysis...`)
    // Prioritize: main findings first, then by confidence
    analysisFindings = [...findings]
      .sort((a, b) => {
        // Main findings first
        if (a.isMainFinding && !b.isMainFinding) return -1
        if (!a.isMainFinding && b.isMainFinding) return 1
        // Then by confidence
        return (b.confidence || 0) - (a.confidence || 0)
      })
      .slice(0, MAX_FINDINGS_FOR_ANALYSIS)
  }
  
  const uniquePapers = new Set(analysisFindings.map(f => f.paperId)).size
  
  // Use batched analysis for large finding sets to prevent token overflow
  if (analysisFindings.length > BATCH_THRESHOLD) {
    console.log(`\n📊 Finding count (${analysisFindings.length}) exceeds threshold (${BATCH_THRESHOLD}), using batched analysis...`)
    return analyzeFindingsBatched(projectId, analysisFindings, topic, signal)
  }
  
  console.log(`\n🔍 Analyzing ${analysisFindings.length} findings from ${uniquePapers} papers...`)
  
  try {
    const generated = await generateAnalysisObjectWithRetry(analysisFindings, topic, 'Cross-document analysis', signal)
    const object = generated.object
    if (generated.packing.droppedFindings > 0) {
      console.warn(
        `⚠️ Cross-document prompt packing dropped ${generated.packing.droppedFindings} finding(s) ` +
        `(${generated.packing.packedFindings} packed, truncatedFields=${generated.packing.truncatedFields})`
      )
    }
    
    // Build lookup maps for enriching results
    const findingsMap = new Map(analysisFindings.map(f => [f.id, f]))
    
    // Transform patterns with full paper support details
    const patterns: Pattern[] = object.patterns.map(pattern =>
      buildPatternFromAnalysisPattern(pattern, findingsMap, uniquePapers)
    )
    
    // Transform contradictions
    const contradictions: Contradiction[] = object.contradictions.map(c => ({
      id: uuidv4(),
      description: c.description,
      contradictionType: c.contradictionType,
      sides: c.sides.map(s => ({
        position: s.position,
        papers: mapFindingIdsToPaperSupport(s.findingIds, findingsMap),
        evidenceStrength: s.evidenceStrength
      })),
      possibleExplanation: c.possibleExplanation || undefined,
      resolutionSuggestion: c.resolutionSuggestion || undefined,
      severity: c.severity,
      confidence: c.confidence
    }))
    
    // Transform gaps
    const gaps: Gap[] = object.gaps.map(g => ({
      id: uuidv4(),
      description: g.description,
      type: g.type,
      relevance: g.relevance,
      suggestedResearchQuestion: g.suggestedResearchQuestion,
      suggestedBy: g.suggestedByPaperIds,
      priority: g.priority,
      confidence: g.confidence
    }))
    
    const analysisTimeMs = Date.now() - startTime
    
    console.log(`✅ Analysis complete in ${analysisTimeMs}ms`)
    console.log(`   📊 Found ${patterns.length} patterns`)
    console.log(`   ⚡ Found ${contradictions.length} contradictions`)
    console.log(`   🔎 Found ${gaps.length} gaps`)

    let result: AnalysisResult = {
      id: uuidv4(),
      projectId,
      analyzedPapers: uniquePapers,
      totalFindings: findings.length,
      patterns,
      contradictions,
      gaps,
      summary: object.summary,
      keyInsights: object.keyInsights,
      synthesisStrength: object.synthesisStrength ? {
        overallConfidence: object.synthesisStrength.overallConfidence,
        evidenceBase: object.synthesisStrength.evidenceBase,
        methodologicalDiversity: object.synthesisStrength.methodologicalDiversity,
        geographicDiversity: object.synthesisStrength.geographicDiversity,
        temporalSpread: object.synthesisStrength.temporalSpread || undefined
      } : undefined,
      fieldMaturity: object.fieldMaturity,
      analyzedAt: new Date(),
      analysisTimeMs,
      modelUsed: 'gpt-4o',
      findingsHash: hashFindings(findings),
      completeness: {
        status: 'complete',
        totalBatches: 1,
        failedBatches: 0,
      },
      diagnostics: {
        packedFindings: generated.packing.packedFindings,
        droppedFindings: generated.packing.droppedFindings,
        truncatedFields: generated.packing.truncatedFields,
      },
    }

    result = enforceAnalysisIntegrity(result, findings)
    return result
    
  } catch (error) {
    console.error('❌ Analysis failed:', error)
    throw error
  }
}

// =============================================================================
// Batched Analysis for Large Finding Sets
// =============================================================================

/**
 * Maximum findings per batch to avoid token overflow
 * ~100 findings × ~200 tokens = ~20k tokens, leaving room for response
 */
const MAX_FINDINGS_PER_BATCH = 100

/**
 * Threshold above which we use batched analysis
 * Lowered to 80 to reduce per-batch processing time
 */
const BATCH_THRESHOLD = 80

/**
 * Maximum findings to analyze (cap for performance)
 * Beyond this, we sample the most relevant findings
 */
const MAX_FINDINGS_FOR_ANALYSIS = 150

type TransformedBatchResult = {
  patterns: Pattern[]
  contradictions: Contradiction[]
  gaps: Gap[]
  summary: string
  keyInsights: string[]
  diagnostics?: PromptPackingMetadata
}

function buildBatchesByPaper(findings: FindingWithPaper[]): FindingWithPaper[][] {
  const byPaper = new Map<string, FindingWithPaper[]>()
  for (const finding of findings) {
    const paperFindings = byPaper.get(finding.paperId) || []
    paperFindings.push(finding)
    byPaper.set(finding.paperId, paperFindings)
  }

  const batches: FindingWithPaper[][] = []
  let currentBatch: FindingWithPaper[] = []

  for (const paperFindings of byPaper.values()) {
    if (currentBatch.length + paperFindings.length > MAX_FINDINGS_PER_BATCH && currentBatch.length > 0) {
      batches.push(currentBatch)
      currentBatch = []
    }
    currentBatch.push(...paperFindings)
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }
  return batches
}

function transformBatchObject(
  object: AnalysisObject,
  batch: FindingWithPaper[],
  batchPapers: number,
  diagnostics?: PromptPackingMetadata
): TransformedBatchResult {
  const findingsMap = new Map(batch.map(f => [f.id, f]))
  const patterns: Pattern[] = object.patterns.map(pattern =>
    buildPatternFromAnalysisPattern(pattern, findingsMap, batchPapers)
  )

  const contradictions: Contradiction[] = object.contradictions.map(c => ({
    id: uuidv4(),
    description: c.description,
    contradictionType: c.contradictionType,
    sides: c.sides.map(s => ({
      position: s.position,
      papers: mapFindingIdsToPaperSupport(s.findingIds, findingsMap),
      evidenceStrength: s.evidenceStrength
    })),
    possibleExplanation: c.possibleExplanation || undefined,
    resolutionSuggestion: c.resolutionSuggestion || undefined,
    severity: c.severity,
    confidence: c.confidence
  }))

  const gaps: Gap[] = object.gaps.map(g => ({
    id: uuidv4(),
    description: g.description,
    type: g.type,
    relevance: g.relevance,
    suggestedResearchQuestion: g.suggestedResearchQuestion,
    suggestedBy: g.suggestedByPaperIds,
    priority: g.priority,
    confidence: g.confidence
  }))

  return {
    patterns,
    contradictions,
    gaps,
    summary: object.summary,
    keyInsights: object.keyInsights,
    diagnostics,
  }
}

/**
 * Analyze findings in batches and merge results
 * Used when finding count exceeds BATCH_THRESHOLD to prevent token overflow
 */
async function analyzeFindingsBatched(
  projectId: string,
  findings: FindingWithPaper[],
  topic?: string,
  signal?: AbortSignal
): Promise<AnalysisResult> {
  const startTime = Date.now()
  const uniquePapers = new Set(findings.map(f => f.paperId)).size
  
  const batches = buildBatchesByPaper(findings)
  
  console.log(`\n🔍 Analyzing ${findings.length} findings in ${batches.length} batches (parallel)...`)
  
  // Analyze batches in parallel for speed
  const batchPromises = batches.map(async (batch, i) => {
    if (signal?.aborted) {
      throw new Error('Run was cancelled')
    }

    const batchPapers = new Set(batch.map(f => f.paperId)).size
    console.log(`   📦 Batch ${i + 1}/${batches.length}: ${batch.length} findings from ${batchPapers} papers`)

    try {
      const generated = await generateAnalysisObjectWithRetry(batch, topic, `Batch ${i + 1}/${batches.length}`, signal)
      const transformed = transformBatchObject(generated.object, batch, batchPapers, generated.packing)
      console.log(
        `   ✅ Batch ${i + 1}: ${transformed.patterns.length} patterns, ` +
        `${transformed.contradictions.length} contradictions, ${transformed.gaps.length} gaps`
      )
      return { success: true as const, result: transformed, index: i }
    } catch (error) {
      console.error(`   ❌ Batch ${i + 1} failed:`, error)
      if (STRICT_BATCH_MODE) {
        throw new Error(
          `Batched analysis failed in strict mode at batch ${i + 1}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
      return { success: false as const, index: i }
    }
  })

  const settledResults = await Promise.all(batchPromises)
  
  const batchResults: TransformedBatchResult[] = []
  const failedBatchIndexes: number[] = []
  
  for (const result of settledResults) {
    if (result.success) {
      batchResults.push(result.result)
    } else {
      failedBatchIndexes.push(result.index)
    }
  }

  if (batchResults.length === 0) {
    throw new Error('Batched analysis failed: no successful batch outputs were produced')
  }

  const failedBatchList = [...failedBatchIndexes].sort((a, b) => a - b)
  if (failedBatchList.length > 0 && !STRICT_BATCH_MODE) {
    console.warn(
      `⚠️ Batched analysis returned partial output: ${failedBatchList.length}/${batches.length} batch(es) failed`
    )
  }
  
  // Merge results from all batches
  const mergedResult = mergeBatchResults(batchResults, uniquePapers)
  
  const analysisTimeMs = Date.now() - startTime
  
  console.log(`✅ Batched analysis complete in ${analysisTimeMs}ms`)
  console.log(`   📊 Found ${mergedResult.patterns.length} patterns (merged)`)
  console.log(`   ⚡ Found ${mergedResult.contradictions.length} contradictions`)
  console.log(`   🔎 Found ${mergedResult.gaps.length} gaps`)

  const aggregatedPacking = batchResults.reduce(
    (acc, result) => {
      acc.packedFindings += result.diagnostics?.packedFindings || 0
      acc.droppedFindings += result.diagnostics?.droppedFindings || 0
      acc.truncatedFields += result.diagnostics?.truncatedFields || 0
      return acc
    },
    { packedFindings: 0, droppedFindings: 0, truncatedFields: 0 }
  )

  let result: AnalysisResult = {
    id: uuidv4(),
    projectId,
    analyzedPapers: uniquePapers,
    totalFindings: findings.length,
    patterns: mergedResult.patterns,
    contradictions: mergedResult.contradictions,
    gaps: mergedResult.gaps,
    summary: mergedResult.summary,
    keyInsights: mergedResult.keyInsights,
    analyzedAt: new Date(),
    analysisTimeMs,
    modelUsed: 'gpt-4o',
    findingsHash: hashFindings(findings),
    completeness: {
      status: failedBatchList.length > 0 ? 'partial' : 'complete',
      totalBatches: batches.length,
      failedBatches: failedBatchList.length,
      failedBatchIndexes: failedBatchList,
    },
    diagnostics: {
      packedFindings: aggregatedPacking.packedFindings,
      droppedFindings: aggregatedPacking.droppedFindings,
      truncatedFields: aggregatedPacking.truncatedFields,
    },
  }

  result = enforceAnalysisIntegrity(result, findings)
  return result
}

/**
 * Merge results from multiple batch analyses
 * - Groups patterns using paper overlap + normalized claim features
 * - Reconciles contradictions and gaps globally with deterministic dedupe keys
 * - Combines summaries/insights with deterministic de-duplication
 */
function getPatternGroupKey(pattern: Pattern): string {
  const claim = normalizeKey(pattern.claim)
  const direction = normalizeKey(pattern.direction || '')
  return `${claim}|${direction}`
}

function deriveStrengthFromSupport(count: number, total: number): 'strong' | 'moderate' | 'emerging' {
  const ratio = total > 0 ? count / total : 0
  if (count >= 4 || ratio >= 0.5) return 'strong'
  if (count >= 3 || ratio >= 0.3) return 'moderate'
  return 'emerging'
}

function mergePatternGroup(group: Pattern[], totalPapers: number): Pattern {
  const sorted = [...group].sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence
    return b.support.count - a.support.count
  })
  const representative = sorted[0]
  const mergedSupports = dedupePaperSupports(
    group.flatMap(pattern => pattern.support.papers)
  )
  const supportCount = countUniqueSupportPapers(mergedSupports)
  const mergedValues = dedupeStrings(
    group.flatMap(pattern => pattern.values?.individual || [])
  )
  const mergedLimitations = dedupeStrings(
    group
      .map(pattern => pattern.limitations || '')
      .filter(Boolean)
  )

  return {
    ...representative,
    id: uuidv4(),
    support: {
      papers: mergedSupports,
      count: supportCount,
      total: totalPapers,
    },
    strength: deriveStrengthFromSupport(supportCount, totalPapers),
    confidence: Math.max(...group.map(pattern => pattern.confidence)),
    values: representative.values ? {
      ...representative.values,
      individual: mergedValues,
      summary:
        group
          .map(pattern => pattern.values?.summary || '')
          .sort((a, b) => b.length - a.length)[0] || representative.values.summary,
    } : (mergedValues.length > 0 ? {
      summary: representative.summary,
      individual: mergedValues,
    } : undefined),
    limitations: mergedLimitations.length > 0 ? mergedLimitations.join(' ') : representative.limitations,
  }
}

function mergeContradictionsDeterministically(contradictions: Contradiction[]): Contradiction[] {
  const merged = new Map<string, Contradiction>()
  for (const contradiction of contradictions) {
    const sidePaperSets = contradiction.sides
      .map(side => dedupeStrings(side.papers.map(paper => paper.paperId)).sort().join(','))
      .sort()
      .join('|')
    const key = `${contradiction.contradictionType}|${normalizeKey(contradiction.description)}|${sidePaperSets}`
    const existing = merged.get(key)

    if (!existing) {
      merged.set(key, {
        ...contradiction,
        id: uuidv4(),
        sides: contradiction.sides.map(side => ({
          ...side,
          papers: dedupePaperSupports(side.papers),
        })),
      })
      continue
    }

    const sides = [...existing.sides]
    for (const side of contradiction.sides) {
      const sideKey = normalizeKey(side.position)
      const idx = sides.findIndex(existingSide => normalizeKey(existingSide.position) === sideKey)
      if (idx < 0) {
        sides.push({
          ...side,
          papers: dedupePaperSupports(side.papers),
        })
        continue
      }

      const prior = sides[idx]
      sides[idx] = {
        ...prior,
        papers: dedupePaperSupports([...prior.papers, ...side.papers]),
        evidenceStrength: mergeEvidenceStrength(prior.evidenceStrength, side.evidenceStrength),
      }
    }

    merged.set(key, {
      ...existing,
      sides,
      confidence: Math.max(existing.confidence, contradiction.confidence),
      severity: pickHighestSeverity(existing.severity, contradiction.severity),
      possibleExplanation:
        (contradiction.possibleExplanation || '').length > (existing.possibleExplanation || '').length
          ? contradiction.possibleExplanation
          : existing.possibleExplanation,
      resolutionSuggestion:
        (contradiction.resolutionSuggestion || '').length > (existing.resolutionSuggestion || '').length
          ? contradiction.resolutionSuggestion
          : existing.resolutionSuggestion,
    })
  }
  return [...merged.values()]
}

function mergeGapsDeterministically(gaps: Gap[]): Gap[] {
  const merged = new Map<string, Gap>()
  for (const gap of gaps) {
    const key = `${gap.type}|${normalizeKey(gap.description)}`
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, {
        ...gap,
        id: uuidv4(),
        suggestedBy: dedupeStrings(gap.suggestedBy),
      })
      continue
    }
    merged.set(key, {
      ...existing,
      suggestedBy: dedupeStrings([...existing.suggestedBy, ...gap.suggestedBy]),
      confidence: Math.max(existing.confidence, gap.confidence),
      priority: mergeGapPriority(existing.priority, gap.priority),
      relevance: gap.relevance.length > existing.relevance.length ? gap.relevance : existing.relevance,
      suggestedResearchQuestion:
        (gap.suggestedResearchQuestion || '').length > (existing.suggestedResearchQuestion || '').length
          ? gap.suggestedResearchQuestion
          : existing.suggestedResearchQuestion,
    })
  }
  return [...merged.values()]
}

function mergeBatchResults(
  results: Array<{
    patterns: Pattern[]
    contradictions: Contradiction[]
    gaps: Gap[]
    summary: string
    keyInsights: string[]
  }>,
  totalPapers: number
): {
  patterns: Pattern[]
  contradictions: Contradiction[]
  gaps: Gap[]
  summary: string
  keyInsights: string[]
} {
  if (results.length === 0) {
    return {
      patterns: [],
      contradictions: [],
      gaps: [],
      summary: 'No analysis results.',
      keyInsights: []
    }
  }
  
  if (results.length === 1) {
    // Fix the total paper count for single batch
    const result = results[0]
    result.patterns.forEach(p => {
      p.support.total = totalPapers
      p.support.papers = dedupePaperSupports(p.support.papers)
      p.support.count = countUniqueSupportPapers(p.support.papers)
      p.strength = deriveStrengthFromSupport(p.support.count, totalPapers)
    })
    return {
      ...result,
      contradictions: mergeContradictionsDeterministically(result.contradictions),
      gaps: mergeGapsDeterministically(result.gaps),
      keyInsights: dedupeStrings(result.keyInsights).slice(0, 5),
    }
  }

  const patternGroups = new Map<string, Pattern[]>()
  for (const pattern of results.flatMap(result => result.patterns)) {
    const key = getPatternGroupKey(pattern)
    const existing = patternGroups.get(key)
    if (existing) {
      existing.push(pattern)
    } else {
      patternGroups.set(key, [pattern])
    }
  }

  const mergedPatterns = [...patternGroups.values()]
    .map(group => mergePatternGroup(group, totalPapers))
    .sort((left, right) => right.support.count - left.support.count)

  const allContradictions = results.flatMap(result => result.contradictions)
  const allGaps = results.flatMap(result => result.gaps)

  const combinedSummary = dedupeStrings(
    results
      .map(result => result.summary.trim())
      .filter(Boolean)
  ).join(' ')

  const uniqueInsights = dedupeStrings(results.flatMap(result => result.keyInsights)).slice(0, 5)

  return {
    patterns: mergedPatterns,
    contradictions: mergeContradictionsDeterministically(allContradictions),
    gaps: mergeGapsDeterministically(allGaps),
    summary: combinedSummary,
    keyInsights: uniqueInsights
  }
}

function extractXofYClaims(text: string): Array<{ x: number; y: number }> {
  const matches = text.matchAll(/(\d+)\s+of\s+(\d+)/gi)
  const parsed: Array<{ x: number; y: number }> = []
  for (const match of matches) {
    const x = Number.parseInt(match[1] || '', 10)
    const y = Number.parseInt(match[2] || '', 10)
    if (Number.isFinite(x) && Number.isFinite(y)) {
      parsed.push({ x, y })
    }
  }
  return parsed
}

function replaceXofYClaims(
  text: string | undefined,
  replacement: { x: number; y: number }
): string | undefined {
  if (!text) return text
  return text.replace(
    /(\d+)\s+of\s+(\d+)/gi,
    `${replacement.x} of ${replacement.y}`
  )
}

function repairPatternDenominatorClaims(pattern: Pattern): Pattern {
  const replacement = {
    x: pattern.support.count,
    y: pattern.support.total,
  }

  return {
    ...pattern,
    claim: replaceXofYClaims(pattern.claim, replacement) || pattern.claim,
    summary: replaceXofYClaims(pattern.summary, replacement),
    values: pattern.values
      ? {
          ...pattern.values,
          summary: replaceXofYClaims(pattern.values.summary, replacement) || pattern.values.summary,
        }
      : undefined,
  }
}

function filterValidPaperSupports(
  papers: PaperSupport[],
  findingMap: Map<string, FindingWithPaper>,
  paperIds: Set<string>
): PaperSupport[] {
  return dedupePaperSupports(
    papers.filter((paperSupport) => {
      if (!paperIds.has(paperSupport.paperId)) return false
      const finding = findingMap.get(paperSupport.findingId)
      if (!finding) return false
      return finding.paperId === paperSupport.paperId
    })
  )
}

function repairAnalysisIntegrity(result: AnalysisResult, findings: FindingWithPaper[]): AnalysisResult {
  const findingMap = new Map(findings.map(finding => [finding.id, finding]))
  const paperIds = new Set(findings.map(finding => finding.paperId))

  const repairedPatterns = result.patterns.map((pattern) => {
    const validSupports = filterValidPaperSupports(pattern.support.papers, findingMap, paperIds)
    const supportCount = countUniqueSupportPapers(validSupports)
    const repairedPattern: Pattern = {
      ...pattern,
      support: {
        papers: validSupports,
        count: supportCount,
        total: pattern.support.total,
      },
      strength: deriveStrengthFromSupport(supportCount, pattern.support.total),
    }

    return repairPatternDenominatorClaims(repairedPattern)
  })

  const repairedContradictions = result.contradictions
    .map((contradiction) => {
      const repairedSides = contradiction.sides
        .map((side) => ({
          ...side,
          papers: filterValidPaperSupports(side.papers, findingMap, paperIds),
        }))
        .filter((side) => side.papers.length > 0)

      return {
        ...contradiction,
        sides: repairedSides,
      }
    })
    .filter((contradiction) => contradiction.sides.length >= 2)

  const repairedGaps = result.gaps.map((gap) => ({
    ...gap,
    suggestedBy: dedupeStrings(gap.suggestedBy.filter((paperId) => paperIds.has(paperId))),
  }))

  return {
    ...result,
    patterns: repairedPatterns,
    contradictions: repairedContradictions,
    gaps: repairedGaps,
  }
}

function validateAnalysisIntegrity(result: AnalysisResult, findings: FindingWithPaper[]): string[] {
  const findingMap = new Map(findings.map(finding => [finding.id, finding]))
  const paperIds = new Set(findings.map(finding => finding.paperId))
  const errors: string[] = []

  result.patterns.forEach((pattern, patternIndex) => {
    const uniqueSupportPaperIds = new Set(pattern.support.papers.map(paper => paper.paperId))

    if (pattern.support.count > pattern.support.total) {
      errors.push(
        `Pattern ${patternIndex + 1}: support.count (${pattern.support.count}) exceeds support.total (${pattern.support.total})`
      )
    }
    if (pattern.support.count !== uniqueSupportPaperIds.size) {
      errors.push(
        `Pattern ${patternIndex + 1}: support.count (${pattern.support.count}) does not match unique support papers (${uniqueSupportPaperIds.size})`
      )
    }

    pattern.support.papers.forEach((paperSupport, supportIndex) => {
      if (!paperIds.has(paperSupport.paperId)) {
        errors.push(
          `Pattern ${patternIndex + 1}, support ${supportIndex + 1}: unknown paperId ${paperSupport.paperId}`
        )
      }
      const finding = findingMap.get(paperSupport.findingId)
      if (!finding) {
        errors.push(
          `Pattern ${patternIndex + 1}, support ${supportIndex + 1}: unknown findingId ${paperSupport.findingId}`
        )
        return
      }
      if (finding.paperId !== paperSupport.paperId) {
        errors.push(
          `Pattern ${patternIndex + 1}, support ${supportIndex + 1}: findingId ${paperSupport.findingId} belongs to ${finding.paperId}, not ${paperSupport.paperId}`
        )
      }
    })

    const denominatorChecks = [
      ...extractXofYClaims(pattern.claim),
      ...extractXofYClaims(pattern.summary),
      ...extractXofYClaims(pattern.values?.summary || ''),
    ]
    for (const { x, y } of denominatorChecks) {
      if (x > y) {
        errors.push(`Pattern ${patternIndex + 1}: invalid denominator claim "${x} of ${y}"`)
      }
      if (y > pattern.support.total) {
        errors.push(
          `Pattern ${patternIndex + 1}: denominator "${x} of ${y}" exceeds support.total (${pattern.support.total})`
        )
      }
      if (x > pattern.support.count) {
        errors.push(
          `Pattern ${patternIndex + 1}: numerator "${x} of ${y}" exceeds support.count (${pattern.support.count})`
        )
      }
    }
  })

  result.contradictions.forEach((contradiction, contradictionIndex) => {
    if (contradiction.sides.length < 2) {
      errors.push(`Contradiction ${contradictionIndex + 1}: has fewer than 2 sides`)
    }
    contradiction.sides.forEach((side, sideIndex) => {
      if (side.papers.length === 0) {
        errors.push(
          `Contradiction ${contradictionIndex + 1}, side ${sideIndex + 1}: contains no supporting papers`
        )
      }
      side.papers.forEach((paperSupport, supportIndex) => {
        if (!paperIds.has(paperSupport.paperId)) {
          errors.push(
            `Contradiction ${contradictionIndex + 1}, side ${sideIndex + 1}, support ${supportIndex + 1}: unknown paperId ${paperSupport.paperId}`
          )
        }
        const finding = findingMap.get(paperSupport.findingId)
        if (!finding) {
          errors.push(
            `Contradiction ${contradictionIndex + 1}, side ${sideIndex + 1}, support ${supportIndex + 1}: unknown findingId ${paperSupport.findingId}`
          )
          return
        }
        if (finding.paperId !== paperSupport.paperId) {
          errors.push(
            `Contradiction ${contradictionIndex + 1}, side ${sideIndex + 1}, support ${supportIndex + 1}: findingId ${paperSupport.findingId} belongs to ${finding.paperId}, not ${paperSupport.paperId}`
          )
        }
      })
    })
  })

  result.gaps.forEach((gap, gapIndex) => {
    for (const paperId of gap.suggestedBy) {
      if (!paperIds.has(paperId)) {
        errors.push(`Gap ${gapIndex + 1}: unknown suggestedBy paperId ${paperId}`)
      }
    }
  })

  return dedupeStrings(errors)
}

function enforceAnalysisIntegrity(result: AnalysisResult, findings: FindingWithPaper[]): AnalysisResult {
  const initialErrors = validateAnalysisIntegrity(result, findings)
  if (initialErrors.length === 0) {
    return {
      ...result,
      diagnostics: {
        ...(result.diagnostics || {}),
        integrityRepairApplied: false,
      },
    }
  }

  const repairedResult = repairAnalysisIntegrity(result, findings)
  const remainingErrors = validateAnalysisIntegrity(repairedResult, findings)
  if (remainingErrors.length === 0) {
    console.warn(
      `⚠️ Analysis integrity issues repaired (${initialErrors.length} issue(s))`
    )
    return {
      ...repairedResult,
      diagnostics: {
        ...(repairedResult.diagnostics || {}),
        integrityRepairApplied: true,
        integrityErrors: initialErrors,
      },
    }
  }

  const failureMessage =
    `Analysis integrity validation failed (${remainingErrors.length} issue(s)):\n` +
    remainingErrors.slice(0, 10).join('\n')

  if (STRICT_INTEGRITY_MODE) {
    throw new Error(failureMessage)
  }
  console.error(`❌ ${failureMessage}`)

  return {
    ...repairedResult,
    diagnostics: {
      ...(repairedResult.diagnostics || {}),
      integrityRepairApplied: true,
      integrityErrors: remainingErrors,
    },
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a hash of findings for cache invalidation
 */
function hashFindings(findings: FindingWithPaper[]): string {
  const content = findings
    .map(f => `${f.paperId}:${f.id}:${f.claim}`)
    .sort()
    .join('|')
  
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}
