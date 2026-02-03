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
  claim: z.string().describe('The pattern statement - what multiple papers found'),
  summary: z.string().describe('Brief explanation of this pattern'),
  supportingPaperIds: z.array(z.string()).describe('Paper IDs that support this pattern'),
  supportingFindingIds: z.array(z.string()).describe('Finding IDs that support this pattern'),
  direction: z.string().nullable().describe('Nature: "positive", "negative", "descriptive", etc.'),
  consistency: z.string().describe('How consistent: "consistent", "mostly consistent", "mixed"'),
  valuesSummary: z.string().nullable().describe('Summary of values if quantitative, e.g., "ranging from 24% to 34%"'),
  confidence: z.number().min(0).max(1),
  limitations: z.string().nullable().describe('Any caveats about this pattern')
})

const ContradictionSchema = z.object({
  description: z.string().describe('What is contradictory'),
  sides: z.array(z.object({
    position: z.string().describe('One side of the disagreement'),
    paperIds: z.array(z.string()).describe('Papers supporting this position'),
    findingIds: z.array(z.string()).describe('Finding IDs for this position')
  })),
  possibleExplanation: z.string().nullable().describe('Why might papers disagree?'),
  severity: z.string().describe('How significant: "minor", "moderate", "significant"'),
  confidence: z.number().min(0).max(1)
})

const GapSchema = z.object({
  description: z.string().describe('What is missing from the research'),
  type: z.string().describe('Type of gap: "methodological", "population", "temporal", etc.'),
  relevance: z.string().describe('Why this gap matters'),
  suggestedByPaperIds: z.array(z.string()).describe('Papers that mention or imply this gap'),
  confidence: z.number().min(0).max(1)
})

const AnalysisSchema = z.object({
  patterns: z.array(PatternSchema).describe('Patterns found across papers'),
  contradictions: z.array(ContradictionSchema).describe('Contradictions between papers'),
  gaps: z.array(GapSchema).describe('Gaps in the literature'),
  summary: z.string().describe('Overall summary of the literature'),
  keyInsights: z.array(z.string()).describe('Top 3-5 key takeaways')
})

// =============================================================================
// Prompt
// =============================================================================

const SYSTEM_PROMPT = `You are an expert research analyst. Your task is to analyze findings across multiple academic papers to identify patterns, contradictions, and gaps.

CRITICAL INSTRUCTIONS:

1. PATTERNS: Look for findings that appear in multiple papers
   - Group similar findings together
   - Note how many papers support each pattern
   - Summarize any quantitative values reported
   - Assess consistency across papers

2. CONTRADICTIONS: Identify where papers disagree
   - Clearly state what the disagreement is about
   - List which papers are on each side
   - Try to explain WHY they might disagree (methodology, population, time period, etc.)

3. GAPS: What's missing from the research?
   - Methodological gaps (how studies are done)
   - Population gaps (who is studied)
   - Temporal gaps (when/how long)
   - Geographic gaps (where)
   - Topical gaps (what questions aren't addressed)

4. BE SPECIFIC:
   - Use paper IDs and finding IDs in your references
   - Quote specific values when available
   - Don't make generic statements

5. SUMMARY:
   - Provide an overall narrative of what the literature shows
   - Highlight the most important insights`

function buildPrompt(findings: FindingWithPaper[], topic?: string): string {
  const findingsText = findings.map((f, i) => {
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
    
    return text
  }).join('\n\n')

  const topicLine = topic ? `\nTopic/Focus: ${topic}\n` : ''

  return `Analyze the following ${findings.length} findings from ${new Set(findings.map(f => f.paperId)).size} papers:
${topicLine}
---
${findingsText}
---

Identify:
1. PATTERNS - What findings appear across multiple papers?
2. CONTRADICTIONS - Where do papers disagree?
3. GAPS - What's missing from this research?
4. SUMMARY - Overall narrative of the literature
5. KEY INSIGHTS - Top takeaways`
}

// =============================================================================
// Main Analysis Function
// =============================================================================

/**
 * Analyze findings across papers to identify patterns, contradictions, and gaps
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
        values: p.valuesSummary ? {
          summary: p.valuesSummary,
          individual: papers.map(ps => ps.value).filter((v): v is string => v !== undefined)
        } : undefined,
        confidence: p.confidence,
        limitations: p.limitations || undefined
      }
    })
    
    // Transform contradictions
    const contradictions: Contradiction[] = object.contradictions.map(c => ({
      id: uuidv4(),
      description: c.description,
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
          }))
      })),
      possibleExplanation: c.possibleExplanation || undefined,
      severity: c.severity,
      confidence: c.confidence
    }))
    
    // Transform gaps
    const gaps: Gap[] = object.gaps.map(g => ({
      id: uuidv4(),
      description: g.description,
      type: g.type,
      relevance: g.relevance,
      suggestedBy: g.suggestedByPaperIds,
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
