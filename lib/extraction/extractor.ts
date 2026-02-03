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
import { getLanguageModel } from '@/lib/ai/vercel-client'
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
  claim: z.string().describe('The finding or claim statement'),
  evidence: z.string().describe('Direct quote from the paper supporting this finding'),
  value: z.string().nullable().describe('Any quantitative value (e.g., "24%", "β=0.34", "n=200", "p<0.01"). null if not quantitative'),
  valueType: z.string().nullable().describe('What kind of value this is (e.g., "percentage", "correlation", "sample size", "effect size"). null if no value'),
  direction: z.string().nullable().describe('Nature of finding: "positive", "negative", "no effect", "mixed", or "descriptive" for non-directional findings'),
  comparedTo: z.string().nullable().describe('What this finding compares against, null if not comparative'),
  context: z.string().nullable().describe('Specific context: population, setting, time period, conditions'),
  isMainFinding: z.boolean().describe('true if this is a primary/main result, false if secondary/background'),
  confidence: z.number().min(0).max(1).describe('How confident you are in this extraction (0-1)')
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

YOUR GOAL: Extract EVERY piece of evidence that could be cited in a literature review.

FINDINGS - BE EXHAUSTIVE:
Extract AT LEAST 8-15 findings per paper. A typical paper contains many extractable findings:

For EMPIRICAL papers, extract:
- Each statistical result (with exact numbers)
- Sample size and characteristics
- Each variable/factor studied
- Each comparison between groups
- Each correlation or relationship found
- Methodology details (instruments, measures used)
- Each species/entity/category identified (if applicable)
- Geographic/temporal scope
- Any null results (no significant effect)

For THEORETICAL papers, extract:
- Each proposition or argument made
- Each concept defined or introduced
- Each relationship proposed between concepts
- Each critique of existing theories
- Historical context provided
- Each example or case used as evidence

For REVIEW papers, extract:
- Key synthesis claims
- Statistics about the literature (X of Y studies found...)
- Identified gaps
- Methodological observations

WHAT COUNTS AS A FINDING:
- "The sample consisted of 200 participants" → Finding (sample size)
- "Bacillus subtilis (24%), E. coli (18%), S. aureus (12%)" → 3 separate findings
- "No significant difference was found between groups" → Finding (null result)
- "Data was collected from 2010-2015" → Finding (temporal scope)
- "The authors argue that X leads to Y" → Finding (theoretical claim)

REQUIREMENTS FOR EACH FINDING:
1. claim: Clear statement of what was found
2. evidence: EXACT quote from paper (copy-paste, not paraphrase)
3. value: Any number/statistic exactly as written (null if qualitative)
4. valueType: What the number represents
5. isMainFinding: true = key result, false = supporting data
6. confidence: How certain you are (0.7-1.0)

DO NOT:
- Summarize multiple findings into one
- Skip "minor" findings - they matter for synthesis
- Paraphrase evidence - use exact quotes
- Invent findings not in the text`

function buildPrompt(text: string): string {
  return `Extract ALL findings from this paper. Aim for 8-15+ findings.

---
${text}
---

CHECKLIST - Have you extracted:
□ Sample size/characteristics?
□ Each quantitative result with exact numbers?
□ Each entity/category identified (species, factors, variables)?
□ Comparisons between groups/conditions?
□ Geographic and temporal scope?
□ Null results (no effect found)?
□ Methodology details?
□ Each theoretical claim/proposition?

Remember: If a paper mentions "A (24%), B (18%), C (12%)" - that's 3 separate findings, not 1.

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
      model: getLanguageModel(),
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
      confidence: f.confidence
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
