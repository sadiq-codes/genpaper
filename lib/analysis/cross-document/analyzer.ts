/**
 * Cross-Document Analyzer
 * 
 * Analyzes findings across multiple papers to identify patterns,
 * contradictions, and gaps in the literature.
 * 
 * Key principles:
 * - No hardcoded categories - LLM discovers patterns
 * - Single LLM call for analysis (simple, effective)
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

const PaperSupportSchema = z.object({
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
  claim: z.string().describe('SPECIFIC pattern statement - what multiple papers found, including magnitude and context'),
  summary: z.string().describe('Brief explanation of this pattern and its significance'),
  supportingPaperIds: z.array(z.string()).describe('Paper IDs that support this pattern'),
  supportingFindingIds: z.array(z.string()).describe('Finding IDs that support this pattern'),
  direction: z.string().nullable().describe('Nature: "positive", "negative", "descriptive", "no_effect", etc.'),
  consistency: z.string().describe('How consistent: "consistent" (all agree), "mostly_consistent" (75%+), "mixed" (<75%)'),
  valuesSummary: z.string().nullable().describe('SPECIFIC value summary: "effect sizes ranged from d=0.3 to d=0.9 (median d=0.55)" or "3 of 5 qualitative studies identified this as primary theme"'),
  valueRange: z.object({
    min: z.string().nullable(),
    max: z.string().nullable(),
    median: z.string().nullable(),
    heterogeneity: z.enum(['low', 'moderate', 'high']).nullable()
  }).nullable().describe('Structured value range when quantitative data available'),
  strength: z.enum(['strong', 'moderate', 'emerging']).describe('Pattern strength: strong (≥50% or ≥4 papers), moderate (3 papers or 30-49%), emerging (2 papers)'),
  confidence: z.number().min(0).max(1),
  limitations: z.string().nullable().describe('Specific caveats about this pattern')
})

const ContradictionSchema = z.object({
  description: z.string().describe('SPECIFIC description of what is contradictory'),
  contradictionType: z.enum([
    'direct',        // Opposite conclusions: X causes Y vs X does not cause Y
    'magnitude',     // Same direction, different strength: large effect vs small effect
    'conditional',   // Works in some contexts: effect in population A, no effect in population B
    'methodological' // Different methods yield different conclusions
  ]).describe('Type of contradiction'),
  sides: z.array(z.object({
    position: z.string().describe('One side of the disagreement with specific claim'),
    paperIds: z.array(z.string()).describe('Papers supporting this position'),
    findingIds: z.array(z.string()).describe('Finding IDs for this position'),
    evidenceStrength: z.enum(['strong', 'moderate', 'weak']).describe('Quality of evidence for this position')
  })),
  possibleExplanation: z.string().nullable().describe('SPECIFIC explanation: methodology difference, population difference, temporal context, etc.'),
  severity: z.enum(['minor', 'moderate', 'major']).describe('minor (nuance), moderate (significant but reconcilable), major (fundamental disagreement)'),
  resolutionSuggestion: z.string().nullable().describe('How might this contradiction be resolved?'),
  confidence: z.number().min(0).max(1)
})

const GapSchema = z.object({
  description: z.string().describe('SPECIFIC description of what is missing'),
  type: z.enum([
    'population',      // Who is not studied: certain demographics, regions, contexts
    'methodological',  // How: study designs, measures, durations not used
    'temporal',        // When: time periods, longitudinal tracking not covered
    'geographic',      // Where: regions or settings not examined
    'theoretical',     // What: mechanisms, frameworks, explanations not explored
    'replication'      // Whether: findings not replicated or confirmed
  ]).describe('Type of gap'),
  relevance: z.string().describe('WHY this gap matters for understanding the topic'),
  suggestedResearchQuestion: z.string().describe('CONCRETE research question that would address this gap. Example: "How does [factor] affect [outcome] in [underrepresented population]?"'),
  suggestedByPaperIds: z.array(z.string()).describe('Papers that mention or imply this gap'),
  priority: z.enum(['high', 'medium', 'low']).describe('How important is filling this gap?'),
  confidence: z.number().min(0).max(1)
})

const AnalysisSchema = z.object({
  patterns: z.array(PatternSchema).describe('Patterns found across papers - aim for 5-15 patterns'),
  contradictions: z.array(ContradictionSchema).describe('Contradictions between papers - identify all disagreements'),
  gaps: z.array(GapSchema).describe('Gaps in the literature - at least one per gap type if applicable'),
  summary: z.string().describe('Overall synthesis narrative of what the literature shows'),
  keyInsights: z.array(z.string()).describe('Top 5-7 key takeaways with specific evidence'),
  
  // NEW: Synthesis quality metadata
  synthesisStrength: z.object({
    overallConfidence: z.enum(['high', 'moderate', 'low']).describe('Overall confidence in synthesis'),
    evidenceBase: z.string().describe('Description: "8 empirical studies, 3 theoretical papers"'),
    methodologicalDiversity: z.enum(['high', 'moderate', 'low']).describe('Variety in study designs'),
    geographicDiversity: z.enum(['high', 'moderate', 'low']).describe('Variety in study locations'),
    temporalSpread: z.string().nullable().describe('Time range: "2015-2023"')
  }).describe('Assessment of evidence base quality'),
  
  fieldMaturity: z.enum([
    'emerging',     // Few studies, many gaps, fundamental questions open
    'developing',   // Growing body, some consensus, significant gaps remain
    'established',  // Strong consensus, well-replicated, incremental questions
    'contested'     // Many studies but fundamental disagreements persist
  ]).describe('Maturity level of this research area')
})

// =============================================================================
// Prompt
// =============================================================================

const SYSTEM_PROMPT = `You are an expert research analyst performing cross-document synthesis. Your task is to analyze findings across multiple academic papers to identify patterns, contradictions, and gaps with MAXIMUM SPECIFICITY.

═══════════════════════════════════════════════════════════════════════════════
1. PATTERNS - Findings that appear across multiple papers
═══════════════════════════════════════════════════════════════════════════════

PATTERN STRENGTH THRESHOLDS:
- STRONG: ≥50% of papers OR ≥4 papers support it
- MODERATE: 3 papers OR 30-49% support it
- EMERGING: 2 papers support it

FOR QUANTITATIVE PATTERNS:
- Report the RANGE of values: "Effect sizes ranged from d=0.3 to d=0.9"
- Report MEDIAN if ≥3 values available: "median d=0.55"
- Note HETEROGENEITY: if range exceeds 2x, mark as "high"
- Report CONSISTENCY: "All 5 studies found positive effects" vs "3 positive, 2 null"

FOR QUALITATIVE PATTERNS:
- Count how many studies identified similar themes: "4 of 6 studies identified this as primary theme"
- Note variations in how themes manifested across contexts

PATTERN CLAIM FORMAT:
✅ GOOD: "6 of 8 studies (75%) found positive correlation between X and Y, with effect sizes ranging from r=0.45 to r=0.72 (median r=0.58)"
❌ BAD: "Multiple studies found a relationship between X and Y"

═══════════════════════════════════════════════════════════════════════════════
2. CONTRADICTIONS - Where papers disagree
═══════════════════════════════════════════════════════════════════════════════

CLASSIFY EACH CONTRADICTION BY TYPE:

DIRECT: Opposite conclusions
- Paper A: "X causes Y" vs Paper B: "X does not cause Y"

MAGNITUDE: Same direction, different strength
- Paper A: "Strong effect (d=0.8)" vs Paper B: "Weak effect (d=0.2)"

CONDITIONAL: Works in some contexts, not others
- Paper A: "Effect in population X" vs Paper B: "No effect in population Y"

METHODOLOGICAL: Different methods, different conclusions
- Quantitative studies find X, qualitative studies find Y

FOR EACH CONTRADICTION:
- State the SPECIFIC disagreement with values
- Classify the type
- List papers on each side with their evidence strength
- Propose SPECIFIC explanation: "This may be due to differences in sample age (18-25 vs 40-60)"
- Assess severity: minor (nuance), moderate (reconcilable), major (fundamental)
- Suggest how it might be resolved

═══════════════════════════════════════════════════════════════════════════════
3. GAPS - What's CONSPICUOUSLY ABSENT given what was found
═══════════════════════════════════════════════════════════════════════════════

IDENTIFY GAPS BY ASKING:
- Given these findings, what SHOULD have been studied but wasn't?
- What populations/contexts/methods are missing?

GAP TYPES (identify at least one of each type if applicable):
- POPULATION: "All studies focused on Western samples; non-Western contexts unexplored"
- METHODOLOGICAL: "Predominantly cross-sectional; longitudinal studies needed"
- TEMPORAL: "No studies post-2020; effects of recent changes unknown"
- GEOGRAPHIC: "No studies from developing countries"
- THEORETICAL: "Mechanism linking X to Y remains unspecified"
- REPLICATION: "Key findings have not been replicated in independent samples"

FOR EACH GAP - MUST INCLUDE:
- Description: What specifically is missing?
- Why it matters: How does this limit understanding?
- CONCRETE research question: "How does [factor] affect [outcome] in [underrepresented population]?"
- Priority: How important is filling this gap?

✅ GOOD: "No studies examined effects in adolescent populations (ages 12-17). Given that [related finding], understanding this age group is critical. Research question: How do X interventions affect Y outcomes in adolescents?"
❌ BAD: "More research is needed on different populations"

═══════════════════════════════════════════════════════════════════════════════
4. SYNTHESIS QUALITY ASSESSMENT
═══════════════════════════════════════════════════════════════════════════════

Assess the overall evidence base:
- Overall confidence: Based on study quality, consistency, replication
- Evidence base: Count by type (empirical, theoretical, review)
- Methodological diversity: Variety in study designs used
- Geographic diversity: Variety in study locations
- Temporal spread: Range of publication years

Field maturity:
- EMERGING: Few studies, many gaps, fundamental questions open
- DEVELOPING: Growing body, some consensus, significant gaps remain
- ESTABLISHED: Strong consensus, well-replicated findings
- CONTESTED: Many studies but fundamental disagreements persist

═══════════════════════════════════════════════════════════════════════════════
5. SPECIFICITY REQUIREMENTS
═══════════════════════════════════════════════════════════════════════════════

- Use paper IDs and finding IDs in ALL references
- Include SPECIFIC values: "r=0.67" not "significant correlation"
- Quantify support: "6 of 8 studies" not "most studies"
- Name specific populations, methods, contexts
- NO generic statements like "further research is needed"`

function buildPrompt(findings: FindingWithPaper[], topic?: string): string {
  const uniquePapers = new Set(findings.map(f => f.paperId)).size
  
  const findingsText = findings.map((f) => {
    let text = `[Paper: ${f.paperTitle} (${f.paperId})]
  Finding ID: ${f.id}
  Claim: ${f.claim}
  Evidence: "${f.evidence}"`
    
    if (f.value) {
      text += `\n  Value: ${f.value} (${f.valueType || 'unspecified type'})`
    }
    if (f.direction) {
      text += `\n  Direction: ${f.direction}`
    }
    if (f.context) {
      text += `\n  Context: ${f.context}`
    }
    // Include evidence type if available
    if ((f as { evidenceType?: string }).evidenceType) {
      text += `\n  Evidence Type: ${(f as { evidenceType?: string }).evidenceType}`
    }
    
    return text
  }).join('\n\n')

  const topicLine = topic ? `\nTopic/Focus: ${topic}\n` : ''

  return `Analyze the following ${findings.length} findings from ${uniquePapers} papers:
${topicLine}
---
${findingsText}
---

═══════════════════════════════════════════════════════════════════════════════
ANALYSIS TASKS (be SPECIFIC and EXHAUSTIVE)
═══════════════════════════════════════════════════════════════════════════════

1. PATTERNS (aim for 5-15 patterns)
   - What findings appear across multiple papers?
   - For each: How many papers support it? What are the specific values?
   - Use pattern strength: strong (≥50% or ≥4), moderate (3 or 30-49%), emerging (2)

2. CONTRADICTIONS (identify ALL disagreements)
   - Where do papers disagree?
   - Classify each: direct, magnitude, conditional, or methodological
   - Explain WHY they might disagree with specific factors

3. GAPS (at least one per type if applicable)
   - Population gaps: Who is not studied?
   - Methodological gaps: What designs are missing?
   - Temporal gaps: What time periods are not covered?
   - Geographic gaps: Where hasn't been studied?
   - Theoretical gaps: What mechanisms are unexplained?
   - Replication gaps: What hasn't been confirmed?
   - Each gap MUST include a concrete research question

4. SUMMARY
   - Overall synthesis narrative (not just listing)
   - What does the literature collectively show?

5. KEY INSIGHTS (5-7 specific takeaways)
   - Include specific values/counts where available
   - "6 of 8 studies found..." not "most studies found..."

6. SYNTHESIS QUALITY
   - Assess overall confidence, evidence base, diversity
   - Determine field maturity: emerging, developing, established, contested

═══════════════════════════════════════════════════════════════════════════════
SPECIFICITY CHECK
═══════════════════════════════════════════════════════════════════════════════

Before submitting, verify:
□ Every pattern includes paper count AND percentage: "6 of 8 (75%)"
□ Quantitative patterns include value ranges and medians where possible
□ Every contradiction has a specific explanation
□ Every gap has a concrete research question
□ No generic statements like "more research is needed"`
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
    const { object } = await generateObject({
      model: getLanguageModel(),
      schema: AnalysisSchema,
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(findings, topic),
      temperature: 0.2,
    })
    
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
const MAX_FINDINGS_PER_BATCH = 150

/**
 * Threshold above which we use batched analysis
 */
const BATCH_THRESHOLD = 200

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
  
  // Analyze each batch
  const batchResults: Array<{
    patterns: Pattern[]
    contradictions: Contradiction[]
    gaps: Gap[]
    summary: string
    keyInsights: string[]
  }> = []
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]
    const batchPapers = new Set(batch.map(f => f.paperId)).size
    console.log(`   📦 Batch ${i + 1}/${batches.length}: ${batch.length} findings from ${batchPapers} papers`)
    
    try {
      const { object } = await generateObject({
        model: getLanguageModel(),
        schema: AnalysisSchema,
        system: SYSTEM_PROMPT,
        prompt: buildPrompt(batch, topic),
        temperature: 0.2,
      })
      
      // Build lookup maps for this batch
      const findingsMap = new Map(batch.map(f => [f.id, f]))
      const paperTitles = new Map(batch.map(f => [f.paperId, f.paperTitle]))
      
      // Transform patterns
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
      
      batchResults.push({
        patterns,
        contradictions,
        gaps,
        summary: object.summary,
        keyInsights: object.keyInsights
      })
      
      console.log(`   ✅ Batch ${i + 1}: ${patterns.length} patterns, ${contradictions.length} contradictions, ${gaps.length} gaps`)
      
    } catch (error) {
      console.error(`   ❌ Batch ${i + 1} failed:`, error)
      // Continue with other batches
    }
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
