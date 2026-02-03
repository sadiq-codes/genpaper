/**
 * Quantitative Extension Extractor
 * 
 * Extracts structured data specific to quantitative research papers:
 * - Study design
 * - Sample characteristics
 * - Variables (IV, DV, controls, moderators, mediators)
 * - Statistical findings with effect sizes
 * - Analysis methods
 * 
 * @module lib/extraction/extensions/quantitative
 */

import { generateObject } from 'ai'
import { z } from 'zod'
import { getLanguageModel } from '@/lib/ai/vercel-client'
import { v4 as uuidv4 } from 'uuid'
import type {
  QuantitativeExtension,
  StatisticalFinding,
  VariableInfo,
  StudyDesign,
  EffectSizeType,
  RelationshipType
} from '../types'

// =============================================================================
// Zod Schemas for Quantitative Extraction
// =============================================================================

const VariableSchema = z.object({
  name: z.string().describe('Variable name'),
  operationalization: z.string().optional().describe('How the variable was measured'),
  measurementType: z.enum(['continuous', 'categorical', 'ordinal', 'binary']).optional(),
  reliability: z.number().optional().describe('Reliability coefficient if reported'),
  source: z.string().optional().describe('Source of measure (established scale, custom, etc.)')
})

const StatisticalFindingSchema = z.object({
  description: z.string().describe('Plain language description of finding'),
  relationship: z.enum(['positive', 'negative', 'null', 'curvilinear', 'interaction', 'mediation', 'comparison']),
  
  // Variables
  independentVariable: z.string().describe('Independent/predictor variable'),
  dependentVariable: z.string().describe('Dependent/outcome variable'),
  controlVariables: z.array(z.string()).optional(),
  moderators: z.array(z.string()).optional(),
  mediators: z.array(z.string()).optional(),
  
  // Effect size
  effectSize: z.number().optional().describe('Effect size value'),
  effectSizeType: z.enum([
    'cohens_d', 'hedges_g', 'odds_ratio', 'risk_ratio', 'hazard_ratio',
    'correlation_r', 'correlation_rho', 'beta', 'b', 'eta_squared',
    'partial_eta_squared', 'r_squared', 'percentage', 'mean_difference', 'other'
  ]).optional(),
  
  // Confidence interval
  confidenceIntervalLower: z.number().optional(),
  confidenceIntervalUpper: z.number().optional(),
  confidenceLevel: z.number().optional().describe('e.g., 0.95 for 95% CI'),
  
  // Significance
  pValue: z.number().optional(),
  significanceLevel: z.number().optional(),
  isSignificant: z.boolean().optional(),
  
  // Test details
  statisticalTest: z.string().optional().describe('Statistical test used'),
  testStatistic: z.number().optional(),
  degreesOfFreedom: z.union([z.number(), z.tuple([z.number(), z.number()])]).optional(),
  
  // Sample for this finding
  sampleSize: z.number().optional(),
  subgroupDescription: z.string().optional(),
  
  // Extraction
  confidence: z.number().min(0).max(1),
  rawQuote: z.string().optional().describe('Original text from paper')
})

const QuantitativeExtractionSchema = z.object({
  // Study design
  studyDesign: z.enum([
    'experimental', 'quasi_experimental', 'observational', 'longitudinal',
    'cross_sectional', 'cohort', 'case_control', 'survey', 'secondary_data',
    'simulation', 'other'
  ]),
  designDetails: z.string().optional().describe('Additional details about study design'),
  
  // Sample
  sampleSize: z.number().describe('Total sample size'),
  sampleDescription: z.string().optional(),
  samplingMethod: z.string().optional(),
  responseRate: z.number().optional().describe('For surveys - response rate'),
  attritionRate: z.number().optional().describe('For longitudinal - dropout rate'),
  
  // Variables
  independentVariables: z.array(VariableSchema),
  dependentVariables: z.array(VariableSchema),
  controlVariables: z.array(VariableSchema).optional(),
  moderatorVariables: z.array(VariableSchema).optional(),
  mediatorVariables: z.array(VariableSchema).optional(),
  
  // Analysis
  analysisMethod: z.array(z.string()).describe('Statistical methods used'),
  softwareUsed: z.string().optional(),
  
  // Findings
  statisticalFindings: z.array(StatisticalFindingSchema),
  
  // Quality indicators
  powerAnalysis: z.boolean().optional(),
  effectSizeReported: z.boolean(),
  confidenceIntervalsReported: z.boolean(),
  assumptionsTested: z.boolean().optional(),
  
  // Overall
  extractionConfidence: z.number().min(0).max(1)
})

// =============================================================================
// Quantitative Extraction Function
// =============================================================================

export interface QuantitativeExtractionInput {
  paperId: string
  title: string
  abstract?: string
  fullText?: string
}

export interface QuantitativeExtractionOptions {
  maxFullTextTokens?: number
  timeoutMs?: number
}

/**
 * Extract quantitative-specific data from a research paper
 */
export async function extractQuantitative(
  input: QuantitativeExtractionInput,
  options: QuantitativeExtractionOptions = {}
): Promise<QuantitativeExtension> {
  const startTime = Date.now()
  const { maxFullTextTokens = 10000 } = options
  
  // Prepare text - for quantitative, we want results/methods sections
  const textForExtraction = prepareQuantitativeText(
    input.title,
    input.abstract,
    input.fullText,
    maxFullTextTokens
  )
  
  try {
    const { object } = await generateObject({
      model: getLanguageModel(),
      schema: QuantitativeExtractionSchema,
      system: QUANTITATIVE_SYSTEM_PROMPT,
      prompt: buildQuantitativePrompt(input, textForExtraction),
      temperature: 0.1,
    })
    
    // Transform to our types with IDs
    const findings: StatisticalFinding[] = object.statisticalFindings.map(f => ({
      id: uuidv4(),
      description: f.description,
      relationship: f.relationship as RelationshipType,
      independentVariable: f.independentVariable,
      dependentVariable: f.dependentVariable,
      controlVariables: f.controlVariables,
      moderators: f.moderators,
      mediators: f.mediators,
      effectSize: f.effectSize,
      effectSizeType: f.effectSizeType as EffectSizeType | undefined,
      confidenceInterval: f.confidenceIntervalLower !== undefined && f.confidenceIntervalUpper !== undefined 
        ? {
            lower: f.confidenceIntervalLower,
            upper: f.confidenceIntervalUpper,
            level: f.confidenceLevel || 0.95
          }
        : undefined,
      pValue: f.pValue,
      significanceLevel: f.significanceLevel,
      isSignificant: f.isSignificant,
      statisticalTest: f.statisticalTest,
      testStatistic: f.testStatistic,
      degreesOfFreedom: f.degreesOfFreedom,
      sampleSize: f.sampleSize,
      subgroupDescription: f.subgroupDescription,
      confidence: f.confidence,
      rawQuote: f.rawQuote
    }))
    
    const variables: QuantitativeExtension['variables'] = {
      independent: object.independentVariables.map(transformVariable),
      dependent: object.dependentVariables.map(transformVariable),
      control: object.controlVariables?.map(transformVariable),
      moderator: object.moderatorVariables?.map(transformVariable),
      mediator: object.mediatorVariables?.map(transformVariable)
    }
    
    const extractionTime = Date.now() - startTime
    console.log(`📊 Quantitative extraction completed in ${extractionTime}ms`)
    console.log(`   📈 Found ${findings.length} statistical findings`)
    console.log(`   📐 Study design: ${object.studyDesign}, n=${object.sampleSize}`)
    
    return {
      paperId: input.paperId,
      studyDesign: object.studyDesign as StudyDesign,
      designDetails: object.designDetails,
      sampleSize: object.sampleSize,
      sampleDescription: object.sampleDescription,
      samplingMethod: object.samplingMethod,
      responseRate: object.responseRate,
      attritionRate: object.attritionRate,
      variables,
      analysisMethod: object.analysisMethod,
      softwareUsed: object.softwareUsed,
      statisticalFindings: findings,
      powerAnalysis: object.powerAnalysis,
      effectSizeReported: object.effectSizeReported,
      confidenceIntervalsReported: object.confidenceIntervalsReported,
      assumptionsTested: object.assumptionsTested,
      extractionConfidence: object.extractionConfidence
    }
  } catch (error) {
    console.error('Quantitative extraction failed:', error)
    throw error
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function transformVariable(v: z.infer<typeof VariableSchema>): VariableInfo {
  return {
    name: v.name,
    operationalization: v.operationalization,
    measurementType: v.measurementType,
    reliability: v.reliability,
    source: v.source
  }
}

function prepareQuantitativeText(
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
    // For quantitative papers, prioritize Methods and Results sections
    const methodsSection = extractSection(fullText, ['method', 'methodology', 'methods', 'research design', 'procedure'])
    const resultsSection = extractSection(fullText, ['results', 'findings', 'analysis'])
    const discussionSection = extractSection(fullText, ['discussion'])
    
    const abstractTokens = abstract ? Math.ceil(abstract.length / 4) : 0
    const remainingTokens = maxTokens - abstractTokens - 50
    const charsPerSection = (remainingTokens * 4) / 3
    
    if (methodsSection) {
      parts.push(`\n[METHODS SECTION]\n${methodsSection.slice(0, charsPerSection)}${methodsSection.length > charsPerSection ? '...' : ''}`)
    }
    
    if (resultsSection) {
      parts.push(`\n[RESULTS SECTION]\n${resultsSection.slice(0, charsPerSection)}${resultsSection.length > charsPerSection ? '...' : ''}`)
    }
    
    if (discussionSection) {
      parts.push(`\n[DISCUSSION SECTION]\n${discussionSection.slice(0, charsPerSection)}${discussionSection.length > charsPerSection ? '...' : ''}`)
    }
    
    // If no sections found, take raw text
    if (!methodsSection && !resultsSection && !discussionSection) {
      const maxChars = remainingTokens * 4
      parts.push(`\n[FULL TEXT EXCERPT]\n${fullText.slice(0, maxChars)}${fullText.length > maxChars ? '...' : ''}`)
    }
  }
  
  return parts.join('\n')
}

function extractSection(fullText: string, sectionNames: string[]): string | null {
  for (const name of sectionNames) {
    // Try to find section with various formats
    const patterns = [
      new RegExp(`(?:^|\\n)(?:\\d+\\.?\\s*)?${name}[:\\s]*\\n([\\s\\S]*?)(?=\\n(?:\\d+\\.?\\s*)?(?:${getNextSections(name).join('|')})|\\n\\n\\n|$)`, 'i'),
      new RegExp(`(?:^|\\n)#+ ?${name}[:\\s]*\\n([\\s\\S]*?)(?=\\n#+|$)`, 'i') // Markdown style
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

function getNextSections(currentSection: string): string[] {
  const order = [
    'abstract', 'introduction', 'literature', 'background', 'theory',
    'hypothesis', 'method', 'methodology', 'procedure', 'sample', 'data',
    'result', 'finding', 'analysis', 'discussion', 'conclusion',
    'implication', 'limitation', 'future', 'reference', 'appendix'
  ]
  
  const current = currentSection.toLowerCase()
  const idx = order.findIndex(s => s.includes(current) || current.includes(s))
  
  if (idx === -1) return order
  return order.slice(idx + 1)
}

function buildQuantitativePrompt(
  input: QuantitativeExtractionInput,
  textForExtraction: string
): string {
  return `Extract quantitative research details from this paper.

${textForExtraction}

---

EXTRACTION INSTRUCTIONS:
1. Identify the study design (experimental, survey, longitudinal, etc.)
2. Extract sample size and characteristics
3. List all variables studied with their operationalizations
4. Extract ALL statistical findings with:
   - Effect sizes (β, r, d, OR, etc.) when reported
   - Confidence intervals when reported
   - p-values and significance
   - The statistical test used
5. Note quality indicators (power analysis, effect sizes reported, etc.)

Be PRECISE with numbers - extract exact values from the text.
If a value is not explicitly stated, mark it as not present rather than guessing.
Include raw quotes for statistical findings when possible.`
}

const QUANTITATIVE_SYSTEM_PROMPT = `You are an expert statistical research analyst specializing in extracting quantitative research details from academic papers.

Your task is to identify and extract:
1. STUDY DESIGN: What type of study was conducted?
2. SAMPLE: How many participants? What are their characteristics?
3. VARIABLES: What was measured? How?
4. STATISTICAL FINDINGS: What were the results? Effect sizes? Significance?
5. QUALITY: Were proper statistical practices followed?

CRITICAL RULES:
1. Extract EXACT numbers from the text - do not estimate or round
2. Distinguish between different types of effect sizes (β, r, d, OR, etc.)
3. Note when values are standardized vs unstandardized coefficients
4. Capture confidence intervals with their confidence level (usually 95%)
5. Identify the statistical test used for each finding
6. Mark findings as significant/not significant based on reported p-values
7. If multiple models are reported, extract the final/main model results
8. For regression, distinguish between individual predictors and model fit
9. Note subgroup analyses separately from main findings

COMMON STATISTICAL NOTATIONS:
- β (beta): standardized regression coefficient
- b or B: unstandardized regression coefficient
- r: correlation coefficient
- d: Cohen's d (standardized mean difference)
- OR: odds ratio
- RR: risk ratio
- HR: hazard ratio
- η² or η²p: eta-squared / partial eta-squared
- R²: variance explained
- t, F, χ²: test statistics
- df: degrees of freedom
- CI: confidence interval
- SE: standard error
- SD: standard deviation
- M: mean

When uncertain about a value, assign lower confidence rather than guessing.`
