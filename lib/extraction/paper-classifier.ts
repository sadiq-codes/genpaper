/**
 * Paper Type Classifier
 * 
 * Classifies academic papers into types (quantitative, qualitative, theoretical, etc.)
 * to determine which extension extractors to run.
 * 
 * Uses a combination of:
 * 1. Keyword/pattern analysis (fast, rule-based)
 * 2. LLM classification (accurate, semantic understanding)
 * 
 * @module lib/extraction/paper-classifier
 */

import { generateObject } from 'ai'
import { z } from 'zod'
import { getLanguageModel } from '@/lib/ai/vercel-client'
import type { 
  PaperType, 
  PaperTypeClassification, 
  ConfidenceLevel,
  ExtensionType 
} from './types'

// =============================================================================
// Classification Indicators (Rule-based)
// =============================================================================

interface IndicatorPatterns {
  type: PaperType
  keywords: string[]
  phrases: string[]
  sectionIndicators: string[]
  weight: number
}

const INDICATOR_PATTERNS: IndicatorPatterns[] = [
  {
    type: 'quantitative',
    keywords: [
      'regression', 'anova', 'correlation', 'significance', 'p-value', 'p <',
      'sample size', 'n =', 'participants', 'respondents', 'survey',
      'coefficient', 'beta', 'effect size', 'standard deviation', 'mean',
      'hypothesis', 'hypotheses', 'statistical', 'quantitative', 'variable',
      't-test', 'chi-square', 'factor analysis', 'sem', 'structural equation',
      'reliability', 'validity', 'cronbach', 'spss', 'stata', 'r software'
    ],
    phrases: [
      'we found that', 'results show', 'results indicate', 'was significant',
      'were significant', 'not significant', 'positively related',
      'negatively related', 'sample consisted', 'data were collected',
      'we tested', 'we examined', 'we measured', 'hierarchical regression',
      'moderation analysis', 'mediation analysis', 'multivariate analysis'
    ],
    sectionIndicators: ['results', 'findings', 'data analysis', 'statistical analysis'],
    weight: 1.0
  },
  {
    type: 'qualitative',
    keywords: [
      'interview', 'interviews', 'focus group', 'ethnograph', 'phenomenolog',
      'grounded theory', 'thematic analysis', 'content analysis', 'coding',
      'theme', 'themes', 'narrative', 'qualitative', 'participant observation',
      'field notes', 'nvivo', 'atlas.ti', 'interpretive', 'inductive',
      'saturation', 'trustworthiness', 'transferability', 'credibility',
      'member checking', 'thick description', 'reflexivity'
    ],
    phrases: [
      'participants described', 'emerged from', 'themes emerged',
      'data were analyzed', 'thematic analysis revealed', 'according to participants',
      'participants reported', 'in-depth interviews', 'semi-structured interviews',
      'purposive sampling', 'theoretical sampling', 'constant comparison'
    ],
    sectionIndicators: ['findings', 'themes', 'thematic analysis'],
    weight: 1.0
  },
  {
    type: 'theoretical',
    keywords: [
      'theory', 'theoretical', 'framework', 'model', 'conceptual',
      'proposition', 'propositions', 'construct', 'constructs', 'typology',
      'taxonomy', 'paradigm', 'perspective', 'lens', 'synthesis',
      'integrate', 'integration', 'extend', 'extension', 'critique',
      'reconceptualize', 'reconceptualization'
    ],
    phrases: [
      'we propose', 'we argue', 'we theorize', 'building on',
      'extending the', 'we develop', 'this paper develops', 'contributes to theory',
      'theoretical contribution', 'conceptual framework', 'theoretical framework',
      'we offer a', 'theoretical model', 'our theory suggests'
    ],
    sectionIndicators: ['theory development', 'theoretical framework', 'propositions'],
    weight: 1.0
  },
  {
    type: 'review',
    keywords: [
      'systematic review', 'meta-analysis', 'literature review', 'scoping review',
      'narrative review', 'integrative review', 'prisma', 'search strategy',
      'inclusion criteria', 'exclusion criteria', 'database', 'databases',
      'articles included', 'studies included', 'synthesis', 'synthesize',
      'body of literature', 'extant literature', 'review of the literature'
    ],
    phrases: [
      'we reviewed', 'this review', 'articles were included', 'studies were selected',
      'searched the following databases', 'search terms included',
      'pooled effect', 'heterogeneity', 'publication bias', 'funnel plot',
      'forest plot', 'quality assessment', 'risk of bias'
    ],
    sectionIndicators: ['search strategy', 'study selection', 'data extraction', 'quality assessment'],
    weight: 1.2  // Slightly higher weight - reviews have distinctive vocabulary
  },
  {
    type: 'humanities',
    keywords: [
      'interpretation', 'interpretive', 'hermeneutic', 'rhetoric', 'rhetorical',
      'literary', 'historical', 'philosophical', 'cultural', 'critical',
      'discourse', 'narrative', 'text', 'textual', 'archive', 'archival',
      'postmodern', 'postcolonial', 'feminist', 'marxist', 'foucault',
      'derrida', 'butler', 'symbolic', 'meaning', 'representation'
    ],
    phrases: [
      'close reading', 'textual analysis', 'this paper argues', 'i argue',
      'this essay', 'reading of', 'analysis of', 'interpretation of',
      'through the lens of', 'drawing on', 'building on the work of',
      'complicates our understanding', 'challenges the notion'
    ],
    sectionIndicators: ['analysis', 'interpretation', 'discussion'],
    weight: 0.9  // Slightly lower - terms can appear in other types
  },
  {
    type: 'case_study',
    keywords: [
      'case study', 'case studies', 'single case', 'multiple case',
      'instrumental case', 'intrinsic case', 'comparative case',
      'in-depth case', 'longitudinal case', 'case analysis'
    ],
    phrases: [
      'this case study', 'case was selected', 'case selection',
      'within-case', 'cross-case', 'case comparison', 'the case of',
      'studying the case', 'bounded system'
    ],
    sectionIndicators: ['case description', 'case analysis', 'case selection'],
    weight: 1.1
  },
  {
    type: 'mixed_methods',
    keywords: [
      'mixed methods', 'mixed-methods', 'multi-method', 'multimethod',
      'convergent', 'explanatory sequential', 'exploratory sequential',
      'embedded design', 'triangulation', 'integration'
    ],
    phrases: [
      'quantitative and qualitative', 'qualitative and quantitative',
      'survey and interviews', 'interviews and survey',
      'phase 1', 'phase 2', 'qual-quan', 'quan-qual',
      'mixed methods approach', 'combining quantitative'
    ],
    sectionIndicators: ['quantitative phase', 'qualitative phase', 'integration'],
    weight: 1.3  // Higher weight - distinctive terminology
  },
  {
    type: 'methodological',
    keywords: [
      'methodological', 'methodology', 'method development', 'scale development',
      'instrument development', 'measurement', 'psychometric', 'validation',
      'reliability', 'validity', 'factor structure', 'confirmatory factor',
      'exploratory factor', 'item response theory', 'rasch'
    ],
    phrases: [
      'develop and validate', 'validate a measure', 'scale was developed',
      'instrument was developed', 'psychometric properties', 'factor analysis revealed',
      'content validity', 'construct validity', 'criterion validity',
      'test-retest reliability', 'internal consistency'
    ],
    sectionIndicators: ['scale development', 'instrument development', 'validation study'],
    weight: 1.1
  }
]

// =============================================================================
// Rule-Based Pre-Classification
// =============================================================================

interface RuleBasedResult {
  scores: Map<PaperType, number>
  topType: PaperType
  indicators: string[]
  confidence: number
}

function ruleBasedClassification(
  title: string,
  abstract: string,
  fullText?: string
): RuleBasedResult {
  const text = `${title} ${abstract} ${fullText || ''}`.toLowerCase()
  const scores = new Map<PaperType, number>()
  const foundIndicators: string[] = []
  
  for (const pattern of INDICATOR_PATTERNS) {
    let score = 0
    
    // Check keywords
    for (const keyword of pattern.keywords) {
      const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
      const matches = text.match(regex)
      if (matches) {
        score += matches.length * 0.5
        if (foundIndicators.length < 10) {
          foundIndicators.push(`keyword: "${keyword}"`)
        }
      }
    }
    
    // Check phrases (higher weight)
    for (const phrase of pattern.phrases) {
      if (text.includes(phrase.toLowerCase())) {
        score += 2.0
        if (foundIndicators.length < 10) {
          foundIndicators.push(`phrase: "${phrase}"`)
        }
      }
    }
    
    // Check section indicators in abstract/title (highest weight)
    for (const section of pattern.sectionIndicators) {
      if (abstract.toLowerCase().includes(section) || title.toLowerCase().includes(section)) {
        score += 3.0
        if (foundIndicators.length < 10) {
          foundIndicators.push(`section: "${section}"`)
        }
      }
    }
    
    // Apply type weight
    score *= pattern.weight
    
    scores.set(pattern.type, score)
  }
  
  // Find top type
  let topType: PaperType = 'unknown'
  let maxScore = 0
  
  for (const [type, score] of scores) {
    if (score > maxScore) {
      maxScore = score
      topType = type
    }
  }
  
  // Calculate confidence based on score margin
  const sortedScores = [...scores.values()].sort((a, b) => b - a)
  const margin = sortedScores.length > 1 
    ? (sortedScores[0] - sortedScores[1]) / (sortedScores[0] || 1)
    : 0
  
  // Confidence: combination of absolute score and margin
  const confidence = Math.min(1, (maxScore / 20) * 0.5 + margin * 0.5)
  
  return {
    scores,
    topType: maxScore > 3 ? topType : 'unknown',
    indicators: foundIndicators,
    confidence
  }
}

// =============================================================================
// LLM Classification
// =============================================================================

const ClassificationSchema = z.object({
  primaryType: z.enum([
    'quantitative', 'qualitative', 'mixed_methods', 'theoretical',
    'review', 'humanities', 'case_study', 'methodological', 'commentary', 'unknown'
  ]),
  secondaryType: z.enum([
    'quantitative', 'qualitative', 'mixed_methods', 'theoretical',
    'review', 'humanities', 'case_study', 'methodological', 'commentary', 'unknown'
  ]).optional(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  indicators: z.array(z.string())
})

async function llmClassification(
  title: string,
  abstract: string,
  fullTextExcerpt?: string
): Promise<{
  primaryType: PaperType
  secondaryType?: PaperType
  confidence: number
  reasoning: string
  indicators: string[]
}> {
  const { object } = await generateObject({
    model: getLanguageModel(),
    schema: ClassificationSchema,
    system: `You are an expert academic paper classifier. Your task is to determine the research methodology type of academic papers.

Paper Types:
- quantitative: Uses statistical analysis, surveys, experiments with numerical data
- qualitative: Uses interviews, observations, thematic analysis with non-numerical data  
- mixed_methods: Explicitly combines quantitative and qualitative approaches
- theoretical: Develops, extends, or critiques theory without new empirical data
- review: Literature reviews, systematic reviews, meta-analyses
- humanities: Literary, historical, philosophical, cultural analysis
- case_study: In-depth study of specific cases (can be qual or quant)
- methodological: Develops or validates research methods/instruments
- commentary: Opinion pieces, editorials, responses (rarely primary research)
- unknown: Cannot determine with confidence

Consider:
1. Research design (experimental, survey, interview, archival, etc.)
2. Data types (numerical vs. textual)
3. Analysis methods (statistical vs. interpretive)
4. Paper structure and sections
5. Vocabulary and terminology used`,
    prompt: `Classify this academic paper:

TITLE: ${title}

ABSTRACT: ${abstract}

${fullTextExcerpt ? `EXCERPT FROM FULL TEXT (first 2000 chars):\n${fullTextExcerpt.slice(0, 2000)}` : ''}

Determine:
1. The PRIMARY methodology type
2. A SECONDARY type if applicable (e.g., case study that uses quantitative methods)
3. Your confidence (0-1)
4. Key indicators that led to this classification
5. Brief reasoning`
  })
  
  return {
    primaryType: object.primaryType as PaperType,
    secondaryType: object.secondaryType as PaperType | undefined,
    confidence: object.confidence,
    reasoning: object.reasoning,
    indicators: object.indicators
  }
}

// =============================================================================
// Extension Type Mapping
// =============================================================================

function getExtensionsForType(
  primaryType: PaperType, 
  secondaryType?: PaperType
): ExtensionType[] {
  const extensions: ExtensionType[] = []
  
  const typeToExtension: Record<PaperType, ExtensionType | null> = {
    'quantitative': 'quantitative',
    'qualitative': 'qualitative',
    'mixed_methods': null,  // Will add both
    'theoretical': 'theoretical',
    'review': 'review',
    'humanities': 'humanities',
    'case_study': null,     // Depends on methods used
    'methodological': 'quantitative',  // Usually quantitative
    'commentary': null,
    'unknown': null
  }
  
  // Handle primary type
  if (primaryType === 'mixed_methods') {
    extensions.push('quantitative', 'qualitative')
  } else if (primaryType === 'case_study') {
    // For case studies, check secondary type
    if (secondaryType === 'quantitative') {
      extensions.push('quantitative')
    } else if (secondaryType === 'qualitative' || !secondaryType) {
      extensions.push('qualitative')
    }
  } else {
    const ext = typeToExtension[primaryType]
    if (ext) extensions.push(ext)
  }
  
  // Handle secondary type if different
  if (secondaryType && secondaryType !== primaryType) {
    const ext = typeToExtension[secondaryType]
    if (ext && !extensions.includes(ext)) {
      extensions.push(ext)
    }
  }
  
  return extensions
}

// =============================================================================
// Main Classification Function
// =============================================================================

export interface ClassificationOptions {
  /** Skip LLM and use only rule-based classification */
  ruleBasedOnly?: boolean
  /** Use LLM even if rule-based has high confidence */
  forceLLM?: boolean
  /** Full text for better classification */
  fullText?: string
  /** Timeout for LLM call */
  timeoutMs?: number
}

/**
 * Classify a paper's methodology type
 * 
 * Uses a hybrid approach:
 * 1. Rule-based pre-classification for speed
 * 2. LLM classification for accuracy when needed
 * 
 * @param title Paper title
 * @param abstract Paper abstract
 * @param options Classification options
 * @returns Classification result with confidence and suggested extensions
 */
export async function classifyPaperType(
  title: string,
  abstract: string,
  options: ClassificationOptions = {}
): Promise<PaperTypeClassification> {
  const startTime = Date.now()
  
  // Step 1: Rule-based pre-classification
  const ruleResult = ruleBasedClassification(title, abstract, options.fullText)
  
  // If rule-based is confident enough and we're not forcing LLM, use it
  const RULE_CONFIDENCE_THRESHOLD = 0.7
  
  if (options.ruleBasedOnly || 
      (ruleResult.confidence >= RULE_CONFIDENCE_THRESHOLD && !options.forceLLM)) {
    const confidenceLevel: ConfidenceLevel = 
      ruleResult.confidence >= 0.8 ? 'high' :
      ruleResult.confidence >= 0.5 ? 'medium' : 'low'
    
    return {
      primaryType: ruleResult.topType,
      confidence: confidenceLevel,
      confidenceScore: ruleResult.confidence,
      indicators: ruleResult.indicators,
      suggestedExtensions: getExtensionsForType(ruleResult.topType)
    }
  }
  
  // Step 2: LLM classification
  try {
    const llmResult = await llmClassification(
      title, 
      abstract, 
      options.fullText
    )
    
    // Combine rule-based indicators with LLM indicators
    const combinedIndicators = [
      ...llmResult.indicators,
      ...ruleResult.indicators.slice(0, 3)
    ].slice(0, 10)
    
    // Use LLM result but factor in rule-based agreement
    let finalConfidence = llmResult.confidence
    if (ruleResult.topType === llmResult.primaryType) {
      // Agreement boosts confidence
      finalConfidence = Math.min(1, finalConfidence + 0.1)
    } else if (ruleResult.confidence > 0.5) {
      // Disagreement might lower confidence
      finalConfidence = Math.max(0, finalConfidence - 0.1)
    }
    
    const confidenceLevel: ConfidenceLevel = 
      finalConfidence >= 0.8 ? 'high' :
      finalConfidence >= 0.5 ? 'medium' : 'low'
    
    console.log(`📋 Paper classified as ${llmResult.primaryType} (${(finalConfidence * 100).toFixed(0)}% confidence) in ${Date.now() - startTime}ms`)
    
    return {
      primaryType: llmResult.primaryType,
      secondaryType: llmResult.secondaryType,
      confidence: confidenceLevel,
      confidenceScore: finalConfidence,
      indicators: combinedIndicators,
      suggestedExtensions: getExtensionsForType(llmResult.primaryType, llmResult.secondaryType)
    }
  } catch (error) {
    // Fallback to rule-based if LLM fails
    console.warn('LLM classification failed, using rule-based:', error)
    
    const confidenceLevel: ConfidenceLevel = 
      ruleResult.confidence >= 0.6 ? 'medium' : 'low'
    
    return {
      primaryType: ruleResult.topType,
      confidence: confidenceLevel,
      confidenceScore: ruleResult.confidence * 0.8, // Reduce confidence for fallback
      indicators: [...ruleResult.indicators, 'LLM fallback: rule-based only'],
      suggestedExtensions: getExtensionsForType(ruleResult.topType)
    }
  }
}

/**
 * Quick classification using only rules (for batch processing)
 */
export function quickClassifyPaperType(
  title: string,
  abstract: string
): PaperTypeClassification {
  const result = ruleBasedClassification(title, abstract)
  
  const confidenceLevel: ConfidenceLevel = 
    result.confidence >= 0.8 ? 'high' :
    result.confidence >= 0.5 ? 'medium' : 'low'
  
  return {
    primaryType: result.topType,
    confidence: confidenceLevel,
    confidenceScore: result.confidence,
    indicators: result.indicators,
    suggestedExtensions: getExtensionsForType(result.topType)
  }
}
