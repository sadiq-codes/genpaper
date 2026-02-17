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
import { getLanguageModel } from '@/lib/ai/vercel-client'
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
- Prefer quantified wording ("6 of 8 (75%)") over vague claims.
- Include concrete values/context when available.
- Avoid generic statements like "more research is needed."

Output compactness requirements:
- Keep text concise and avoid long prose.
- Prefer only the strongest supporting IDs per item.
- Stay within schema maxima (patterns<=8, contradictions<=6, gaps<=6, keyInsights<=5).`

type AnalysisObject = z.infer<typeof _AnalysisSchema>

const ANALYSIS_PART_MAX_OUTPUT_TOKENS = 2200
const ANALYSIS_PART_RETRY_MAX_OUTPUT_TOKENS = 3200
const ANALYSIS_PART_FINAL_RETRY_MAX_OUTPUT_TOKENS = 4200
const MAX_CLAIM_CHARS = 220
const MAX_EVIDENCE_CHARS = 160
const MAX_CONTEXT_CHARS = 110
const MAX_TITLE_CHARS = 80

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

async function generateAnalysisPartWithRetry<T>(
  schema: z.ZodType<T>,
  findings: FindingWithPaper[],
  topic: string | undefined,
  scope: string,
  partName: AnalysisPartName
): Promise<T> {
  const basePrompt = buildPrompt(findings, topic)
  const prompt = `${basePrompt}

Part-specific output requirement:
${PART_INSTRUCTIONS[partName]}

Only return JSON matching the provided schema.`
  const tokenBudgets = [
    ANALYSIS_PART_MAX_OUTPUT_TOKENS,
    ANALYSIS_PART_RETRY_MAX_OUTPUT_TOKENS,
    ANALYSIS_PART_FINAL_RETRY_MAX_OUTPUT_TOKENS,
  ]
  let lastError: unknown = null

  for (let attempt = 0; attempt < tokenBudgets.length; attempt++) {
    const maxOutputTokens = tokenBudgets[attempt]
    try {
      const { object } = await generateObject({
        model: getLanguageModel(),
        schema,
        system: SYSTEM_PROMPT,
        prompt,
        temperature: 0.2,
        maxOutputTokens,
      })
      return object
    } catch (error) {
      lastError = error
      const canRetry = attempt < tokenBudgets.length - 1 && isLikelyLengthOrParseTruncation(error)
      if (canRetry) {
        console.warn(`⚠️ ${scope} (${partName}) produced truncated/invalid JSON at ${maxOutputTokens} tokens; retrying with ${tokenBudgets[attempt + 1]} tokens`)
        continue
      }
      throw error
    }
  }

  throw lastError || new Error(`${scope} (${partName}) failed: unknown error`)
}

async function generateAnalysisObjectWithRetry(
  findings: FindingWithPaper[],
  topic: string | undefined,
  scope: string
): Promise<AnalysisObject> {
  const [patternsPart, contradictionsPart, gapsPart, metaPart] = await Promise.all([
    generateAnalysisPartWithRetry(PatternsOnlySchema, findings, topic, scope, 'patterns'),
    generateAnalysisPartWithRetry(ContradictionsOnlySchema, findings, topic, scope, 'contradictions'),
    generateAnalysisPartWithRetry(GapsOnlySchema, findings, topic, scope, 'gaps'),
    generateAnalysisPartWithRetry(AnalysisMetaSchema, findings, topic, scope, 'meta'),
  ])

  return {
    patterns: patternsPart.patterns,
    contradictions: contradictionsPart.contradictions,
    gaps: gapsPart.gaps,
    summary: metaPart.summary,
    keyInsights: metaPart.keyInsights,
    synthesisStrength: metaPart.synthesisStrength,
    fieldMaturity: metaPart.fieldMaturity,
  }
}

function truncateForPrompt(value: string | undefined, maxChars: number): string {
  if (!value) return ''
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
}

function buildPrompt(findings: FindingWithPaper[], topic?: string): string {
  const uniquePapers = new Set(findings.map(f => f.paperId)).size

  const paperRegistry = Array.from(
    new Map(findings.map(f => [f.paperId, truncateForPrompt(f.paperTitle, MAX_TITLE_CHARS)])).entries()
  )
    .map(([paperId, paperTitle]) => `- ${paperId}: ${paperTitle}`)
    .join('\n')

  const findingsText = findings.map((f) => {
    const pieces = [
      `paperId=${f.paperId}`,
      `findingId=${f.id}`,
      `claim="${truncateForPrompt(f.claim, MAX_CLAIM_CHARS)}"`,
      `evidence="${truncateForPrompt(f.evidence, MAX_EVIDENCE_CHARS)}"`,
    ]

    if (f.value) {
      pieces.push(`value="${truncateForPrompt(f.value, 64)}"`)
      if (f.valueType) {
        pieces.push(`valueType=${truncateForPrompt(f.valueType, 48)}`)
      }
    }

    if (f.direction) {
      pieces.push(`direction=${truncateForPrompt(f.direction, 32)}`)
    }

    if (f.context) {
      pieces.push(`context="${truncateForPrompt(f.context, MAX_CONTEXT_CHARS)}"`)
    }

    if ((f as { evidenceType?: string }).evidenceType) {
      pieces.push(`evidenceType=${truncateForPrompt((f as { evidenceType?: string }).evidenceType, 48)}`)
    }

    return `- ${pieces.join(' | ')}`
  }).join('\n')

  const topicLine = topic ? `Topic: ${truncateForPrompt(topic, 180)}\n` : ''

  return `Analyze ${findings.length} findings across ${uniquePapers} papers.
${topicLine}Paper registry:
${paperRegistry}

Findings:
${findingsText}

Tasks:
1) Identify patterns with support counts/percentages and value ranges when available.
2) Identify contradictions and classify each as direct, magnitude, conditional, or methodological.
3) Identify concrete gaps and include a concrete research question per gap.
4) Write overall summary + 5-7 key insights.
5) Assess synthesis quality and field maturity.

Use paperId/findingId values exactly as provided in input.`
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
  
  const { projectId, findings, topic } = input
  
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
      modelUsed: 'gpt-4o',
      findingsHash: hashFindings(findings)
    }
  }
  
  const uniquePapers = new Set(findings.map(f => f.paperId)).size
  
  // Use batched analysis for large finding sets to prevent token overflow
  if (findings.length > BATCH_THRESHOLD) {
    console.log(`\n📊 Finding count (${findings.length}) exceeds threshold (${BATCH_THRESHOLD}), using batched analysis...`)
    return analyzeFindingsBatched(projectId, findings, topic)
  }
  
  console.log(`\n🔍 Analyzing ${findings.length} findings from ${uniquePapers} papers...`)
  
  try {
    const object = await generateAnalysisObjectWithRetry(findings, topic, 'Cross-document analysis')
    
    // Build lookup maps for enriching results
    const findingsMap = new Map(findings.map(f => [f.id, f]))
    const paperTitles = new Map(findings.map(f => [f.paperId, f.paperTitle]))
    
    // Transform patterns with full paper support details
    const patterns: Pattern[] = object.patterns.map(p => {
      const papers: PaperSupport[] = p.supportingFindingIds
        .map(fid => findingsMap.get(fid))
        .filter((f): f is FindingWithPaper => f !== undefined)
        .map(f => ({
          paperId: f.paperId,
          paperTitle: f.paperTitle,
          findingId: f.id,
          claim: f.claim,
          value: f.value,
          valueType: f.valueType,
          evidence: f.evidence,
          confidence: f.confidence
        }))
      
      // Also add papers by ID if findings weren't found
      for (const pid of p.supportingPaperIds) {
        if (!papers.some(ps => ps.paperId === pid)) {
          const paperFinding = findings.find(f => f.paperId === pid)
          if (paperFinding) {
            papers.push({
              paperId: pid,
              paperTitle: paperTitles.get(pid) || 'Unknown',
              findingId: paperFinding.id,
              claim: paperFinding.claim,
              value: paperFinding.value,
              valueType: paperFinding.valueType,
              evidence: paperFinding.evidence,
              confidence: paperFinding.confidence
            })
          }
        }
      }
      
      return {
        id: uuidv4(),
        claim: p.claim,
        summary: p.summary,
        support: {
          papers,
          count: papers.length,
          total: uniquePapers
        },
        direction: p.direction || undefined,
        consistency: p.consistency,
        strength: p.strength,
        values: p.valuesSummary ? {
          summary: p.valuesSummary,
          individual: papers.map(ps => ps.value).filter((v): v is string => v !== undefined),
          range: p.valueRange ? {
            min: p.valueRange.min || undefined,
            max: p.valueRange.max || undefined,
            median: p.valueRange.median || undefined,
            heterogeneity: p.valueRange.heterogeneity || undefined
          } : undefined
        } : undefined,
        confidence: p.confidence,
        limitations: p.limitations || undefined
      }
    })
    
    // Transform contradictions
    const contradictions: Contradiction[] = object.contradictions.map(c => ({
      id: uuidv4(),
      description: c.description,
      contradictionType: c.contradictionType,
      sides: c.sides.map(s => ({
        position: s.position,
        papers: s.findingIds
          .map(fid => findingsMap.get(fid))
          .filter((f): f is FindingWithPaper => f !== undefined)
          .map(f => ({
            paperId: f.paperId,
            paperTitle: f.paperTitle,
            findingId: f.id,
            claim: f.claim,
            value: f.value,
            valueType: f.valueType,
            evidence: f.evidence,
            confidence: f.confidence
          })),
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
    
    return {
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
      findingsHash: hashFindings(findings)
    }
    
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
 * ~150 findings × ~200 tokens = ~30k tokens, leaving room for response
 */
const MAX_FINDINGS_PER_BATCH = 90

/**
 * Threshold above which we use batched analysis
 */
const BATCH_THRESHOLD = 120
const MIN_FINDINGS_TO_SPLIT = 30
const MAX_BATCH_SPLIT_DEPTH = 3
const BATCH_ANALYSIS_CONCURRENCY = 2

type TransformedBatchResult = {
  patterns: Pattern[]
  contradictions: Contradiction[]
  gaps: Gap[]
  summary: string
  keyInsights: string[]
}

function splitBatchByPaper(findings: FindingWithPaper[]): [FindingWithPaper[], FindingWithPaper[]] {
  const byPaper = new Map<string, FindingWithPaper[]>()
  for (const finding of findings) {
    const paperFindings = byPaper.get(finding.paperId) || []
    paperFindings.push(finding)
    byPaper.set(finding.paperId, paperFindings)
  }

  const left: FindingWithPaper[] = []
  const right: FindingWithPaper[] = []
  let leftCount = 0
  let rightCount = 0

  for (const paperFindings of byPaper.values()) {
    if (leftCount <= rightCount) {
      left.push(...paperFindings)
      leftCount += paperFindings.length
    } else {
      right.push(...paperFindings)
      rightCount += paperFindings.length
    }
  }

  return [left, right]
}

function splitBatchByIndex(findings: FindingWithPaper[]): [FindingWithPaper[], FindingWithPaper[]] {
  const midpoint = Math.floor(findings.length / 2)
  return [findings.slice(0, midpoint), findings.slice(midpoint)]
}

function transformBatchObject(
  object: AnalysisObject,
  batch: FindingWithPaper[],
  batchPapers: number
): TransformedBatchResult {
  const findingsMap = new Map(batch.map(f => [f.id, f]))
  const paperTitles = new Map(batch.map(f => [f.paperId, f.paperTitle]))

  const patterns: Pattern[] = object.patterns.map(p => {
    const papers: PaperSupport[] = p.supportingFindingIds
      .map(fid => findingsMap.get(fid))
      .filter((f): f is FindingWithPaper => f !== undefined)
      .map(f => ({
        paperId: f.paperId,
        paperTitle: f.paperTitle,
        findingId: f.id,
        claim: f.claim,
        value: f.value,
        valueType: f.valueType,
        evidence: f.evidence,
        confidence: f.confidence
      }))

    for (const pid of p.supportingPaperIds) {
      if (!papers.some(ps => ps.paperId === pid)) {
        const paperFinding = batch.find(f => f.paperId === pid)
        if (paperFinding) {
          papers.push({
            paperId: pid,
            paperTitle: paperTitles.get(pid) || 'Unknown',
            findingId: paperFinding.id,
            claim: paperFinding.claim,
            value: paperFinding.value,
            valueType: paperFinding.valueType,
            evidence: paperFinding.evidence,
            confidence: paperFinding.confidence
          })
        }
      }
    }

    return {
      id: uuidv4(),
      claim: p.claim,
      summary: p.summary,
      support: {
        papers,
        count: papers.length,
        total: batchPapers // Will be corrected during merge
      },
      direction: p.direction || undefined,
      consistency: p.consistency,
      strength: p.strength,
      values: p.valuesSummary ? {
        summary: p.valuesSummary,
        individual: papers.map(ps => ps.value).filter((v): v is string => v !== undefined),
        range: p.valueRange ? {
          min: p.valueRange.min || undefined,
          max: p.valueRange.max || undefined,
          median: p.valueRange.median || undefined,
          heterogeneity: p.valueRange.heterogeneity || undefined
        } : undefined
      } : undefined,
      confidence: p.confidence,
      limitations: p.limitations || undefined
    }
  })

  const contradictions: Contradiction[] = object.contradictions.map(c => ({
    id: uuidv4(),
    description: c.description,
    contradictionType: c.contradictionType,
    sides: c.sides.map(s => ({
      position: s.position,
      papers: s.findingIds
        .map(fid => findingsMap.get(fid))
        .filter((f): f is FindingWithPaper => f !== undefined)
        .map(f => ({
          paperId: f.paperId,
          paperTitle: f.paperTitle,
          findingId: f.id,
          claim: f.claim,
          value: f.value,
          valueType: f.valueType,
          evidence: f.evidence,
          confidence: f.confidence
        })),
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
    keyInsights: object.keyInsights
  }
}

async function analyzeBatchAdaptive(
  batch: FindingWithPaper[],
  topic: string | undefined,
  scope: string,
  depth = 0
): Promise<TransformedBatchResult[]> {
  const batchPapers = new Set(batch.map(f => f.paperId)).size

  try {
    const object = await generateAnalysisObjectWithRetry(batch, topic, scope)
    return [transformBatchObject(object, batch, batchPapers)]
  } catch (error) {
    const canSplit =
      isLikelyLengthOrParseTruncation(error) &&
      batch.length >= MIN_FINDINGS_TO_SPLIT &&
      depth < MAX_BATCH_SPLIT_DEPTH

    if (!canSplit) {
      throw error
    }

    let [left, right] = splitBatchByPaper(batch)
    if (left.length === 0 || right.length === 0) {
      ;[left, right] = splitBatchByIndex(batch)
    }

    if (left.length === 0 || right.length === 0) {
      throw error
    }

    console.warn(`⚠️ ${scope} still overflowed; splitting into ${left.length} and ${right.length} findings`)
    const leftResults = await analyzeBatchAdaptive(left, topic, `${scope}a`, depth + 1)
    const rightResults = await analyzeBatchAdaptive(right, topic, `${scope}b`, depth + 1)
    return [...leftResults, ...rightResults]
  }
}

/**
 * Analyze findings in batches and merge results
 * Used when finding count exceeds BATCH_THRESHOLD to prevent token overflow
 */
async function analyzeFindingsBatched(
  projectId: string,
  findings: FindingWithPaper[],
  topic?: string
): Promise<AnalysisResult> {
  const startTime = Date.now()
  const uniquePapers = new Set(findings.map(f => f.paperId)).size
  
  // Group findings by paper to ensure we don't split a paper's findings across batches
  const findingsByPaper = new Map<string, FindingWithPaper[]>()
  for (const finding of findings) {
    const paperFindings = findingsByPaper.get(finding.paperId) || []
    paperFindings.push(finding)
    findingsByPaper.set(finding.paperId, paperFindings)
  }
  
  // Build batches trying to keep papers together
  const batches: FindingWithPaper[][] = []
  let currentBatch: FindingWithPaper[] = []
  
  for (const [_paperId, paperFindings] of findingsByPaper) {
    // If adding this paper would exceed batch size, start new batch
    if (currentBatch.length + paperFindings.length > MAX_FINDINGS_PER_BATCH && currentBatch.length > 0) {
      batches.push(currentBatch)
      currentBatch = []
    }
    currentBatch.push(...paperFindings)
  }
  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }
  
  console.log(`\n🔍 Analyzing ${findings.length} findings in ${batches.length} batches...`)
  
  // Analyze each batch (bounded parallelism to reduce wall time on large analyses)
  const batchResults: TransformedBatchResult[] = []
  const resultsByIndex: TransformedBatchResult[][] = Array.from({ length: batches.length }, () => [])
  let nextBatchIndex = 0

  const workerCount = Math.min(BATCH_ANALYSIS_CONCURRENCY, batches.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const i = nextBatchIndex++
      if (i >= batches.length) return

      const batch = batches[i]
      const batchPapers = new Set(batch.map(f => f.paperId)).size
      console.log(`   📦 Batch ${i + 1}/${batches.length}: ${batch.length} findings from ${batchPapers} papers`)

      try {
        const scopedResults = await analyzeBatchAdaptive(batch, topic, `Batch ${i + 1}/${batches.length}`)
        resultsByIndex[i] = scopedResults

        const scopedPatterns = scopedResults.reduce((sum, r) => sum + r.patterns.length, 0)
        const scopedContradictions = scopedResults.reduce((sum, r) => sum + r.contradictions.length, 0)
        const scopedGaps = scopedResults.reduce((sum, r) => sum + r.gaps.length, 0)
        console.log(`   ✅ Batch ${i + 1}: ${scopedPatterns} patterns, ${scopedContradictions} contradictions, ${scopedGaps} gaps`)
      } catch (error) {
        console.error(`   ❌ Batch ${i + 1} failed:`, error)
        // Continue with other batches
      }
    }
  })

  await Promise.all(workers)
  for (const scopedResults of resultsByIndex) {
    batchResults.push(...scopedResults)
  }
  
  // Merge results from all batches
  const mergedResult = mergeBatchResults(batchResults, uniquePapers)
  
  const analysisTimeMs = Date.now() - startTime
  
  console.log(`✅ Batched analysis complete in ${analysisTimeMs}ms`)
  console.log(`   📊 Found ${mergedResult.patterns.length} patterns (merged)`)
  console.log(`   ⚡ Found ${mergedResult.contradictions.length} contradictions`)
  console.log(`   🔎 Found ${mergedResult.gaps.length} gaps`)
  
  return {
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
    findingsHash: hashFindings(findings)
  }
}

/**
 * Merge results from multiple batch analyses
 * - Deduplicates similar patterns by merging their support
 * - Keeps all unique contradictions and gaps
 * - Combines key insights
 */
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
    })
    return result
  }
  
  // Merge patterns - group similar claims and combine support
  const mergedPatterns: Pattern[] = []
  const patternClaims = new Map<string, Pattern>()
  
  for (const result of results) {
    for (const pattern of result.patterns) {
      // Normalize claim for comparison (lowercase, remove punctuation)
      const normalizedClaim = pattern.claim.toLowerCase().replace(/[^\w\s]/g, '').trim()
      
      // Check if we have a similar pattern already
      let merged = false
      for (const [existingClaim, existingPattern] of patternClaims) {
        // Simple similarity check - if claims share >50% of words
        const existingWords = new Set(existingClaim.split(/\s+/))
        const newWords = normalizedClaim.split(/\s+/)
        const overlap = newWords.filter(w => existingWords.has(w)).length
        const similarity = overlap / Math.max(existingWords.size, newWords.length)
        
        if (similarity > 0.5) {
          // Merge into existing pattern
          const seenPaperIds = new Set(existingPattern.support.papers.map(p => p.paperId))
          for (const paper of pattern.support.papers) {
            if (!seenPaperIds.has(paper.paperId)) {
              existingPattern.support.papers.push(paper)
              seenPaperIds.add(paper.paperId)
            }
          }
          existingPattern.support.count = existingPattern.support.papers.length
          existingPattern.support.total = totalPapers
          
          // Take higher confidence
          existingPattern.confidence = Math.max(existingPattern.confidence, pattern.confidence)
          
          // Merge values if present
          if (pattern.values && existingPattern.values) {
            const seenValues = new Set(existingPattern.values.individual)
            for (const val of pattern.values.individual) {
              if (!seenValues.has(val)) {
                existingPattern.values.individual.push(val)
              }
            }
          }
          
          merged = true
          break
        }
      }
      
      if (!merged) {
        pattern.support.total = totalPapers
        patternClaims.set(normalizedClaim, pattern)
        mergedPatterns.push(pattern)
      }
    }
  }
  
  // Sort patterns by support count
  mergedPatterns.sort((a, b) => b.support.count - a.support.count)
  
  // Collect all contradictions (simple concat, could dedupe if needed)
  const allContradictions = results.flatMap(r => r.contradictions)
  
  // Collect all gaps (simple concat, could dedupe if needed)
  const allGaps = results.flatMap(r => r.gaps)
  
  // Combine summaries
  const combinedSummary = results.map(r => r.summary).join(' ')
  
  // Dedupe and limit key insights
  const allInsights = results.flatMap(r => r.keyInsights)
  const uniqueInsights = [...new Set(allInsights)].slice(0, 7)
  
  return {
    patterns: mergedPatterns,
    contradictions: allContradictions,
    gaps: allGaps,
    summary: combinedSummary,
    keyInsights: uniqueInsights
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
