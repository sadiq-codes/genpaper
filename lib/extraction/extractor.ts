/**
 * Paper Extractor
 * 
 * Flexible approach to extracting findings from academic papers.
 * 
 * Key principles:
 * - No hardcoded section names, field values, or patterns
 * - LLM reads the full text and discovers what's there
 * - Findings are described in natural language
 * - Works across all paper types and domains
 * 
 * @module lib/extraction/extractor
 */

import { generateObject } from 'ai'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { getExtractionLanguageModel } from '@/lib/ai/vercel-client'
import type {
  Finding,
  PaperExtraction,
  ExtractionInput,
  ExtractionResult
} from './types'

// =============================================================================
// Zod Schema - Flexible, No Hardcoded Enums
// =============================================================================

const FindingSchema = z.object({
  claim: z.string().describe('SPECIFIC statement including: WHO/WHAT was studied, the FINDING, MAGNITUDE if quantitative, and CONTEXT. Example: "Adult participants (N=200) showed 24% reduction in anxiety after 8 weeks of treatment"'),
  evidence: z.string().describe('Direct quote from the paper supporting this finding - EXACT text, not paraphrased'),
  value: z.string().nullable().describe('MUST be numeric: "24%", "r=0.67", "β=0.34", "d=0.8", "OR=2.3", "N=500", "mean=3.4 (SD=1.2)". For qualitative: "3 themes", "5 of 8 participants". NOT words like "significant" or "large". null only if genuinely non-countable'),
  valueType: z.string().nullable().describe('Specific type: "percentage", "correlation_r", "beta_coefficient", "effect_size_d", "odds_ratio", "p_value", "sample_size", "mean_sd", "confidence_interval", "theme_count", "frequency", "chi_square". null if no value'),
  confidenceInterval: z.string().nullable().optional().describe('Confidence interval if reported, e.g., "95% CI [1.5-3.4]"'),
  pValue: z.string().nullable().optional().describe('p-value if reported, e.g., "p<0.001" or "p=0.034"'),
  direction: z.string().nullable().describe('Nature of finding: "positive", "negative", "no_effect", "mixed", or "descriptive" for non-directional findings'),
  comparedTo: z.string().nullable().optional().describe('What this finding compares against, null if not comparative'),
  context: z.string().nullable().describe('Specific context: population, setting, time period, conditions'),
  isMainFinding: z.boolean().describe('true if this is a primary/main result, false if secondary/background'),
  confidence: z.number().min(0).max(1).describe('How confident you are in this extraction (0.7-1.0)'),

  // NEW: Evidence type classification
  evidenceType: z.enum([
    "empirical_quantitative",    // Stats, experiments, surveys with numbers
    "empirical_qualitative",     // Interviews, observations, themes
    "theoretical",               // Arguments, frameworks, propositions  
    "methodological",            // Methods, techniques, procedures
    "descriptive"                // Facts, definitions, descriptions
  ]).describe('Type of evidence this finding represents')
})

const ExtractionSchema = z.object({
  // Metadata
  metadata: z.object({
    title: z.string().describe('The actual title of the paper (not journal name or volume)'),
    authors: z.array(z.string()).describe('Author names'),
    year: z.number().nullable().describe('Publication year, null if not identifiable'),
    domain: z.string().describe('Research domain/field (e.g., "microbiology", "psychology", "political science")'),
    paperType: z.string().describe('Type of paper (e.g., "empirical study", "theoretical paper", "literature review", "case study")'),
    methodology: z.string().describe('Brief description of the research methodology used')
  }),
  
  // Findings
  findings: z.array(FindingSchema).describe('All findings, claims, and results from the paper'),
  
  // Summary
  researchQuestion: z.string().nullable().describe('Main research question if explicitly stated, null if not clear'),
  contributions: z.array(z.string()).describe('What this paper contributes that is new or novel'),
  limitations: z.array(z.string()).describe('Limitations acknowledged by the authors - be specific, use details from the paper'),
  
  // Extraction notes
  extractionNotes: z.array(z.string()).describe('Any issues, uncertainties, or observations about the extraction')
})

// =============================================================================
// The Prompt - Simple, Open-Ended, No Assumptions
// =============================================================================

const SYSTEM_PROMPT = `You are an expert academic reader extracting citation-ready findings from research papers.

GOAL:
- Extract high-signal findings with maximum specificity and faithful evidence.
- Target 5-10 findings per paper (quality + coverage, not shallow over-extraction).

REQUIRED PER FINDING:
- WHO/WHAT was studied
- The concrete finding
- Magnitude/extent when available
- Context (population, setting, condition, timeframe)
- EXACT supporting quote from the paper

VALUE RULES:
- value must be numeric when possible ("24%", "r=0.67", "β=0.34", "N=500", "3 themes").
- valueType should label the numeric value type.
- direction should describe effect nature ("positive", "negative", "no_effect", "mixed", "descriptive").
- Capture pValue and confidenceInterval when reported.

PAPER-TYPE COVERAGE:
- Quantitative: key statistics, sample details, comparisons, confidence intervals, and meaningful null findings.
- Qualitative: themes/categories, participant/case counts, contextual constraints, and representative quotes.
- Theoretical: core propositions, conceptual relationships, and explicit critiques/contributions.
- Review/meta-analysis: included-study counts, pooled/summary statistics, cross-study patterns, and identified gaps.

DO NOT:
- Collapse many distinct findings into one vague claim.
- Paraphrase evidence quotes.
- Invent findings not in the source.
- Use non-numeric words like "significant" or "strong" as value.

evidenceType mapping:
- empirical_quantitative: numeric empirical results
- empirical_qualitative: interview/observation/theme findings
- theoretical: conceptual/propositional claims
- methodological: methods/protocol/process findings
- descriptive: factual/descriptive statements`

function buildPrompt(text: string): string {
  return `Extract findings from this paper.

Target: 5-10 findings with maximum specificity and broad coverage of the paper's most citation-worthy evidence.

---
${text}
---

Final checks before output:
- Each finding includes WHO/WHAT, concrete result, and context.
- value is numeric when available; pValue and confidenceInterval are captured when reported.
- Evidence is an exact quote, not paraphrased.
- Distinct findings stay separate (do not merge unrelated claims).
- Include meaningful null findings where relevant.

Extract the ACTUAL title (not journal name) and all identifiable authors.`
}

// =============================================================================
// Main Extraction Function
// =============================================================================

/**
 * Extract findings from a paper using flexible, non-brittle approach
 */
export async function extractPaper(input: ExtractionInput): Promise<ExtractionResult> {
  const startTime = Date.now()
  
  try {
    // Truncate if extremely long (but keep as much as possible)
    const maxChars = 100000 // ~25k tokens
    const text = input.text.length > maxChars 
      ? input.text.slice(0, maxChars) + '\n\n[Text truncated...]'
      : input.text
    
    console.log(`\n🔬 Extracting findings from paper (${text.length} chars)...`)
    
    const { object } = await generateObject({
      model: getExtractionLanguageModel(),
      schema: ExtractionSchema,
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(text),
      temperature: 0.1,
      maxOutputTokens: 8000,
    })
    
    // Transform to our types with IDs
    const findings: Finding[] = object.findings.map(f => ({
      id: uuidv4(),
      claim: f.claim,
      evidence: f.evidence,
      value: f.value ?? undefined,
      valueType: f.valueType ?? undefined,
      confidenceInterval: f.confidenceInterval ?? undefined,
      pValue: f.pValue ?? undefined,
      direction: f.direction ?? undefined,
      comparedTo: f.comparedTo ?? undefined,
      context: f.context ?? undefined,
      isMainFinding: f.isMainFinding,
      confidence: f.confidence,
      // NEW: Evidence type
      evidenceType: f.evidenceType
    }))
    
    const extraction: PaperExtraction = {
      paperId: input.paperId,
      metadata: {
        title: object.metadata.title,
        authors: object.metadata.authors,
        year: object.metadata.year ?? undefined,
        domain: object.metadata.domain,
        paperType: object.metadata.paperType,
        methodology: object.metadata.methodology
      },
      findings,
      researchQuestion: object.researchQuestion ?? undefined,
      contributions: object.contributions,
      limitations: object.limitations,
      extractionConfidence: calculateOverallConfidence(findings),
      extractionNotes: object.extractionNotes,
      extractedAt: new Date(),
      extractionTimeMs: Date.now() - startTime,
      modelUsed: 'gpt-4o'
    }
    
    const timeMs = Date.now() - startTime
    
    console.log(`✅ Extraction complete in ${timeMs}ms`)
    console.log(`   📄 Title: ${extraction.metadata.title}`)
    console.log(`   🔬 Domain: ${extraction.metadata.domain} (${extraction.metadata.paperType})`)
    console.log(`   📊 Found ${findings.length} findings (${findings.filter(f => f.isMainFinding).length} main)`)
    console.log(`   💡 ${extraction.contributions.length} contributions, ${extraction.limitations.length} limitations`)
    
    return {
      success: true,
      extraction,
      timeMs
    }
    
  } catch (error) {
    const timeMs = Date.now() - startTime
    console.error('❌ Extraction failed:', error)
    
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      timeMs
    }
  }
}

// =============================================================================
// Helpers
// =============================================================================

function calculateOverallConfidence(findings: Finding[]): number {
  if (findings.length === 0) return 0
  const sum = findings.reduce((acc, f) => acc + f.confidence, 0)
  return sum / findings.length
}
