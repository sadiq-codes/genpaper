/**
 * Core Extractor
 * 
 * Extracts universal fields from ALL papers regardless of type:
 * - Research question/objectives
 * - Main claims and findings
 * - Methodology summary
 * - Key contributions
 * - Limitations
 * - Context (domain, geographic, temporal)
 * 
 * @module lib/extraction/core-extractor
 */

import { generateObject } from 'ai'
import { z } from 'zod'
import { getLanguageModel } from '@/lib/ai/vercel-client'
import { v4 as uuidv4 } from 'uuid'
import type {
  CoreExtraction,
  Claim,
  ClaimType,
  PaperSection,
  ResearchContext,
  PaperTypeClassification,
  ExtractionMetadata,
  ConfidenceLevel
} from './types'

// =============================================================================
// Extraction Schemas (Zod)
// =============================================================================

const ClaimSchema = z.object({
  text: z.string().describe('The claim statement'),
  type: z.enum(['finding', 'argument', 'hypothesis', 'conclusion', 'limitation', 'implication', 'future_work', 'background']),
  evidenceQuote: z.string().optional().describe('Direct quote from paper supporting this claim'),
  section: z.enum(['abstract', 'introduction', 'literature_review', 'theory', 'methodology', 'results', 'discussion', 'conclusion', 'unknown']),
  confidence: z.number().min(0).max(1).describe('How confident you are in this extraction')
})

const ResearchContextSchema = z.object({
  domain: z.string().describe('Primary research domain (e.g., entrepreneurship, oncology, psychology)'),
  subDomain: z.string().optional().describe('More specific area within domain'),
  geographic: z.string().optional().describe('Geographic context of the research'),
  temporal: z.object({
    period: z.string().optional().describe('Time period studied'),
    dataCollectionYear: z.number().optional()
  }).optional(),
  population: z.string().optional().describe('Target population or sample type'),
  setting: z.string().optional().describe('Research setting (e.g., hospital, university, corporation)')
})

const CoreExtractionSchema = z.object({
  // Research identification
  researchQuestion: z.string().optional().describe('Main research question if explicitly stated'),
  objectives: z.array(z.string()).describe('Research objectives or aims'),
  
  // Claims
  mainClaims: z.array(ClaimSchema).describe('Primary claims, findings, or arguments made in the paper'),
  
  // Contributions
  keyContributions: z.array(z.string()).describe('Novel contributions this paper makes to the field'),
  
  // Methodology (high-level)
  methodologySummary: z.string().describe('Brief description of research methodology'),
  dataSource: z.string().optional().describe('What data was used (if applicable)'),
  
  // Context
  context: ResearchContextSchema,
  
  // Limitations and future work
  limitations: z.array(z.string()).describe('Acknowledged limitations'),
  futureWork: z.array(z.string()).describe('Suggested future research directions'),
  
  // Quality indicators
  peerReviewed: z.boolean().optional().describe('Is this likely peer-reviewed?'),
  
  // Extraction quality
  overallConfidence: z.number().min(0).max(1).describe('Overall confidence in extraction quality')
})

// =============================================================================
// Core Extraction Function
// =============================================================================

export interface CoreExtractionInput {
  paperId: string
  title: string
  abstract?: string
  fullText?: string
  classification: PaperTypeClassification
  metadata?: {
    authors?: string[]
    year?: number
    venue?: string
    doi?: string
    citationCount?: number
  }
}

export interface CoreExtractionOptions {
  /** Maximum tokens to use from full text */
  maxFullTextTokens?: number
  /** Model to use for extraction */
  model?: string
  /** Timeout in milliseconds */
  timeoutMs?: number
}

/**
 * Extract core fields from any academic paper
 * 
 * @param input Paper data for extraction
 * @param options Extraction options
 * @returns Core extraction result
 */
export async function extractCore(
  input: CoreExtractionInput,
  options: CoreExtractionOptions = {}
): Promise<CoreExtraction> {
  const startTime = Date.now()
  const { maxFullTextTokens = 8000 } = options
  
  // Prepare text for extraction
  const textForExtraction = prepareTextForExtraction(
    input.title,
    input.abstract,
    input.fullText,
    maxFullTextTokens
  )
  
  // Build context-aware system prompt based on paper type
  const systemPrompt = buildSystemPrompt(input.classification)
  
  try {
    const { object } = await generateObject({
      model: getLanguageModel(),
      schema: CoreExtractionSchema,
      system: systemPrompt,
      prompt: buildExtractionPrompt(input, textForExtraction),
      temperature: 0.1, // Low temperature for consistent extraction
    })
    
    // Transform to our type with IDs
    const claims: Claim[] = object.mainClaims.map(claim => ({
      id: uuidv4(),
      text: claim.text,
      type: claim.type as ClaimType,
      evidenceQuote: claim.evidenceQuote,
      section: claim.section as PaperSection,
      confidence: claim.confidence
    }))
    
    const context: ResearchContext = {
      domain: object.context.domain,
      subDomain: object.context.subDomain,
      geographic: object.context.geographic,
      temporal: object.context.temporal,
      population: object.context.population,
      setting: object.context.setting
    }
    
    const extractionTime = Date.now() - startTime
    
    const metadata: ExtractionMetadata = {
      extractionVersion: '1.0.0',
      extractedAt: new Date(),
      modelUsed: options.model || 'gpt-4o',
      extractionTimeMs: extractionTime,
      overallConfidence: object.overallConfidence,
      warnings: generateWarnings(object, input)
    }
    
    console.log(`📝 Core extraction completed for "${input.title.slice(0, 50)}..." in ${extractionTime}ms`)
    console.log(`   📊 Found ${claims.length} claims, ${object.keyContributions.length} contributions, ${object.limitations.length} limitations`)
    
    return {
      paperId: input.paperId,
      paperType: input.classification,
      title: input.title,
      researchQuestion: object.researchQuestion,
      objectives: object.objectives,
      mainClaims: claims,
      keyContributions: object.keyContributions,
      methodologySummary: object.methodologySummary,
      dataSource: object.dataSource,
      context,
      limitations: object.limitations,
      futureWork: object.futureWork,
      peerReviewed: object.peerReviewed,
      citationCount: input.metadata?.citationCount,
      extractionMetadata: metadata
    }
  } catch (error) {
    console.error('Core extraction failed:', error)
    
    // Return minimal extraction on failure
    return createMinimalExtraction(input, startTime, error)
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Prepare text for extraction, balancing completeness with token limits
 */
function prepareTextForExtraction(
  title: string,
  abstract?: string,
  fullText?: string,
  maxTokens: number = 8000
): string {
  const parts: string[] = []
  
  parts.push(`TITLE: ${title}`)
  
  if (abstract) {
    parts.push(`\nABSTRACT:\n${abstract}`)
  }
  
  if (fullText) {
    // Estimate tokens (rough: 4 chars per token)
    const abstractTokens = abstract ? Math.ceil(abstract.length / 4) : 0
    const titleTokens = Math.ceil(title.length / 4)
    const remainingTokens = maxTokens - abstractTokens - titleTokens - 100 // buffer
    
    if (remainingTokens > 500) {
      // Extract key sections from full text
      const extractedSections = extractKeySections(fullText, remainingTokens * 4)
      if (extractedSections) {
        parts.push(`\nFULL TEXT EXCERPTS:\n${extractedSections}`)
      }
    }
  }
  
  return parts.join('\n')
}

/**
 * Extract key sections from full text for extraction
 */
function extractKeySections(fullText: string, maxChars: number): string {
  const sections: string[] = []
  let charCount = 0
  
  // Priority order for extraction
  const sectionPatterns = [
    { name: 'INTRODUCTION', pattern: /(?:^|\n)(?:1\.?\s*)?introduction[:\s]*\n([\s\S]*?)(?=\n(?:\d\.?\s*)?(?:literature|background|method|theory|related|approach)|\n\n\n)/i },
    { name: 'CONCLUSION', pattern: /(?:^|\n)(?:\d\.?\s*)?conclusion[s]?[:\s]*\n([\s\S]*?)(?=\n(?:\d\.?\s*)?(?:reference|acknowledge|appendix)|\n\n\n|$)/i },
    { name: 'RESULTS/FINDINGS', pattern: /(?:^|\n)(?:\d\.?\s*)?(?:results?|findings?)[:\s]*\n([\s\S]*?)(?=\n(?:\d\.?\s*)?(?:discussion|conclusion|limitation)|\n\n\n)/i },
    { name: 'DISCUSSION', pattern: /(?:^|\n)(?:\d\.?\s*)?discussion[:\s]*\n([\s\S]*?)(?=\n(?:\d\.?\s*)?(?:conclusion|limitation|implication|reference)|\n\n\n)/i },
    { name: 'METHODOLOGY', pattern: /(?:^|\n)(?:\d\.?\s*)?(?:method|methodology|research design)[s]?[:\s]*\n([\s\S]*?)(?=\n(?:\d\.?\s*)?(?:result|finding|data|analysis)|\n\n\n)/i },
  ]
  
  for (const { name, pattern } of sectionPatterns) {
    const match = fullText.match(pattern)
    if (match && match[1]) {
      const sectionText = match[1].trim()
      const truncated = sectionText.slice(0, Math.min(1500, maxChars - charCount))
      
      if (truncated.length > 100) {
        sections.push(`[${name}]\n${truncated}${truncated.length < sectionText.length ? '...' : ''}`)
        charCount += truncated.length + name.length + 10
      }
      
      if (charCount >= maxChars * 0.9) break
    }
  }
  
  // If we couldn't find sections, just take chunks from start and end
  if (sections.length === 0) {
    const startChunk = fullText.slice(0, Math.floor(maxChars / 2))
    const endChunk = fullText.slice(-Math.floor(maxChars / 3))
    sections.push(`[START OF PAPER]\n${startChunk}...\n\n[END OF PAPER]\n...${endChunk}`)
  }
  
  return sections.join('\n\n')
}

/**
 * Build system prompt based on paper type
 */
function buildSystemPrompt(classification: PaperTypeClassification): string {
  const basePrompt = `You are an expert academic paper analyst specializing in extracting structured information from research papers.

Your task is to extract key information that is universal across all academic papers:
- Research questions and objectives
- Main claims, findings, or arguments
- Key contributions to the field
- Methodology summary
- Research context (domain, geography, population)
- Limitations acknowledged by authors
- Future research directions suggested

EXTRACTION GUIDELINES:
1. Extract ONLY what is explicitly stated or strongly implied in the paper
2. Do NOT infer or make assumptions beyond the text
3. Use direct quotes when possible for evidence
4. Assign confidence scores honestly - lower is better than overconfident
5. If information is not present, omit it rather than guess
6. Distinguish between findings (empirical results) and arguments (theoretical claims)
7. Capture the AUTHORS' claims, not your evaluation of them`

  // Add type-specific guidance
  const typeGuidance: Record<string, string> = {
    'quantitative': `\n\nThis appears to be a QUANTITATIVE paper. Focus on:
- Statistical findings and effect sizes when stated
- Sample characteristics
- Variables studied
- Empirical conclusions`,
    
    'qualitative': `\n\nThis appears to be a QUALITATIVE paper. Focus on:
- Themes and patterns identified
- Participant perspectives
- Interpretive insights
- Contextual factors`,
    
    'theoretical': `\n\nThis appears to be a THEORETICAL paper. Focus on:
- Theoretical propositions
- Conceptual arguments
- Framework contributions
- Critique of existing theory`,
    
    'review': `\n\nThis appears to be a REVIEW paper. Focus on:
- Synthesis of existing literature
- Patterns identified across studies
- Research gaps
- Future research agenda`,
    
    'humanities': `\n\nThis appears to be a HUMANITIES paper. Focus on:
- Interpretive arguments
- Textual/historical analysis
- Critical perspectives
- Scholarly contributions`,
    
    'mixed_methods': `\n\nThis appears to be a MIXED METHODS paper. Focus on:
- Both quantitative findings AND qualitative insights
- How methods were integrated
- Unique contributions from mixed approach`
  }
  
  return basePrompt + (typeGuidance[classification.primaryType] || '')
}

/**
 * Build the extraction prompt
 */
function buildExtractionPrompt(
  input: CoreExtractionInput,
  textForExtraction: string
): string {
  const metadataContext = input.metadata 
    ? `\nMETADATA:
- Authors: ${input.metadata.authors?.join(', ') || 'Unknown'}
- Year: ${input.metadata.year || 'Unknown'}
- Venue: ${input.metadata.venue || 'Unknown'}
- DOI: ${input.metadata.doi || 'Unknown'}
- Citations: ${input.metadata.citationCount || 'Unknown'}`
    : ''
  
  return `Extract structured information from this academic paper.
${metadataContext}

PAPER TYPE: ${input.classification.primaryType}${input.classification.secondaryType ? ` (secondary: ${input.classification.secondaryType})` : ''}
CLASSIFICATION CONFIDENCE: ${input.classification.confidence}

---

${textForExtraction}

---

Extract the core information following the schema. Be precise and cite evidence where possible.`
}

/**
 * Generate warnings based on extraction quality
 */
function generateWarnings(
  extraction: z.infer<typeof CoreExtractionSchema>,
  input: CoreExtractionInput
): string[] {
  const warnings: string[] = []
  
  // Check for missing important fields
  if (!extraction.researchQuestion && !extraction.objectives.length) {
    warnings.push('No research question or objectives identified')
  }
  
  if (extraction.mainClaims.length === 0) {
    warnings.push('No main claims extracted - paper may lack clear findings')
  }
  
  if (extraction.keyContributions.length === 0) {
    warnings.push('No key contributions identified')
  }
  
  if (!extraction.methodologySummary || extraction.methodologySummary.length < 20) {
    warnings.push('Methodology summary is minimal or missing')
  }
  
  if (!input.fullText && !input.abstract) {
    warnings.push('Extraction based on title only - low quality expected')
  } else if (!input.fullText) {
    warnings.push('Extraction based on abstract only - some details may be missing')
  }
  
  // Check claim quality
  const lowConfidenceClaims = extraction.mainClaims.filter(c => c.confidence < 0.5)
  if (lowConfidenceClaims.length > extraction.mainClaims.length / 2) {
    warnings.push('Many claims have low confidence - review recommended')
  }
  
  return warnings
}

/**
 * Create minimal extraction when full extraction fails
 */
function createMinimalExtraction(
  input: CoreExtractionInput,
  startTime: number,
  error: unknown
): CoreExtraction {
  const extractionTime = Date.now() - startTime
  
  return {
    paperId: input.paperId,
    paperType: input.classification,
    title: input.title,
    objectives: [],
    mainClaims: [],
    keyContributions: [],
    methodologySummary: 'Extraction failed - methodology unknown',
    context: {
      domain: 'unknown'
    },
    limitations: [],
    futureWork: [],
    extractionMetadata: {
      extractionVersion: '1.0.0',
      extractedAt: new Date(),
      modelUsed: 'none - extraction failed',
      extractionTimeMs: extractionTime,
      overallConfidence: 0,
      warnings: [
        'Extraction failed',
        error instanceof Error ? error.message : 'Unknown error'
      ]
    }
  }
}

// =============================================================================
// Batch Extraction
// =============================================================================

export interface BatchExtractionProgress {
  total: number
  completed: number
  failed: number
  currentPaper?: string
}

/**
 * Extract core fields from multiple papers
 * 
 * @param inputs Array of paper inputs
 * @param options Extraction options
 * @param onProgress Progress callback
 * @returns Array of extraction results
 */
export async function extractCoreBatch(
  inputs: CoreExtractionInput[],
  options: CoreExtractionOptions = {},
  onProgress?: (progress: BatchExtractionProgress) => void
): Promise<CoreExtraction[]> {
  const results: CoreExtraction[] = []
  let completed = 0
  let failed = 0
  
  for (const input of inputs) {
    try {
      onProgress?.({
        total: inputs.length,
        completed,
        failed,
        currentPaper: input.title
      })
      
      const extraction = await extractCore(input, options)
      results.push(extraction)
      completed++
    } catch (error) {
      console.error(`Failed to extract core from "${input.title}":`, error)
      failed++
      results.push(createMinimalExtraction(input, Date.now(), error))
    }
  }
  
  onProgress?.({
    total: inputs.length,
    completed,
    failed
  })
  
  console.log(`📊 Batch core extraction: ${completed}/${inputs.length} successful, ${failed} failed`)
  
  return results
}
