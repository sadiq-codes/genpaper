import 'server-only'

export type GenerationTelemetryEvent =
  | 'generation_stage_timing'
  | 'generation_job_claimed'
  | 'generation_retry_scheduled'

export type GenerationFailureCategory =
  | 'launch'
  | 'queue'
  | 'lease'
  | 'cancelled'
  | 'timeout'
  | 'rate_limit'
  | 'model'
  | 'context'
  | 'extraction'
  | 'analysis'
  | 'section_generation'
  | 'finalization'
  | 'unknown'

export interface StructuredGenerationFailure {
  category: GenerationFailureCategory
  reason: string
}

export type GenerationFailureSubstep = string

export class GenerationSubstepError extends Error {
  readonly substep: GenerationFailureSubstep
  readonly causeMessage: string

  constructor(substep: GenerationFailureSubstep, cause: unknown) {
    const causeMessage =
      cause instanceof Error ? cause.message : String(cause || 'Unknown failure')

    super(`${substep} failed: ${causeMessage}`)
    this.name = 'GenerationSubstepError'
    this.substep = substep
    this.causeMessage = causeMessage
  }
}

export function wrapGenerationSubstepError(
  substep: GenerationFailureSubstep,
  error: unknown
): GenerationSubstepError {
  if (error instanceof GenerationSubstepError) {
    return error
  }

  return new GenerationSubstepError(substep, error)
}

export function getGenerationFailureSubstep(error: unknown): GenerationFailureSubstep | null {
  if (error instanceof GenerationSubstepError) {
    return error.substep
  }

  return null
}

const CATEGORY_RULES: Array<{
  category: GenerationFailureCategory
  patterns: RegExp[]
}> = [
  { category: 'launch', patterns: [/launch generation worker/i, /worker launch/i] },
  { category: 'queue', patterns: [/queue/i, /claim generation job/i, /enqueue generation job/i] },
  { category: 'lease', patterns: [/lease/i, /heartbeat/i, /ownership changed/i] },
  { category: 'cancelled', patterns: [/cancelled/i, /canceled/i] },
  { category: 'timeout', patterns: [/timeout/i, /timed out/i, /deadline/i] },
  { category: 'rate_limit', patterns: [/rate limit/i, /\b429\b/, /too many requests/i] },
  { category: 'model', patterns: [/model/i, /openai/i, /anthropic/i, /provider/i] },
  { category: 'context', patterns: [/context/i, /outline/i, /profile/i, /readiness/i] },
  { category: 'extraction', patterns: [/extract/i, /theme/i] },
  { category: 'analysis', patterns: [/analysis/i] },
  { category: 'section_generation', patterns: [/section/i, /rewrite/i, /draft/i] },
  { category: 'finalization', patterns: [/finaliz/i, /complete run/i] },
]

export function classifyGenerationFailure(
  message: string,
  stage?: string | null
): StructuredGenerationFailure {
  const normalizedMessage = message.trim()
  const normalizedStage = (stage || '').toLowerCase()

  const stageCategoryMap: Record<string, GenerationFailureCategory> = {
    init: 'context',
    initialization: 'context',
    profile: 'context',
    discover: 'context',
    'content-readiness': 'context',
    contexts: 'context',
    'analyze-findings': 'analysis',
    'build-contexts': 'context',
    'extract-check': 'extraction',
    extract: 'extraction',
    extraction: 'extraction',
    analysis: 'analysis',
    'verify-context-cache': 'context',
    completion: 'finalization',
    'completion-gate': 'finalization',
    finalize: 'finalization',
    resuming: 'section_generation',
    queued: 'queue',
  }

  if (normalizedStage.startsWith('section-')) {
    return { category: 'section_generation', reason: normalizedMessage || 'Section generation failed' }
  }

  if (normalizedStage.startsWith('extract-batch-')) {
    return { category: 'extraction', reason: normalizedMessage || 'Extraction failed' }
  }

  for (const [stageKey, category] of Object.entries(stageCategoryMap)) {
    if (normalizedStage === stageKey) {
      return { category, reason: normalizedMessage || `${stageKey} failed` }
    }
  }

  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalizedMessage))) {
      return { category: rule.category, reason: normalizedMessage || `${rule.category} failed` }
    }
  }

  return {
    category: 'unknown',
    reason: normalizedMessage || 'Generation failed',
  }
}
