/**
 * Ingestion Policy Module
 * 
 * Centralizes decision-making for auto-ingestion to ensure security,
 * cost-control, and consistent behavior.
 */

export interface IngestPolicyContext {
  userId?: string;
  librarySize: number;
  explicitForce?: boolean;
}

/**
 * Decides whether to auto-ingest papers based on a server-side policy.
 * This prevents frontend manipulation while allowing explicit admin overrides.
 * 
 * @param ctx - The context for the policy decision.
 * @returns `true` if papers should be ingested, `false` otherwise.
 */
export function decideIngest(ctx: IngestPolicyContext): boolean {
  // Always respect an explicit flag when provided (for admin/testing)
  if (ctx.explicitForce !== undefined) {
    console.log(
      `🔒 Ingest policy override: ${ctx.explicitForce} (user: ${
        ctx.userId?.substring(0, 8) || 'unknown'
      }, library: ${ctx.librarySize})`
    );
    return ctx.explicitForce;
  }

  // Server-side threshold from environment (default: 5)
  // For content acquisition, we're more aggressive since we need full-text content
  const threshold = Number(process.env.AUTO_INGEST_THRESHOLD ?? '20'); // Increased from 5 to 20
  const shouldIngest = ctx.librarySize < threshold;

  if (shouldIngest) {
    console.log(`🤖 Auto-ingest policy triggered: library size ${ctx.librarySize} is less than threshold ${threshold}.`);
  }

  return shouldIngest;
}

/**
 * Estimates the cost of embedding papers and validates it against a configurable limit.
 * 
 * @param paperCount The number of wpapers to be ingested.
 * @param maxCostUsd The maximum allowed cost in USD.
 * @returns An object indicating if the cost is within limits.
 */
export function validateIngestCost(
  paperCount: number,
  maxCostUsd: number = Number(process.env.MAX_INGEST_COST_USD ?? '5.00')
): { allowed: boolean; estimatedCost: number; reason?: string } {
  // Estimate: ~1000 tokens per abstract, $0.00002 per 1K tokens for text-embedding-3-small
  const EMBEDDING_COST_PER_1K_USD = 0.00002;
  const estimatedCost = paperCount * 1.0 * EMBEDDING_COST_PER_1K_USD; // ~1K tokens per paper

  if (estimatedCost > maxCostUsd) {
    return {
      allowed: false,
      estimatedCost,
      reason: `Estimated cost $${estimatedCost.toFixed(4)} exceeds limit $${maxCostUsd.toFixed(2)}`,
    };
  }

  return { allowed: true, estimatedCost };
}

import type { SectionKey } from '@/lib/prompts/types'
import type { GenerationMetrics } from './metrics-system'

export interface ReflectionDecision {
  useReflection: boolean
  reason: string
  maxCycles?: number
}

const HIGH_STAKES_SECTIONS = new Set([
  'results',
  'discussion',
  'methodology',
  'literatureReview'
])

/**
 * Determines whether to use reflection based on section characteristics and metrics
 */
export function shouldUseReflection(
  section: SectionKey,
  expectedWords: number,
  metrics?: GenerationMetrics
): ReflectionDecision {
  // 1. Size gate - skip reflection for short sections
  if (expectedWords < 400) {
    return {
      useReflection: false,
      reason: 'Section too short (<400 words) for reflection to be cost-effective'
    }
  }

  // 2. Section gate - always use reflection for high-stakes sections
  if (HIGH_STAKES_SECTIONS.has(section)) {
    return {
      useReflection: true,
      reason: `${section} section requires careful reflection for quality`,
      maxCycles: 3 // Extra cycle for high-stakes sections
    }
  }

  // 3. Quality gate - use reflection if initial quality is low
  if (metrics) {
    const qualityScore = calculateQualityScore(metrics)
    if (qualityScore < 75) {
      return {
        useReflection: true,
        reason: `Initial quality score (${qualityScore}) below threshold`,
        maxCycles: 2
      }
    }
  }

  // 4. Default policy for medium-length sections
  if (expectedWords >= 800) {
    return {
      useReflection: true,
      reason: 'Long section (≥800 words) benefits from reflection',
      maxCycles: 2
    }
  }

  return {
    useReflection: false,
    reason: 'Section meets quality thresholds without reflection'
  }
}

/**
 * Calculate composite quality score from metrics
 */
function calculateQualityScore(metrics: GenerationMetrics): number {
  return Math.round(
    metrics.citation_coverage * 20 +
    metrics.relevance_score * 20 +
    metrics.fact_density * 15 +
    metrics.depth_score * 15 +
    metrics.coherence_score * 10 +
    metrics.technical_accuracy * 10 +
    metrics.source_integration * 10
  )
}

/**
 * Estimates token cost savings from adaptive reflection
 */
export function estimateReflectionSavings(
  sections: Array<{ key: SectionKey; words: number }>,
  baseTokenCost: number = 4000 // Approx tokens for base generation
): { 
  totalSaved: number,
  reflectionSections: string[],
  skipSections: string[] 
} {
  const reflectionSections: string[] = []
  const skipSections: string[] = []
  let totalSaved = 0

  sections.forEach(({ key, words }) => {
    const decision = shouldUseReflection(key, words)
    if (decision.useReflection) {
      reflectionSections.push(key)
    } else {
      skipSections.push(key)
      // Reflection typically costs 2x base generation
      totalSaved += baseTokenCost * 2
    }
  })

  return { totalSaved, reflectionSections, skipSections }
} 