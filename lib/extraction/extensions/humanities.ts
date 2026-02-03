/**
 * Humanities Extension Extractor
 * 
 * Extracts structured data specific to humanities papers:
 * - Analysis approach (literary, historical, philosophical, etc.)
 * - Primary sources analyzed
 * - Interpretive claims and arguments
 * - Theoretical lens used
 * - Scholarly dialogue
 * 
 * @module lib/extraction/extensions/humanities
 */

import { generateObject } from 'ai'
import { z } from 'zod'
import { getLanguageModel } from '@/lib/ai/vercel-client'
import { v4 as uuidv4 } from 'uuid'
import type {
  HumanitiesExtension,
  InterpretiveClaim,
  HumanitiesApproach
} from '../types'

// =============================================================================
// Zod Schemas
// =============================================================================

const InterpretiveClaimSchema = z.object({
  claim: z.string().describe('The interpretive claim being made'),
  argument: z.string().describe('The argument supporting the claim'),
  evidence: z.array(z.string()).describe('Textual/historical evidence cited'),
  counterArguments: z.array(z.string()).optional().describe('Addressed counterarguments'),
  confidence: z.number().min(0).max(1)
})

const HumanitiesExtractionSchema = z.object({
  // Approach
  analysisApproach: z.enum([
    'literary_analysis', 'historical_analysis', 'philosophical_analysis',
    'cultural_analysis', 'rhetorical_analysis', 'critical_theory',
    'hermeneutics', 'comparative_analysis', 'archival_research',
    'textual_criticism', 'other'
  ]),
  theoreticalLens: z.string().optional().describe('Theoretical framework applied'),
  
  // Sources
  primarySources: z.array(z.string()).describe('Primary texts/artifacts analyzed'),
  primarySourcePeriod: z.string().optional().describe('Historical period'),
  
  // Analysis
  interpretiveClaims: z.array(InterpretiveClaimSchema).describe('Main interpretive claims'),
  centralArgument: z.string().describe('The central argument of the paper'),
  
  // Contextualization
  historicalContext: z.string().optional(),
  culturalContext: z.string().optional(),
  
  // Scholarly conversation
  dialogueWith: z.array(z.string()).optional().describe('Scholars/works in dialogue with'),
  revisionsTo: z.array(z.string()).optional().describe('Interpretations this revises'),
  
  // Overall
  extractionConfidence: z.number().min(0).max(1)
})

// =============================================================================
// Humanities Extraction Function
// =============================================================================

export interface HumanitiesExtractionInput {
  paperId: string
  title: string
  abstract?: string
  fullText?: string
}

export interface HumanitiesExtractionOptions {
  maxFullTextTokens?: number
  timeoutMs?: number
}

/**
 * Extract humanities-specific data from a research paper
 */
export async function extractHumanities(
  input: HumanitiesExtractionInput,
  options: HumanitiesExtractionOptions = {}
): Promise<HumanitiesExtension> {
  const startTime = Date.now()
  const { maxFullTextTokens = 10000 } = options
  
  const textForExtraction = prepareHumanitiesText(
    input.title,
    input.abstract,
    input.fullText,
    maxFullTextTokens
  )
  
  try {
    const { object } = await generateObject({
      model: getLanguageModel(),
      schema: HumanitiesExtractionSchema,
      system: HUMANITIES_SYSTEM_PROMPT,
      prompt: buildHumanitiesPrompt(input, textForExtraction),
      temperature: 0.1,
    })
    
    // Transform with IDs
    const interpretiveClaims: InterpretiveClaim[] = object.interpretiveClaims.map(c => ({
      id: uuidv4(),
      claim: c.claim,
      argument: c.argument,
      evidence: c.evidence,
      counterArguments: c.counterArguments,
      confidence: c.confidence
    }))
    
    const extractionTime = Date.now() - startTime
    console.log(`📜 Humanities extraction completed in ${extractionTime}ms`)
    console.log(`   📖 Approach: ${object.analysisApproach}`)
    console.log(`   ✍️ Found ${interpretiveClaims.length} interpretive claims`)
    
    return {
      paperId: input.paperId,
      analysisApproach: object.analysisApproach as HumanitiesApproach,
      theoreticalLens: object.theoreticalLens,
      primarySources: object.primarySources,
      primarySourcePeriod: object.primarySourcePeriod,
      interpretiveClaims,
      centralArgument: object.centralArgument,
      historicalContext: object.historicalContext,
      culturalContext: object.culturalContext,
      dialogueWith: object.dialogueWith,
      revisionsTo: object.revisionsTo,
      extractionConfidence: object.extractionConfidence
    }
  } catch (error) {
    console.error('Humanities extraction failed:', error)
    throw error
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function prepareHumanitiesText(
  title: string,
  abstract?: string,
  fullText?: string,
  maxTokens: number = 10000
): string {
  const parts: string[] = []
  
  parts.push(`TITLE: ${title}`)
  
  if (abstract) {
    parts.push(`\nABSTRACT:\n${abstract}`)
  }
  
  if (fullText) {
    // For humanities, the whole argument matters - take introduction and conclusion heavily
    const introSection = extractSection(fullText, ['introduction'])
    const analysisSection = extractSection(fullText, ['analysis', 'reading', 'interpretation', 'argument'])
    const conclusionSection = extractSection(fullText, ['conclusion'])
    
    const abstractTokens = abstract ? Math.ceil(abstract.length / 4) : 0
    const remainingTokens = maxTokens - abstractTokens - 50
    const totalChars = remainingTokens * 4
    
    if (introSection) {
      parts.push(`\n[INTRODUCTION]\n${introSection.slice(0, totalChars * 0.3)}${introSection.length > totalChars * 0.3 ? '...' : ''}`)
    }
    
    if (analysisSection) {
      parts.push(`\n[ANALYSIS]\n${analysisSection.slice(0, totalChars * 0.5)}${analysisSection.length > totalChars * 0.5 ? '...' : ''}`)
    }
    
    if (conclusionSection) {
      parts.push(`\n[CONCLUSION]\n${conclusionSection.slice(0, totalChars * 0.2)}${conclusionSection.length > totalChars * 0.2 ? '...' : ''}`)
    }
    
    if (!introSection && !analysisSection) {
      parts.push(`\n[FULL TEXT EXCERPT]\n${fullText.slice(0, totalChars)}${fullText.length > totalChars ? '...' : ''}`)
    }
  }
  
  return parts.join('\n')
}

function extractSection(fullText: string, sectionNames: string[]): string | null {
  for (const name of sectionNames) {
    const patterns = [
      new RegExp(`(?:^|\\n)(?:\\d+\\.?\\s*)?${name}[:\\s]*\\n([\\s\\S]*?)(?=\\n(?:\\d+\\.?\\s*)?(?:conclusion|reference|note|bibliography|work cited)|\\n\\n\\n|$)`, 'i'),
      new RegExp(`(?:^|\\n)#+ ?${name}[:\\s]*\\n([\\s\\S]*?)(?=\\n#+|$)`, 'i')
    ]
    
    for (const pattern of patterns) {
      const match = fullText.match(pattern)
      if (match && match[1] && match[1].trim().length > 100) {
        return match[1].trim()
      }
    }
  }
  return null
}

function buildHumanitiesPrompt(
  input: HumanitiesExtractionInput,
  textForExtraction: string
): string {
  return `Extract humanities scholarship details from this paper.

${textForExtraction}

---

EXTRACTION INSTRUCTIONS:
1. Identify the analysis approach (literary, historical, philosophical, etc.)
2. Note any theoretical lens or framework applied
3. List the primary sources analyzed
4. Extract ALL interpretive claims with:
   - The claim itself
   - The argument supporting it
   - Evidence from primary sources
   - Any counterarguments addressed
5. Identify the central argument
6. Note the scholarly conversation (who the author dialogues with)

Focus on the INTERPRETIVE moves made by the author - not just what they describe, but what they ARGUE.`
}

const HUMANITIES_SYSTEM_PROMPT = `You are an expert humanities scholar specializing in extracting arguments from literary, historical, philosophical, and cultural analysis papers.

Your task is to identify and extract:
1. APPROACH: What kind of analysis is being performed?
   - Literary analysis: Close reading, genre analysis, narrative analysis
   - Historical analysis: Archival research, historiography
   - Philosophical analysis: Conceptual analysis, ethics, epistemology
   - Cultural analysis: Cultural studies, media analysis
   - Rhetorical analysis: Persuasion, discourse
   - Critical theory: Marxist, feminist, postcolonial, queer theory, etc.

2. THEORETICAL LENS: What framework shapes the interpretation?
   - E.g., Foucauldian, deconstructionist, New Historicist, feminist, etc.

3. PRIMARY SOURCES: What texts/artifacts are analyzed?

4. INTERPRETIVE CLAIMS: What does the author argue?
   - An interpretive claim makes an argument about meaning, significance, or effect
   - Must be supported by evidence from primary sources
   - Often challenges or revises previous interpretations

5. SCHOLARLY CONVERSATION: Who does this engage with?
   - Other scholars' interpretations
   - Theoretical debates

CRITICAL DISTINCTIONS:
- Description (what the text says) vs. Interpretation (what it means)
- Summary (recounting) vs. Argument (making a case)
- Observation vs. Claim

Extract the ARGUMENTS, not just descriptions. Focus on what is being CLAIMED and how it's SUPPORTED.`
