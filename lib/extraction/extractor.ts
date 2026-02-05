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
  direction: z.string().nullable().describe('Nature of finding: "positive", "negative", "no_effect", "mixed", or "descriptive" for non-directional findings'),
  comparedTo: z.string().nullable().describe('What this finding compares against, null if not comparative'),
  context: z.string().nullable().describe('Specific context: population, setting, time period, conditions'),
  isMainFinding: z.boolean().describe('true if this is a primary/main result, false if secondary/background'),
  confidence: z.number().min(0).max(1).describe('How confident you are in this extraction (0.7-1.0)'),
  
  // NEW: Enhanced statistical precision
  statisticalPrecision: z.object({
    confidenceInterval: z.string().nullable().describe('CI if reported, e.g., "95% CI [1.5-3.4]"'),
    pValue: z.string().nullable().describe('p-value if reported, e.g., "p<0.001" or "p=0.034"'),
    effectSizeInterpretation: z.enum(["small", "medium", "large", "not_applicable"]).nullable().describe('Interpretation of effect magnitude')
  }).nullable().describe('Statistical details when available'),
  
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

const SYSTEM_PROMPT = `You are an expert academic reader extracting findings from research papers for literature synthesis.

YOUR GOAL: Extract EVERY piece of evidence that could be cited in a literature review, with MAXIMUM SPECIFICITY.

═══════════════════════════════════════════════════════════════════════════════
FINDING EXTRACTION - BE EXHAUSTIVE AND SPECIFIC
═══════════════════════════════════════════════════════════════════════════════

Extract AT LEAST 8-15 findings per paper. Each finding must be SPECIFIC, not vague.

CLAIM SPECIFICITY REQUIREMENTS:
Every claim MUST include:
- WHO/WHAT was studied (sample, population, texts, cases)
- The FINDING (relationship, effect, pattern, theme, argument)
- MAGNITUDE/EXTENT if quantitative (percentage, effect size, count)
- CONTEXT (conditions, time period, geographic scope)

DISCIPLINE EXAMPLES (showing required specificity):

STEM/Medical:
✅ GOOD: "Mice treated with compound X (N=40) showed 34% reduction in tumor size (p<0.01) after 6 weeks"
❌ BAD: "The treatment was effective"

Social Sciences:
✅ GOOD: "Interview participants (N=25, aged 18-35, urban US) identified three primary themes: autonomy, recognition, and belonging"
❌ BAD: "Several themes emerged from the interviews"

Humanities:
✅ GOOD: "Analysis of 15 Victorian novels (1850-1880) reveals a consistent narrative pattern of transgression-punishment-redemption"
❌ BAD: "The novels showed common patterns"

Business/Economics:
✅ GOOD: "Firms adopting agile practices (N=120, Fortune 500) showed 28% faster time-to-market compared to traditional methods (p=0.003)"
❌ BAD: "Agile improved performance"

═══════════════════════════════════════════════════════════════════════════════
VALUE EXTRACTION - BE PRECISE
═══════════════════════════════════════════════════════════════════════════════

QUANTITATIVE VALUES (use EXACT format from paper):
- Percentages: "24%", "34.5%"
- Correlations: "r=0.67", "r²=0.45"
- Regression coefficients: "β=0.34", "B=2.1"
- Effect sizes: "d=0.8", "η²=0.12", "g=0.65"
- Odds/Risk ratios: "OR=2.3", "RR=1.5", "HR=0.7"
- Statistical tests: "t(198)=3.45", "F(2,97)=4.56", "χ²=15.3"
- Sample sizes: "N=500", "n=45 per group"
- Means with variability: "M=3.4 (SD=1.2)", "mean=45.2±8.3"
- Confidence intervals: "95% CI [1.5-3.4]"
- p-values: "p<0.001", "p=0.034", "ns" (for null results)

QUALITATIVE COUNTS (still use numbers):
- "3 themes identified", "5 of 8 participants", "12 instances coded"
- "4 categories emerged", "majority (7 of 10) reported"

DO NOT put words as values:
❌ "significant", "large effect", "positive", "strong"
These go in 'direction' or 'effectSizeInterpretation', NOT 'value'

═══════════════════════════════════════════════════════════════════════════════
EXTRACTION BY PAPER TYPE
═══════════════════════════════════════════════════════════════════════════════

For EMPIRICAL QUANTITATIVE papers:
- Each statistical result with COMPLETE details (test statistic, df, p-value)
- Sample size AND characteristics (demographics, selection criteria)
- Each comparison between groups with effect sizes
- Confidence intervals when reported
- Null results (no significant effect) - these are important!
- Power analyses if mentioned

For EMPIRICAL QUALITATIVE papers:
- Each theme/category with participant counts
- Illustrative quotes that capture key insights
- Methodology details (interview duration, coding approach)
- Contextual factors affecting findings
- Saturation/coverage information

For THEORETICAL papers:
- Each proposition or argument (numbered if possible)
- Relationships proposed between concepts
- Critiques of existing theories (with specific targets)
- Novel contributions clearly distinguished

For REVIEW/META-ANALYSIS papers:
- Number of studies included/analyzed
- Summary statistics (pooled effect sizes, heterogeneity I²)
- "X of Y studies found..." statistics
- Identified gaps and future directions

═══════════════════════════════════════════════════════════════════════════════
STATISTICAL PRECISION - CAPTURE FULL DETAILS
═══════════════════════════════════════════════════════════════════════════════

When a paper reports statistics, capture ALL components:
- Main statistic AND p-value: "β=0.34, p<0.01"
- Effect size AND interpretation: "d=0.8 (large effect)"
- Confidence intervals: "OR=2.3, 95% CI [1.5-3.4]"
- Sample sizes for each group: "treatment (n=45) vs control (n=43)"

Use the statisticalPrecision field for:
- confidenceInterval: "95% CI [1.5-3.4]"
- pValue: "p<0.001" or "p=0.034"
- effectSizeInterpretation: "small", "medium", "large", or "not_applicable"

═══════════════════════════════════════════════════════════════════════════════
DO NOT
═══════════════════════════════════════════════════════════════════════════════

- Summarize multiple findings into one vague statement
- Skip "minor" findings - they matter for synthesis
- Paraphrase evidence - use EXACT quotes
- Invent findings not explicitly in the text
- Use vague language when specific data exists
- Put non-numeric words in the 'value' field`

function buildPrompt(text: string): string {
  return `Extract ALL findings from this paper. Aim for 8-15+ findings with MAXIMUM SPECIFICITY.

---
${text}
---

═══════════════════════════════════════════════════════════════════════════════
EXTRACTION CHECKLIST - Verify completeness based on paper type
═══════════════════════════════════════════════════════════════════════════════

FOR QUANTITATIVE RESEARCH (surveys, experiments, datasets):
□ Sample size AND characteristics (who, how selected, demographics)?
□ Each statistical result with COMPLETE details (test, df, p-value, effect size)?
□ Confidence intervals where reported?
□ Comparisons between groups/conditions?
□ Null results (no significant effect)?
□ Power analysis if mentioned?

FOR QUALITATIVE RESEARCH (interviews, observations, case studies):
□ Number of participants/cases/texts analyzed?
□ Each theme/category identified (with frequency if mentioned)?
□ Illustrative quotes capturing key insights?
□ Contextual factors affecting findings?
□ Methodology details (duration, approach)?

FOR THEORETICAL WORK (arguments, frameworks, propositions):
□ Each proposition or claim made (numbered if possible)?
□ Relationships proposed between concepts?
□ Critiques of existing theories (naming specific targets)?
□ Novel contributions clearly identified?

FOR REVIEWS/META-ANALYSES:
□ Number of studies included?
□ Pooled effect sizes and heterogeneity?
□ "X of Y studies found..." statistics?
□ Identified gaps and limitations?

═══════════════════════════════════════════════════════════════════════════════
SPECIFICITY SELF-CHECK
═══════════════════════════════════════════════════════════════════════════════

Before submitting each finding, verify:
□ Does the claim specify WHO/WHAT was studied?
□ Does the claim include specific MAGNITUDE/EXTENT (not just "significant")?
□ Does the claim include CONTEXT (conditions, population, time)?
□ Is the value field a NUMBER (not a word like "significant")?
□ Is the evidence field an EXACT quote (not paraphrased)?

Remember: 
- "A (24%), B (18%), C (12%)" = 3 separate findings, not 1
- "significant" belongs in direction field, the ACTUAL statistic goes in value field
- When in doubt, extract more findings rather than fewer

Extract the ACTUAL title (not journal name), all authors, and be exhaustive with findings.`
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
    })
    
    // Transform to our types with IDs
    const findings: Finding[] = object.findings.map(f => ({
      id: uuidv4(),
      claim: f.claim,
      evidence: f.evidence,
      value: f.value ?? undefined,
      valueType: f.valueType ?? undefined,
      direction: f.direction ?? undefined,
      comparedTo: f.comparedTo ?? undefined,
      context: f.context ?? undefined,
      isMainFinding: f.isMainFinding,
      confidence: f.confidence,
      // NEW: Statistical precision
      statisticalPrecision: f.statisticalPrecision ? {
        confidenceInterval: f.statisticalPrecision.confidenceInterval ?? undefined,
        pValue: f.statisticalPrecision.pValue ?? undefined,
        effectSizeInterpretation: f.statisticalPrecision.effectSizeInterpretation ?? undefined
      } : undefined,
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
