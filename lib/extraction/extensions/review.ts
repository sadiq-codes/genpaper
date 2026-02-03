/**
 * Review Extension Extractor
 * 
 * Extracts structured data specific to review papers:
 * - Review type (systematic, narrative, meta-analysis, etc.)
 * - Search strategy and databases
 * - Inclusion/exclusion criteria
 * - Studies included
 * - Synthesis findings
 * 
 * @module lib/extraction/extensions/review
 */

import { generateObject } from 'ai'
import { z } from 'zod'
import { getLanguageModel } from '@/lib/ai/vercel-client'
import { v4 as uuidv4 } from 'uuid'
import type {
  ReviewExtension,
  ReviewType,
  StatisticalFinding,
  EffectSizeType,
  RelationshipType
} from '../types'

// =============================================================================
// Zod Schemas
// =============================================================================

const MetaAnalyticFindingSchema = z.object({
  description: z.string(),
  relationship: z.enum(['positive', 'negative', 'null', 'curvilinear', 'interaction', 'mediation', 'comparison']),
  independentVariable: z.string(),
  dependentVariable: z.string(),
  effectSize: z.number().optional(),
  effectSizeType: z.enum([
    'cohens_d', 'hedges_g', 'odds_ratio', 'risk_ratio', 'hazard_ratio',
    'correlation_r', 'correlation_rho', 'beta', 'b', 'eta_squared',
    'partial_eta_squared', 'r_squared', 'percentage', 'mean_difference', 'other'
  ]).optional(),
  confidenceIntervalLower: z.number().optional(),
  confidenceIntervalUpper: z.number().optional(),
  pValue: z.number().optional(),
  isSignificant: z.boolean().optional(),
  kStudies: z.number().optional().describe('Number of studies in this analysis'),
  totalN: z.number().optional().describe('Combined sample size'),
  heterogeneity: z.string().optional().describe('I² or Q statistic'),
  confidence: z.number().min(0).max(1),
  rawQuote: z.string().optional()
})

const ReviewExtractionSchema = z.object({
  // Review type
  reviewType: z.enum([
    'narrative_review', 'systematic_review', 'meta_analysis',
    'scoping_review', 'critical_review', 'integrative_review', 'umbrella_review'
  ]),
  
  // Scope
  searchStrategy: z.string().optional().describe('Description of search approach'),
  databases: z.array(z.string()).optional().describe('Databases searched'),
  dateRange: z.string().optional().describe('Date range of literature'),
  inclusionCriteria: z.array(z.string()).optional(),
  exclusionCriteria: z.array(z.string()).optional(),
  
  // Results
  studiesIncluded: z.number().describe('Number of studies in final review'),
  studiesScreened: z.number().optional().describe('Number initially screened'),
  
  // Synthesis
  synthesisMethod: z.string().optional(),
  
  // For meta-analyses
  metaAnalyticFindings: z.array(MetaAnalyticFindingSchema).optional(),
  heterogeneityAssessed: z.boolean().optional(),
  publicationBiasAssessed: z.boolean().optional(),
  
  // Key findings
  mainFindings: z.array(z.string()).describe('Main findings of the review'),
  researchGaps: z.array(z.string()).describe('Gaps identified'),
  futureDirections: z.array(z.string()).describe('Future research directions'),
  
  // Overall
  extractionConfidence: z.number().min(0).max(1)
})

// =============================================================================
// Review Extraction Function
// =============================================================================

export interface ReviewExtractionInput {
  paperId: string
  title: string
  abstract?: string
  fullText?: string
}

export interface ReviewExtractionOptions {
  maxFullTextTokens?: number
  timeoutMs?: number
}

/**
 * Extract review-specific data from a review paper
 */
export async function extractReview(
  input: ReviewExtractionInput,
  options: ReviewExtractionOptions = {}
): Promise<ReviewExtension> {
  const startTime = Date.now()
  const { maxFullTextTokens = 10000 } = options
  
  const textForExtraction = prepareReviewText(
    input.title,
    input.abstract,
    input.fullText,
    maxFullTextTokens
  )
  
  try {
    const { object } = await generateObject({
      model: getLanguageModel(),
      schema: ReviewExtractionSchema,
      system: REVIEW_SYSTEM_PROMPT,
      prompt: buildReviewPrompt(input, textForExtraction),
      temperature: 0.1,
    })
    
    // Transform meta-analytic findings
    const metaAnalyticFindings: StatisticalFinding[] | undefined = object.metaAnalyticFindings?.map(f => ({
      id: uuidv4(),
      description: f.description,
      relationship: f.relationship as RelationshipType,
      independentVariable: f.independentVariable,
      dependentVariable: f.dependentVariable,
      effectSize: f.effectSize,
      effectSizeType: f.effectSizeType as EffectSizeType | undefined,
      confidenceInterval: f.confidenceIntervalLower !== undefined && f.confidenceIntervalUpper !== undefined
        ? { lower: f.confidenceIntervalLower, upper: f.confidenceIntervalUpper, level: 0.95 }
        : undefined,
      pValue: f.pValue,
      isSignificant: f.isSignificant,
      sampleSize: f.totalN,
      subgroupDescription: f.kStudies ? `k=${f.kStudies} studies` : undefined,
      confidence: f.confidence,
      rawQuote: f.rawQuote
    }))
    
    const extractionTime = Date.now() - startTime
    console.log(`📑 Review extraction completed in ${extractionTime}ms`)
    console.log(`   📊 Review type: ${object.reviewType}, ${object.studiesIncluded} studies included`)
    console.log(`   📝 Found ${object.mainFindings.length} main findings, ${object.researchGaps.length} gaps`)
    
    return {
      paperId: input.paperId,
      reviewType: object.reviewType as ReviewType,
      searchStrategy: object.searchStrategy,
      databases: object.databases,
      dateRange: object.dateRange,
      inclusionCriteria: object.inclusionCriteria,
      exclusionCriteria: object.exclusionCriteria,
      studiesIncluded: object.studiesIncluded,
      studiesScreened: object.studiesScreened,
      synthesisMethod: object.synthesisMethod,
      metaAnalyticFindings,
      heterogeneityAssessed: object.heterogeneityAssessed,
      publicationBiasAssessed: object.publicationBiasAssessed,
      mainFindings: object.mainFindings,
      researchGaps: object.researchGaps,
      futureDirections: object.futureDirections,
      extractionConfidence: object.extractionConfidence
    }
  } catch (error) {
    console.error('Review extraction failed:', error)
    throw error
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function prepareReviewText(
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
    // For reviews, prioritize methods (search strategy) and results (synthesis)
    const methodsSection = extractSection(fullText, ['method', 'search strategy', 'procedure', 'data sources'])
    const resultsSection = extractSection(fullText, ['results', 'findings', 'synthesis'])
    const discussionSection = extractSection(fullText, ['discussion', 'implications'])
    
    const abstractTokens = abstract ? Math.ceil(abstract.length / 4) : 0
    const remainingTokens = maxTokens - abstractTokens - 50
    const totalChars = remainingTokens * 4
    
    if (methodsSection) {
      parts.push(`\n[METHODS/SEARCH STRATEGY]\n${methodsSection.slice(0, totalChars * 0.3)}${methodsSection.length > totalChars * 0.3 ? '...' : ''}`)
    }
    
    if (resultsSection) {
      parts.push(`\n[RESULTS/SYNTHESIS]\n${resultsSection.slice(0, totalChars * 0.5)}${resultsSection.length > totalChars * 0.5 ? '...' : ''}`)
    }
    
    if (discussionSection) {
      parts.push(`\n[DISCUSSION]\n${discussionSection.slice(0, totalChars * 0.2)}${discussionSection.length > totalChars * 0.2 ? '...' : ''}`)
    }
    
    if (!methodsSection && !resultsSection) {
      parts.push(`\n[FULL TEXT EXCERPT]\n${fullText.slice(0, totalChars)}${fullText.length > totalChars ? '...' : ''}`)
    }
  }
  
  return parts.join('\n')
}

function extractSection(fullText: string, sectionNames: string[]): string | null {
  for (const name of sectionNames) {
    const patterns = [
      new RegExp(`(?:^|\\n)(?:\\d+\\.?\\s*)?${name}[:\\s]*\\n([\\s\\S]*?)(?=\\n(?:\\d+\\.?\\s*)?(?:result|finding|discussion|conclusion|reference)|\\n\\n\\n|$)`, 'i'),
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

function buildReviewPrompt(
  input: ReviewExtractionInput,
  textForExtraction: string
): string {
  return `Extract review paper details from this literature review.

${textForExtraction}

---

EXTRACTION INSTRUCTIONS:
1. Identify the review type (systematic, meta-analysis, narrative, etc.)
2. Extract search strategy details (databases, date range, criteria)
3. Note how many studies were included/screened
4. For meta-analyses, extract pooled effect sizes with statistics
5. List main synthesis findings
6. Identify research gaps highlighted
7. Note future research directions suggested

For META-ANALYSES specifically:
- Extract pooled effect sizes
- Note heterogeneity statistics (I², Q)
- Check for publication bias assessment (funnel plots, Egger's test)`
}

const REVIEW_SYSTEM_PROMPT = `You are an expert systematic review analyst specializing in extracting information from literature reviews and meta-analyses.

Your task is to identify and extract:
1. REVIEW TYPE:
   - Narrative review: Broad overview, non-systematic
   - Systematic review: Systematic search, defined criteria, PRISMA
   - Meta-analysis: Statistical pooling of effect sizes
   - Scoping review: Map the literature, identify gaps
   - Critical review: Critical appraisal of literature
   - Integrative review: Synthesize diverse research
   - Umbrella review: Review of reviews

2. SEARCH METHODOLOGY (for systematic reviews):
   - Databases searched
   - Search terms/strategy
   - Date range
   - Inclusion/exclusion criteria
   - PRISMA flow (studies screened → included)

3. SYNTHESIS FINDINGS:
   - For meta-analyses: pooled effect sizes, heterogeneity, moderators
   - For narrative: key themes, consensus/disagreement
   - Patterns across studies

4. GAPS AND FUTURE DIRECTIONS:
   - Methodological gaps
   - Topical gaps
   - Suggested future research

CRITICAL FOR META-ANALYSES:
- Extract EXACT pooled effect sizes
- Note the number of studies (k) and combined sample (N)
- Report heterogeneity (I², Q)
- Note subgroup analyses
- Check for publication bias assessment`
