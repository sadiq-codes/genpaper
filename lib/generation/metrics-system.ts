import 'server-only'
import { createClient } from '@/lib/supabase/server'
import crypto from 'crypto'

/**
 * Automated output scoring system for generation quality metrics
 * Tracks citation coverage, relevance, verbosity, fact density to guide parameter tuning
 */

// Pre-compiled regex patterns for performance
const FACT_PATTERNS = [
  /\d{4}/g, // Years
  /\d+%/g, // Percentages
  /\d+\.\d+/g, // Decimal numbers
  /\b(found|showed|demonstrated|revealed|indicated)\b/gi, // Result verbs
  /\b(compared to|versus|higher than|lower than)\b/gi // Comparisons
]

const TRANSITION_WORDS = [
  'however', 'furthermore', 'additionally', 'moreover', 'consequently',
  'therefore', 'nevertheless', 'meanwhile', 'subsequently', 'alternatively'
]

const COMPLEXITY_INDICATORS = [
  /\b(therefore|consequently|thus|hence)\b/gi, // Causal connectors
  /\b(although|despite|however|nevertheless)\b/gi, // Contrast connectors
  /\b(furthermore|moreover|additionally)\b/gi, // Additive connectors
  /\b(alternatively|conversely|on the other hand)\b/gi // Alternative connectors
]

const INTEGRATION_PATTERNS = [
  /\[CITE:[^\]]+\][^.]*\b(shows?|demonstrates?|indicates?|suggests?|reveals?)\b/gi,
  /\b(according to|as noted by|research shows)\b[^.]*\[CITE:[^\]]+\]/gi
]

export interface GenerationMetrics {
  // Core quality metrics
  citation_coverage: number // numCitationBlocks / numPapersInContext
  relevance_score: number // avg cosine sim between section embedding and topic embedding
  verbosity_ratio: number // tokens / words
  fact_density: number // # factual sentences / total sentences
  
  // Content quality metrics
  depth_score: number // based on analysis depth and insight
  coherence_score: number // flow and logical connection
  style_score: number // academic writing style adherence
  technical_accuracy: number // factual correctness
  source_integration: number // citation quality
  argument_structure: number // logical flow
  readability_score: number // clarity and accessibility
  jargon_density: number // appropriate technical language
  bias_score: number // objectivity measure
  novelty_score: number // contribution assessment
}

export interface MetricsStorageRecord {
  section_id: string
  paper_type: string
  section_key: string
  topic: string
  metrics: GenerationMetrics
  generation_time_ms: number
  model_used: string
  prompt_version: string
  word_count: number
  token_count?: number
  timestamp: string
}

export interface SectionMetrics extends MetricsStorageRecord {
  metrics: GenerationMetrics
}

export interface AggregatedMetrics {
  period: 'hour' | 'day' | 'week'
  total_sections: number
  average_metrics: GenerationMetrics
  metric_trends: {
    [K in keyof GenerationMetrics]: {
      current: number
      previous: number
      change_percent: number | null
      trend: 'improving' | 'declining' | 'stable'
    }
  }
  performance_insights: {
    best_performing_configs: Array<{
      config: string
      avg_score: number
      sample_size: number
    }>
    worst_performing_configs: Array<{
      config: string
      avg_score: number
      sample_size: number
    }>
    recommended_adjustments: string[]
  }
}

// In-memory cache for embeddings during a single lambda / Vercel function execution
const embeddingCache = new Map<string, number[]>()

async function fetchOpenAiEmbedding(text: string): Promise<number[] | null> {
  try {
    const key = process.env.OPENAI_API_KEY
    if (!key) return null

    const cacheKey = crypto.createHash('sha256').update(text).digest('hex')
    if (embeddingCache.has(cacheKey)) return embeddingCache.get(cacheKey)!

    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text.substring(0, 8191) // API limit safeguard
      })
    })

    if (!res.ok) {
      console.warn('Embedding API error', await res.text())
      return null
    }

    const json = await res.json() as { data: Array<{ embedding: number[] }> }
    const emb = json.data[0].embedding
    embeddingCache.set(cacheKey, emb)
    return emb
  } catch (e) {
    console.warn('Embedding fetch failed', e)
    return null
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, ai, i) => sum + ai * (b[i] || 0), 0)
  const magA = Math.hypot(...a)
  const magB = Math.hypot(...b)
  return magA && magB ? dot / (magA * magB) : 0
}

/**
 * Calculate comprehensive metrics for generated content
 */
export function calculateContentMetrics(
  content: string,
  topic: string,
  availablePapers: string[],
  contextChunks: string[],
  qualityCriteria: string[] = []
): GenerationMetrics {
  const citations = extractCitationReferences(content)
  const wordCount = countWords(content)
  const sentenceCount = countSentences(content)
  
  return {
    citation_coverage: calculateCitationCoverage(citations, availablePapers),
    relevance_score: keywordRelevanceFallback(content, topic),
    verbosity_ratio: calculateVerbosityRatio(),
    fact_density: calculateFactDensity(content, sentenceCount),
    depth_score: calculateQualityCriteriaCoverage(content, qualityCriteria),
    coherence_score: calculateTransitionWordDensity(content, wordCount),
    style_score: 0.8, // Default style score
    technical_accuracy: 0.8, // Default technical accuracy
    source_integration: calculateEvidenceIntegration(content, citations),
    argument_structure: calculateArgumentComplexity(content),
    readability_score: 0.8, // Default readability
    jargon_density: 0.5, // Default jargon density
    bias_score: 0.8, // Default bias score
    novelty_score: 0.7 // Default novelty score
  }
}

export async function calculateContentMetricsAsync(
  content: string,
  topic: string,
  availablePapers: string[],
  contextChunks: string[],
  qualityCriteria: string[] = []
): Promise<GenerationMetrics> {
  // Use the synchronous version as base
  const base = calculateContentMetrics(content, topic, availablePapers, contextChunks, qualityCriteria)
  
  // Try to get better relevance score with embeddings
  try {
    const contentEmbedding = await fetchOpenAiEmbedding(content)
    const topicEmbedding = await fetchOpenAiEmbedding(topic)
    
    if (contentEmbedding && topicEmbedding) {
      base.relevance_score = cosineSimilarity(contentEmbedding, topicEmbedding)
    }
  } catch (error) {
    console.warn('Failed to calculate embedding-based relevance:', error)
    // Keep the keyword-based fallback score
  }
  
  return base
}

/**
 * Calculate quality criteria coverage (replaces depth cue coverage)
 * This adapts to any discipline by checking for concepts related to the quality criteria
 */
function calculateQualityCriteriaCoverage(content: string, qualityCriteria: string[]): number {
  if (qualityCriteria.length === 0) return 0.8 // Default score when no criteria provided
  
  const contentLower = content.toLowerCase()
  
  // Check for each quality criterion and related concepts
  const coveredCriteria = qualityCriteria.filter(criterion => {
    const criterionLower = criterion.toLowerCase()
    
    // Direct mention of the criterion
    if (contentLower.includes(criterionLower)) return true
    
    // Check for related concepts based on common academic quality criteria
    const relatedConcepts = getRelatedConcepts(criterionLower)
    return relatedConcepts.some(concept => contentLower.includes(concept))
  })
  
  return coveredCriteria.length / qualityCriteria.length
}

/**
 * Get related concepts for quality criteria to improve coverage detection
 */
function getRelatedConcepts(criterion: string): string[] {
  const conceptMap: Record<string, string[]> = {
    'statistical rigor': ['statistical', 'significance', 'p-value', 'confidence', 'methodology'],
    'reproducibility': ['reproducible', 'replicable', 'methodology', 'protocol', 'procedure'],
    'theoretical grounding': ['theory', 'theoretical', 'framework', 'foundation', 'conceptual'],
    'empirical evidence': ['empirical', 'evidence', 'data', 'findings', 'results'],
    'critical analysis': ['critical', 'analysis', 'evaluate', 'assess', 'examine'],
    'synthesis': ['synthesis', 'integrate', 'combine', 'merge', 'unify'],
    'logical consistency': ['logical', 'consistent', 'coherent', 'reasoning', 'argument'],
    'scholarly depth': ['depth', 'comprehensive', 'thorough', 'detailed', 'extensive'],
    'methodological justification': ['methodological', 'justification', 'rationale', 'approach', 'design'],
    'gap identification': ['gap', 'limitation', 'missing', 'absent', 'lack'],
    'practical implications': ['practical', 'implications', 'applications', 'real-world', 'implementation'],
    'contextual detail': ['context', 'contextual', 'background', 'setting', 'environment'],
    'transferability': ['transferable', 'generalizable', 'applicable', 'relevant', 'external validity']
  }
  
  // Return related concepts for the criterion, or fall back to the criterion itself
  for (const [key, concepts] of Object.entries(conceptMap)) {
    if (criterion.includes(key) || key.includes(criterion)) {
      return concepts
    }
  }
  
  // If no specific mapping found, use the criterion words themselves
  return criterion.split(' ').filter(word => word.length > 3)
}

/**
 * Store metrics in database for analysis and trending
 */
export async function storeMetrics(
  sectionId: string,
  paperType: string,
  sectionKey: string,
  topic: string,
  metrics: GenerationMetrics,
  generationTimeMs: number,
  modelUsed: string,
  promptVersion: string,
  wordCount: number,
  tokenCount?: number
): Promise<void> {
  const record: MetricsStorageRecord = {
    section_id: sectionId,
    paper_type: paperType,
    section_key: sectionKey,
    topic,
    metrics,
    generation_time_ms: generationTimeMs,
    model_used: modelUsed,
    prompt_version: promptVersion,
    word_count: wordCount,
    token_count: tokenCount,
    timestamp: new Date().toISOString()
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from('generation_metrics')
      .insert(record)

    if (error) {
      console.error('Failed to store metrics:', error)
    }
  } catch (error) {
    console.error('Error storing metrics:', error)
  }
}

/**
 * Get aggregated metrics for analysis and dashboard
 */
export async function getAggregatedMetrics(
  period: 'hour' | 'day' | 'week' = 'day',
  paperType?: string,
  sectionKey?: string
): Promise<AggregatedMetrics> {
  try {
    const supabase = await createClient()
    
    const viewName = period === 'day' ? 'daily_generation_metrics' : period === 'week' ? 'weekly_generation_metrics' : 'generation_metrics'
    const now = new Date()

    let query
    if (period === 'hour') {
      // Use raw table with time window filter
      const periodStart = new Date(now)
      periodStart.setHours(now.getHours() - 1)
      query = supabase
        .from('generation_metrics')
        .select('*')
        .gte('timestamp', periodStart.toISOString())
        .lte('timestamp', now.toISOString())
    } else {
      // day/week – use pre-aggregated materialised views
      query = supabase.from(viewName).select('*')
    }
    
    if (paperType) {
      query = query.eq('paper_type', paperType)
    }
    if (sectionKey) {
      query = query.eq('section_key', sectionKey)
    }
    
    const { data: metrics, error } = await query
    
    if (error || !metrics || metrics.length === 0) {
      return createEmptyAggregatedMetrics(period)
    }
    
    // Calculate averages
    const totalSections = metrics.length
    const averageMetrics = calculateAverageMetrics(metrics)
    
    // Get previous period for comparison
    const previousPeriodStart = new Date(now)
    const previousPeriodEnd = new Date(now)
    
    switch (period) {
      case 'hour':
        previousPeriodStart.setHours(previousPeriodStart.getHours() - 1)
        break
      case 'day':
        previousPeriodStart.setDate(previousPeriodStart.getDate() - 1)
        break
      case 'week':
        previousPeriodStart.setDate(previousPeriodStart.getDate() - 7)
        break
    }
    
    const { data: previousMetrics } = await supabase
      .from('generation_metrics')
      .select('*')
      .gte('timestamp', previousPeriodStart.toISOString())
      .lte('timestamp', previousPeriodEnd.toISOString()) as { data: SectionMetrics[] | null }
    
    const previousAverages = previousMetrics ? calculateAverageMetrics(previousMetrics) : null
    const metricTrends = calculateMetricTrends(averageMetrics, previousAverages)
    
    // Analyze performance by configuration
    const performanceInsights = analyzeConfigurationPerformance(metrics)
    
    return {
      period,
      total_sections: totalSections,
      average_metrics: averageMetrics,
      metric_trends: metricTrends,
      performance_insights: performanceInsights
    }
  } catch (error) {
    console.error('Error getting aggregated metrics:', error)
    return createEmptyAggregatedMetrics(period)
  }
}

/**
 * Calculate citation coverage metric
 */
function calculateCitationCoverage(citations: string[], availablePapers: string[]): number {
  if (availablePapers.length === 0) return 0
  
  const uniqueCitedPapers = new Set(citations)
  return uniqueCitedPapers.size / availablePapers.length
}

/**
 * Calculate verbosity ratio (fixed estimation)
 */
function calculateVerbosityRatio(): number {
  // GPT-4o averages ~0.75 tokens per word
  return 0.75
}

/**
 * Calculate fact density using pre-compiled patterns
 */
function calculateFactDensity(content: string, sentenceCount: number): number {
  const factualSentences = content.split(/[.!?]+/).filter(sentence => {
    return FACT_PATTERNS.some(pattern => {
      pattern.lastIndex = 0 // Reset regex state
      return pattern.test(sentence)
    })
  }).length
  
  return factualSentences / Math.max(1, sentenceCount)
}

/**
 * Calculate transition word density using pre-compiled list
 */
function calculateTransitionWordDensity(content: string, wordCount: number): number {
  const transitionCount = TRANSITION_WORDS.reduce((count, word) => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi')
    return count + (content.match(regex) || []).length
  }, 0)
  
  return (transitionCount / wordCount) * 100
}

/**
 * Calculate citation diversity
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function calculateCitationDiversity(citations: string[], availablePapers: string[]): number {
  if (availablePapers.length === 0) return 0
  const uniqueCitations = new Set(citations)
  return uniqueCitations.size / availablePapers.length
}

/**
 * Calculate citation distribution evenness (fixed edge case)
 */
function calculateCitationDistribution(citations: string[]): number {
  if (citations.length === 0) return 0
  
  const uniqueCitations = new Set(citations)
  if (uniqueCitations.size < 3) return 0 // Require at least 3 unique citations for meaningful distribution
  
  const citationCounts = citations.reduce((counts, citation) => {
    counts[citation] = (counts[citation] || 0) + 1
    return counts
  }, {} as Record<string, number>)
  
  const counts = Object.values(citationCounts)
  const maxCount = Math.max(...counts)
  const minCount = Math.min(...counts)
  
  // Higher score for more even distribution
  return minCount / maxCount
}

/**
 * Calculate argument complexity using pre-compiled patterns
 */
function calculateArgumentComplexity(content: string): number {
  const indicatorCount = COMPLEXITY_INDICATORS.reduce((count, pattern) => {
    pattern.lastIndex = 0 // Reset regex state
    return count + (content.match(pattern) || []).length
  }, 0)
  
  const wordCount = countWords(content)
  return Math.min((indicatorCount / wordCount) * 100, 1.0)
}

/**
 * Calculate evidence integration quality using pre-compiled patterns
 */
function calculateEvidenceIntegration(content: string, citations: string[]): number {
  if (citations.length === 0) return 0
  
  const integratedCitations = INTEGRATION_PATTERNS.reduce((count, pattern) => {
    pattern.lastIndex = 0 // Reset regex state
    return count + (content.match(pattern) || []).length
  }, 0)
  
  return integratedCitations / citations.length
}

/**
 * Helper functions for text analysis
 */
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length
}

function countSentences(text: string): number {
  return text.split(/[.!?]+/).filter(s => s.trim().length > 0).length
}

function countParagraphs(text: string): number {
  return text.split(/\n\s*\n/).filter(p => p.trim().length > 0).length
}

function extractCitationReferences(text: string): string[] {
  const citationRegex = /\[CITE:([^\]]+)\]/g
  const citations: string[] = []
  let match
  
  while ((match = citationRegex.exec(text)) !== null) {
    citations.push(match[1])
  }
  
  return citations
}

/**
 * Calculate average metrics from array of section metrics
 */
function calculateAverageMetrics(metrics: SectionMetrics[]): GenerationMetrics {
  if (metrics.length === 0) {
    return createEmptyMetrics()
  }
  
  const sums = metrics.reduce((acc, metric) => ({
    citation_coverage: acc.citation_coverage + metric.metrics.citation_coverage,
    relevance_score: acc.relevance_score + metric.metrics.relevance_score,
    verbosity_ratio: acc.verbosity_ratio + metric.metrics.verbosity_ratio,
    fact_density: acc.fact_density + metric.metrics.fact_density,
    depth_score: acc.depth_score + metric.metrics.depth_score,
    coherence_score: acc.coherence_score + metric.metrics.coherence_score,
    style_score: acc.style_score + metric.metrics.style_score,
    technical_accuracy: acc.technical_accuracy + metric.metrics.technical_accuracy,
    source_integration: acc.source_integration + metric.metrics.source_integration,
    argument_structure: acc.argument_structure + metric.metrics.argument_structure,
    readability_score: acc.readability_score + metric.metrics.readability_score,
    jargon_density: acc.jargon_density + metric.metrics.jargon_density,
    bias_score: acc.bias_score + metric.metrics.bias_score,
    novelty_score: acc.novelty_score + metric.metrics.novelty_score
  }), createEmptyMetrics())
  
  const count = metrics.length
  return {
    citation_coverage: sums.citation_coverage / count,
    relevance_score: sums.relevance_score / count,
    verbosity_ratio: sums.verbosity_ratio / count,
    fact_density: sums.fact_density / count,
    depth_score: sums.depth_score / count,
    coherence_score: sums.coherence_score / count,
    style_score: sums.style_score / count,
    technical_accuracy: sums.technical_accuracy / count,
    source_integration: sums.source_integration / count,
    argument_structure: sums.argument_structure / count,
    readability_score: sums.readability_score / count,
    jargon_density: sums.jargon_density / count,
    bias_score: sums.bias_score / count,
    novelty_score: sums.novelty_score / count
  }
}

/**
 * Calculate metric trends by comparing current vs previous period (fixed zero handling)
 */
function calculateMetricTrends(
  current: GenerationMetrics,
  previous: GenerationMetrics | null
): AggregatedMetrics['metric_trends'] {
  const keys = Object.keys(current) as Array<keyof GenerationMetrics>
  
  return keys.reduce((trends, key) => {
    const currentValue = current[key]
    const previousValue = previous?.[key] || 0
    
    let changePercent: number | null = null
    let trend: 'improving' | 'declining' | 'stable' = 'stable'
    
    if (previousValue === 0 && currentValue > 0) {
      changePercent = null // Infinite growth
      trend = 'improving'
    } else if (previousValue > 0) {
      changePercent = ((currentValue - previousValue) / previousValue) * 100
      
      if (Math.abs(changePercent) > 5) {
        trend = changePercent > 0 ? 'improving' : 'declining'
      }
    }
    
    trends[key] = {
      current: currentValue,
      previous: previousValue,
      change_percent: changePercent,
      trend
    }
    
    return trends
  }, {} as AggregatedMetrics['metric_trends'])
}

/**
 * Analyze configuration performance to identify best/worst settings
 */
function analyzeConfigurationPerformance(metrics: SectionMetrics[]): AggregatedMetrics['performance_insights'] {
  // Group by configuration (model + prompt version)
  const configGroups = metrics.reduce((groups, metric) => {
    const config = `${metric.model_used}::${metric.prompt_version}`
    if (!groups[config]) {
      groups[config] = []
    }
    groups[config].push(metric)
    return groups
  }, {} as Record<string, SectionMetrics[]>)
  
  // Calculate composite scores for each configuration
  const configScores = Object.entries(configGroups).map(([config, configMetrics]) => {
    const avgMetrics = calculateAverageMetrics(configMetrics)
    
    // Composite score (weighted average of key metrics)
    const compositeScore = (
      avgMetrics.citation_coverage * 0.25 +
      avgMetrics.relevance_score * 0.20 +
      avgMetrics.fact_density * 0.15 +
      avgMetrics.depth_score * 0.15 +
      avgMetrics.source_integration * 0.15 +
      avgMetrics.argument_structure * 0.10
    ) * 100
    
    return {
      config,
      avg_score: compositeScore,
      sample_size: configMetrics.length
    }
  }).filter(item => item.sample_size >= 3) // Only configs with enough samples
  
  configScores.sort((a, b) => b.avg_score - a.avg_score)
  
  const bestPerforming = configScores.slice(0, 3)
  const worstPerforming = configScores.slice(-3).reverse()
  
  // Generate recommendations based on analysis
  const recommendations: string[] = []
  if (bestPerforming.length > 0 && worstPerforming.length > 0) {
    const scoreDiff = bestPerforming[0].avg_score - worstPerforming[0].avg_score
    if (scoreDiff > 10) {
      recommendations.push(`Consider migrating from ${worstPerforming[0].config} to ${bestPerforming[0].config}`)
    }
  }
  
  return {
    best_performing_configs: bestPerforming,
    worst_performing_configs: worstPerforming,
    recommended_adjustments: recommendations
  }
}

function createEmptyMetrics(): GenerationMetrics {
  return {
    citation_coverage: 0,
    relevance_score: 0,
    verbosity_ratio: 0,
    fact_density: 0,
    depth_score: 0,
    coherence_score: 0,
    style_score: 0,
    technical_accuracy: 0,
    source_integration: 0,
    argument_structure: 0,
    readability_score: 0,
    jargon_density: 0,
    bias_score: 0,
    novelty_score: 0
  }
}

function createEmptyAggregatedMetrics(period: 'hour' | 'day' | 'week'): AggregatedMetrics {
  const emptyMetrics = createEmptyMetrics()
  const keys = Object.keys(emptyMetrics) as Array<keyof GenerationMetrics>
  
  const emptyTrends = keys.reduce((trends, key) => {
    trends[key] = {
      current: 0,
      previous: 0,
      change_percent: null,
      trend: 'stable' as const
    }
    return trends
  }, {} as AggregatedMetrics['metric_trends'])
  
  return {
    period,
    total_sections: 0,
    average_metrics: emptyMetrics,
    metric_trends: emptyTrends,
    performance_insights: {
      best_performing_configs: [],
      worst_performing_configs: [],
      recommended_adjustments: ['Insufficient data for recommendations']
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function keywordRelevanceFallback(content: string, topic: string): number {
  const topicWords = topic.toLowerCase().split(' ').filter(w => w.length > 3)
  const contentLower = content.toLowerCase()
  const score = topicWords.reduce((acc, word) => acc + (contentLower.includes(word) ? 0.1 : 0), 0)
  return Math.min(score, 1)
}

/**
 * Calculate overall quality score from metrics
 */
export function calculateOverallQuality(metrics: GenerationMetrics): number {
  return (
    metrics.citation_coverage * 0.2 +
    metrics.relevance_score * 0.2 +
    metrics.fact_density * 0.15 +
    metrics.depth_score * 0.15 +
    metrics.coherence_score * 0.1 +
    metrics.technical_accuracy * 0.1 +
    metrics.source_integration * 0.1
  )
}

/**
 * Aggregate metrics across multiple sections
 */
export function aggregateMetrics(sections: SectionMetrics[]): GenerationMetrics {
  if (sections.length === 0) {
    throw new Error('Cannot aggregate metrics for empty sections array')
  }

  // Sum all numeric metrics
  const aggregate = sections.reduce((acc, section) => {
    const metrics = section.metrics
    return {
      citation_coverage: acc.citation_coverage + metrics.citation_coverage,
      relevance_score: acc.relevance_score + metrics.relevance_score,
      verbosity_ratio: acc.verbosity_ratio + metrics.verbosity_ratio,
      fact_density: acc.fact_density + metrics.fact_density,
      depth_score: acc.depth_score + metrics.depth_score,
      coherence_score: acc.coherence_score + metrics.coherence_score,
      style_score: acc.style_score + metrics.style_score,
      technical_accuracy: acc.technical_accuracy + metrics.technical_accuracy,
      source_integration: acc.source_integration + metrics.source_integration,
      argument_structure: acc.argument_structure + metrics.argument_structure,
      readability_score: acc.readability_score + metrics.readability_score,
      jargon_density: acc.jargon_density + metrics.jargon_density,
      bias_score: acc.bias_score + metrics.bias_score,
      novelty_score: acc.novelty_score + metrics.novelty_score
    }
  }, {
    citation_coverage: 0,
    relevance_score: 0,
    verbosity_ratio: 0,
    fact_density: 0,
    depth_score: 0,
    coherence_score: 0,
    style_score: 0,
    technical_accuracy: 0,
    source_integration: 0,
    argument_structure: 0,
    readability_score: 0,
    jargon_density: 0,
    bias_score: 0,
    novelty_score: 0
  })

  // Calculate averages
  const count = sections.length
  return {
    citation_coverage: aggregate.citation_coverage / count,
    relevance_score: aggregate.relevance_score / count,
    verbosity_ratio: aggregate.verbosity_ratio / count,
    fact_density: aggregate.fact_density / count,
    depth_score: aggregate.depth_score / count,
    coherence_score: aggregate.coherence_score / count,
    style_score: aggregate.style_score / count,
    technical_accuracy: aggregate.technical_accuracy / count,
    source_integration: aggregate.source_integration / count,
    argument_structure: aggregate.argument_structure / count,
    readability_score: aggregate.readability_score / count,
    jargon_density: aggregate.jargon_density / count,
    bias_score: aggregate.bias_score / count,
    novelty_score: aggregate.novelty_score / count
  }
} 