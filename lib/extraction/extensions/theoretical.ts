/**
 * Theoretical Extension Extractor
 * 
 * Extracts structured data specific to theoretical/conceptual papers:
 * - Type of theoretical contribution
 * - Concepts and definitions
 * - Propositions and relationships
 * - Theoretical framework description
 * - Scope conditions
 * 
 * @module lib/extraction/extensions/theoretical
 */

import { generateObject } from 'ai'
import { z } from 'zod'
import { getLanguageModel } from '@/lib/ai/vercel-client'
import { v4 as uuidv4 } from 'uuid'
import type {
  TheoreticalExtension,
  TheoreticalConcept,
  Proposition,
  TheoreticalContributionType
} from '../types'

// =============================================================================
// Zod Schemas
// =============================================================================

const ConceptSchema = z.object({
  name: z.string().describe('Concept name'),
  definition: z.string().describe('How the concept is defined'),
  dimensions: z.array(z.string()).optional().describe('Sub-dimensions of the concept'),
  relatedConcepts: z.array(z.string()).optional().describe('Names of related concepts'),
  sourceTheory: z.string().optional().describe('If borrowed from another theory')
})

const PropositionSchema = z.object({
  statement: z.string().describe('The proposition statement'),
  type: z.enum(['axiom', 'proposition', 'hypothesis', 'corollary']),
  concepts: z.array(z.string()).describe('Concept names involved'),
  relationship: z.string().optional().describe('Nature of the relationship'),
  conditions: z.array(z.string()).optional().describe('Boundary conditions'),
  supportingArgument: z.string().optional().describe('Brief argument supporting this')
})

const TheoreticalExtractionSchema = z.object({
  // Contribution type
  contributionType: z.enum([
    'new_theory', 'theory_extension', 'theory_integration',
    'theory_critique', 'framework_development', 'typology', 'model_development'
  ]),
  
  // Foundations
  buildsOn: z.array(z.string()).describe('Theories this work builds on'),
  critiqueOf: z.array(z.string()).optional().describe('Theories this work critiques'),
  
  // Core elements
  concepts: z.array(ConceptSchema).describe('Key concepts defined/developed'),
  propositions: z.array(PropositionSchema).describe('Theoretical propositions'),
  
  // Framework
  frameworkName: z.string().optional().describe('Name of the framework if given'),
  frameworkDescription: z.string().optional().describe('Description of the framework'),
  frameworkDiagram: z.string().optional().describe('Description of visual model if present'),
  
  // Scope
  scopeConditions: z.array(z.string()).optional().describe('Where the theory applies'),
  levelOfAnalysis: z.string().optional().describe('Level of analysis'),
  
  // Validation
  illustrativeExamples: z.array(z.string()).optional(),
  empiricalSupport: z.string().optional().describe('References to empirical support'),
  
  // Overall
  extractionConfidence: z.number().min(0).max(1)
})

// =============================================================================
// Theoretical Extraction Function
// =============================================================================

export interface TheoreticalExtractionInput {
  paperId: string
  title: string
  abstract?: string
  fullText?: string
}

export interface TheoreticalExtractionOptions {
  maxFullTextTokens?: number
  timeoutMs?: number
}

/**
 * Extract theoretical-specific data from a research paper
 */
export async function extractTheoretical(
  input: TheoreticalExtractionInput,
  options: TheoreticalExtractionOptions = {}
): Promise<TheoreticalExtension> {
  const startTime = Date.now()
  const { maxFullTextTokens = 10000 } = options
  
  const textForExtraction = prepareTheoreticalText(
    input.title,
    input.abstract,
    input.fullText,
    maxFullTextTokens
  )
  
  try {
    const { object } = await generateObject({
      model: getLanguageModel(),
      schema: TheoreticalExtractionSchema,
      system: THEORETICAL_SYSTEM_PROMPT,
      prompt: buildTheoreticalPrompt(input, textForExtraction),
      temperature: 0.1,
    })
    
    // Transform with IDs
    const concepts: TheoreticalConcept[] = object.concepts.map(c => ({
      id: uuidv4(),
      name: c.name,
      definition: c.definition,
      dimensions: c.dimensions,
      relatedConcepts: c.relatedConcepts,
      sourceTheory: c.sourceTheory
    }))
    
    const propositions: Proposition[] = object.propositions.map(p => ({
      id: uuidv4(),
      statement: p.statement,
      type: p.type,
      concepts: p.concepts,
      relationship: p.relationship,
      conditions: p.conditions,
      supportingArgument: p.supportingArgument
    }))
    
    const extractionTime = Date.now() - startTime
    console.log(`📚 Theoretical extraction completed in ${extractionTime}ms`)
    console.log(`   📖 Contribution: ${object.contributionType}`)
    console.log(`   🔤 Found ${concepts.length} concepts, ${propositions.length} propositions`)
    
    return {
      paperId: input.paperId,
      contributionType: object.contributionType as TheoreticalContributionType,
      buildsOn: object.buildsOn,
      critiqueOf: object.critiqueOf,
      concepts,
      propositions,
      frameworkName: object.frameworkName,
      frameworkDescription: object.frameworkDescription,
      frameworkDiagram: object.frameworkDiagram,
      scopeConditions: object.scopeConditions,
      levelOfAnalysis: object.levelOfAnalysis,
      illustrativeExamples: object.illustrativeExamples,
      empiricalSupport: object.empiricalSupport,
      extractionConfidence: object.extractionConfidence
    }
  } catch (error) {
    console.error('Theoretical extraction failed:', error)
    throw error
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function prepareTheoreticalText(
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
    // For theoretical papers, prioritize theory development sections
    const theorySection = extractSection(fullText, ['theory', 'theoretical', 'framework', 'conceptual', 'model'])
    const introSection = extractSection(fullText, ['introduction'])
    const discussionSection = extractSection(fullText, ['discussion', 'implications'])
    
    const abstractTokens = abstract ? Math.ceil(abstract.length / 4) : 0
    const remainingTokens = maxTokens - abstractTokens - 50
    const charsPerSection = (remainingTokens * 4) / 3
    
    if (theorySection) {
      parts.push(`\n[THEORY SECTION]\n${theorySection.slice(0, charsPerSection * 1.5)}${theorySection.length > charsPerSection * 1.5 ? '...' : ''}`)
    }
    
    if (introSection) {
      parts.push(`\n[INTRODUCTION]\n${introSection.slice(0, charsPerSection * 0.75)}${introSection.length > charsPerSection * 0.75 ? '...' : ''}`)
    }
    
    if (discussionSection) {
      parts.push(`\n[DISCUSSION]\n${discussionSection.slice(0, charsPerSection * 0.75)}${discussionSection.length > charsPerSection * 0.75 ? '...' : ''}`)
    }
    
    if (!theorySection && !introSection) {
      const maxChars = remainingTokens * 4
      parts.push(`\n[FULL TEXT EXCERPT]\n${fullText.slice(0, maxChars)}${fullText.length > maxChars ? '...' : ''}`)
    }
  }
  
  return parts.join('\n')
}

function extractSection(fullText: string, sectionNames: string[]): string | null {
  for (const name of sectionNames) {
    const patterns = [
      new RegExp(`(?:^|\\n)(?:\\d+\\.?\\s*)?${name}[:\\s]*\\n([\\s\\S]*?)(?=\\n(?:\\d+\\.?\\s*)?(?:method|result|finding|discussion|conclusion|reference|appendix)|\\n\\n\\n|$)`, 'i'),
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

function buildTheoreticalPrompt(
  input: TheoreticalExtractionInput,
  textForExtraction: string
): string {
  return `Extract theoretical contribution details from this paper.

${textForExtraction}

---

EXTRACTION INSTRUCTIONS:
1. Identify the type of theoretical contribution
2. List theories/frameworks this work builds on or critiques
3. Extract all key concepts with their definitions
4. Extract all propositions/hypotheses with their relationships
5. Describe any framework or model developed
6. Note scope conditions and level of analysis

For PROPOSITIONS:
- Capture the exact relationship proposed
- Note which concepts are involved
- Include boundary conditions if specified`
}

const THEORETICAL_SYSTEM_PROMPT = `You are an expert theoretical analyst specializing in extracting conceptual contributions from academic papers.

Your task is to identify and extract:
1. CONTRIBUTION TYPE: What kind of theoretical contribution is this?
   - New theory: Develops entirely new theoretical explanation
   - Theory extension: Extends existing theory to new contexts/phenomena
   - Theory integration: Combines multiple theories
   - Theory critique: Challenges or refines existing theory
   - Framework development: Creates organizing framework
   - Typology: Develops classification system
   - Model development: Creates theoretical model

2. THEORETICAL FOUNDATIONS: What theories does this build on?

3. CONCEPTS: Key constructs and their definitions
   - Name and definition
   - Dimensions or sub-components
   - Relationships to other concepts

4. PROPOSITIONS: Theoretical statements about relationships
   - Types: axioms (assumed true), propositions (derived claims), hypotheses (testable), corollaries (follow from others)
   - Which concepts are related and how
   - Boundary conditions

5. SCOPE: Where does the theory apply?
   - Level of analysis (individual, team, organization, industry, etc.)
   - Contextual boundaries

CRITICAL RULES:
1. Extract the EXACT concept names and definitions from the paper
2. Capture propositions in their formal statement when possible
3. Note the logical structure (which propositions follow from which)
4. Identify moderating conditions
5. Distinguish between the paper's own contributions and cited work`
