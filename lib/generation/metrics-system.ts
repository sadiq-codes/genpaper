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
  
  // Content structure metrics
  paragraph_count: number
  average_paragraph_length: number
  transition_word_density: number
  
  // Citation quality metrics
  citation_density: number // citations per 100 words
  citation_diversity: number // unique papers cited / total papers available
  citation_distribution: number // evenness of citation distribution
  
  // Depth and complexity metrics
  depth_cue_coverage: number // percentage of required depth cuesCovered
  argument_complexity: number // based on logical connectors and structure
  evidence_integration: number // how well citations support claims
  
  // Composite score
  overall_quality: number // weighted composite score
}

export interface SectionMetrics extends GenerationMetrics {
  section_id: string
  paper_type: string
  section_key: string
  topic: string
  word_count: number
  generation_time_ms: number
  model_used: string
  prompt_version: string
  tokens_used?: number
  timestamp: string
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
  requiredDepthCues: string[]
): GenerationMetrics {
  const words = countWords(content)
  const sentences = countSentences(content)
  const paragraphs = countParagraphs(content)
  const citations = extractCitationReferences(content)

  const relevance = 0 // initial placeholder; overwritten by async embedding similarity

  const baseMetrics = {
    citation_coverage: calculateCitationCoverage(citations, availablePapers),
    relevance_score: relevance,
    verbosity_ratio: calculateVerbosityRatio(),
    fact_density: calculateFactDensity(content, sentences),
    paragraph_count: paragraphs,
    average_paragraph_length: words / Math.max(1, paragraphs),
    transition_word_density: calculateTransitionWordDensity(content, words),
    citation_density: (citations.length / words) * 100,
    citation_diversity: calculateCitationDiversity(citations, availablePapers),
    citation_distribution: calculateCitationDistribution(citations),
    depth_cue_coverage: calculateDepthCueCoverage(content, requiredDepthCues),
    argument_complexity: calculateArgumentComplexity(content),
    evidence_integration: calculateEvidenceIntegration(content, citations)
  }

  const overall_quality = (
    baseMetrics.citation_coverage * 0.25 +
    baseMetrics.relevance_score * 0.25 +
    baseMetrics.fact_density * 0.20 +
    baseMetrics.depth_cue_coverage * 0.15 +
    baseMetrics.evidence_integration * 0.15
  )

  return { ...baseMetrics, overall_quality }
}

export async function calculateContentMetricsAsync(
  content: string,
  topic: string,
  availablePapers: string[],
  contextChunks: string[],
  requiredDepthCues: string[]
): Promise<GenerationMetrics> {
  // First compute fast heuristics synchronously
  const base = calculateContentMetrics(content, topic, availablePapers, contextChunks, requiredDepthCues)

  // Try embedding similarity for relevance
  const topicEmb = await fetchOpenAiEmbedding(topic)
  const contentEmb = await fetchOpenAiEmbedding(content.slice(0, 4000)) // limit
  if (topicEmb && contentEmb) {
    base.relevance_score = cosineSimilarity(topicEmb, contentEmb)
  }

  // Re-compute overall quality with updated relevance if changed
  base.overall_quality = (
    base.citation_coverage * 0.25 +
    base.relevance_score * 0.25 +
    base.fact_density * 0.20 +
    base.depth_cue_coverage * 0.15 +
    base.evidence_integration * 0.15
  )

  return base
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
  contentWordCount?: number, // Pass actual word count
  tokensUsed?: number // Actual or estimated token count
): Promise<void> {
  try {
    const supabase = await createClient()
    
    const sectionMetrics: Omit<SectionMetrics, 'timestamp'> = {
      section_id: sectionId,
      paper_type: paperType,
      section_key: sectionKey,
      topic,
      word_count: contentWordCount || 0, // Use provided word count
      generation_time_ms: generationTimeMs,
      model_used: modelUsed,
      prompt_version: promptVersion,
      tokens_used: tokensUsed,
      ...metrics
    }
    
    const { error } = await supabase
      .from('generation_metrics')
      .insert({
        ...sectionMetrics,
        timestamp: new Date().toISOString()
      })
    
    if (error) {
      console.error('Error storing metrics:', error)
    }
  } catch (error) {
    console.error('Error initializing supabase client for metrics:', error)
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
 * Calculate depth cue coverage
 */
function calculateDepthCueCoverage(content: string, requiredDepthCues: string[]): number {
  if (requiredDepthCues.length === 0) return 1
  
  const contentLower = content.toLowerCase()
  const coveredCues = requiredDepthCues.filter(cue => 
    contentLower.includes(cue.toLowerCase())
  )
  
  return coveredCues.length / requiredDepthCues.length
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
    citation_coverage: acc.citation_coverage + metric.citation_coverage,
    relevance_score: acc.relevance_score + metric.relevance_score,
    verbosity_ratio: acc.verbosity_ratio + metric.verbosity_ratio,
    fact_density: acc.fact_density + metric.fact_density,
    paragraph_count: acc.paragraph_count + metric.paragraph_count,
    average_paragraph_length: acc.average_paragraph_length + metric.average_paragraph_length,
    transition_word_density: acc.transition_word_density + metric.transition_word_density,
    citation_density: acc.citation_density + metric.citation_density,
    citation_diversity: acc.citation_diversity + metric.citation_diversity,
    citation_distribution: acc.citation_distribution + metric.citation_distribution,
    depth_cue_coverage: acc.depth_cue_coverage + metric.depth_cue_coverage,
    argument_complexity: acc.argument_complexity + metric.argument_complexity,
    evidence_integration: acc.evidence_integration + metric.evidence_integration,
    overall_quality: acc.overall_quality + metric.overall_quality
  }), createEmptyMetrics())
  
  const count = metrics.length
  return {
    citation_coverage: sums.citation_coverage / count,
    relevance_score: sums.relevance_score / count,
    verbosity_ratio: sums.verbosity_ratio / count,
    fact_density: sums.fact_density / count,
    paragraph_count: sums.paragraph_count / count,
    average_paragraph_length: sums.average_paragraph_length / count,
    transition_word_density: sums.transition_word_density / count,
    citation_density: sums.citation_density / count,
    citation_diversity: sums.citation_diversity / count,
    citation_distribution: sums.citation_distribution / count,
    depth_cue_coverage: sums.depth_cue_coverage / count,
    argument_complexity: sums.argument_complexity / count,
    evidence_integration: sums.evidence_integration / count,
    overall_quality: sums.overall_quality / count
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
      avgMetrics.depth_cue_coverage * 0.15 +
      avgMetrics.evidence_integration * 0.15 +
      avgMetrics.argument_complexity * 0.10
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
    paragraph_count: 0,
    average_paragraph_length: 0,
    transition_word_density: 0,
    citation_density: 0,
    citation_diversity: 0,
    citation_distribution: 0,
    depth_cue_coverage: 0,
    argument_complexity: 0,
    evidence_integration: 0,
    overall_quality: 0
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