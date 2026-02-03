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

const SYSTEM_PROMPT = `You are an expert academic reader. Your task is to extract findings and information from a research paper.

CRITICAL INSTRUCTIONS:

1. READ THE ACTUAL TEXT - Don't assume or infer. Extract what's explicitly stated.

2. FINDINGS: Extract ALL findings, results, and claims the paper makes. For each:
   - State the finding clearly
   - Include a direct quote as evidence
   - If there's a number/statistic, capture it exactly as written
   - Note what type of value it is (percentage, effect size, count, etc.)
   - Indicate if the relationship is positive, negative, null, or just descriptive

3. METADATA: 
   - Title: Find the ACTUAL paper title, not the journal name
   - Authors: List the actual author names
   - Domain: What field is this? (be specific)
   - Methodology: How did they do the research?

4. BE SPECIFIC: 
   - Don't write generic academic phrases
   - Use actual details from the paper
   - Quote specific numbers, names, places

5. HANDLE UNCERTAINTY:
   - If something isn't clear, say so in extractionNotes
   - Don't invent information
   - Use null for fields you can't determine

6. INCLUDE EVERYTHING:
   - Main findings AND secondary findings
   - Mark which are main (isMainFinding: true) vs secondary (false)
   - Sample sizes, methods, populations - these are findings too`

function buildPrompt(text: string): string {
  return `Extract all findings and information from this paper:

---
${text}
---

Remember:
- Extract the ACTUAL title (not journal name)
- Include ALL findings with direct quote evidence
- Capture exact values/statistics as written
- Be specific about context and methodology
- Mark main findings vs secondary findings`
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
