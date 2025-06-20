import type { PaperLength } from '@/lib/ai/generation-defaults'
import { 
  GENERATION_DEFAULTS, 
  buildLiteratureSectionRegex,
  getMinCitationCoverage,
  getMinCitationFloor,
  getEvidenceSnippetLength
} from '@/lib/ai/generation-defaults'
import { mergeWithDefaults } from '@/lib/ai/generation-config-schema'
import { loadPrompts } from '@/lib/prompts/loader'
import type { PaperTypeKey } from '@/lib/prompts/types'

// Re-export configuration utilities
export { 
  GENERATION_DEFAULTS,
  buildLiteratureSectionRegex,
  getMinCitationCoverage, 
  getMinCitationFloor,
  getEvidenceSnippetLength,
  mergeWithDefaults
}

// Utility functions for generation configuration
// Derive aggregate word target from prompt templates if available
function deriveWordTargetFromTemplate(paperType?: string): number | null {
  try {
    if (!paperType) return null
    const { paperTypes } = loadPrompts()
    const typeConfig = paperTypes[paperType as PaperTypeKey]
    if (!typeConfig) return null
    const total = Object.values(typeConfig.sections).reduce((sum, sec) => {
      const words = (sec as { expectedLength?: { words?: number } }).expectedLength?.words
      return words ? sum + words : sum
    }, 0)
    return total > 0 ? total : null
  } catch (err) {
    console.warn('Failed to derive word target from template:', err)
    return null
  }
}

export function getTargetLength(_length?: PaperLength, paperType?: string): number {
  const templated = deriveWordTargetFromTemplate(paperType)
  if (templated) return templated
  throw new Error(`No expectedLength.words defined in prompt templates for paperType '${paperType}'. Please add explicit word counts to every section.`)
}

export function getChunkLimit(length?: PaperLength, paperType?: string): number {
  const words = getTargetLength(length, paperType)
  return Math.max(20, Math.ceil(words / 225))
}

export function getMaxTokens(length?: PaperLength, paperType?: string): number {
  const words = getTargetLength(length, paperType)
  const tokensPerWordRatio = GENERATION_DEFAULTS.TOKENS_PER_WORD_RATIO
  const fudgeFactor = GENERATION_DEFAULTS.TOKEN_FUDGE_FACTOR
  const estimated = Math.floor(words * fudgeFactor * tokensPerWordRatio)
  return Math.min(estimated, GENERATION_DEFAULTS.MODEL_COMPLETION_TOKEN_LIMIT)
}

// Scoring thresholds
const MIN_SEMANTIC_SCORE = GENERATION_DEFAULTS.MIN_SEMANTIC_SCORE;
const MIN_KEYWORD_SCORE = GENERATION_DEFAULTS.MIN_KEYWORD_SCORE;

// Helper function to check if scores are acceptable
export function isScoreAcceptable(
  semanticScore?: number,
  keywordScore?: number,
  permissive = false
): boolean {
  const semanticThreshold = permissive ? GENERATION_DEFAULTS.MIN_SEMANTIC_SCORE_PERMISSIVE : MIN_SEMANTIC_SCORE;
  const keywordThreshold = permissive ? GENERATION_DEFAULTS.MIN_KEYWORD_SCORE_PERMISSIVE : MIN_KEYWORD_SCORE;
  
  // If we have a semantic score, check if it meets threshold
  if (typeof semanticScore === 'number') {
    return semanticScore >= semanticThreshold;
  }
  
  // If no semantic score but we have keyword score, check that
  if (typeof keywordScore === 'number') {
    return keywordScore >= keywordThreshold;
  }
  
  // If no scores at all, only acceptable in permissive mode or if we're being lenient
  return permissive;
}

// Helper function to check if scores indicate the paper should be dropped
export function hasUnacceptableScores(
  semanticScore?: number,
  keywordScore?: number,
  permissive = false
): boolean {
  const semanticThreshold = permissive ? GENERATION_DEFAULTS.MIN_SEMANTIC_SCORE_PERMISSIVE : MIN_SEMANTIC_SCORE;
  const keywordThreshold = permissive ? GENERATION_DEFAULTS.MIN_KEYWORD_SCORE_PERMISSIVE : MIN_KEYWORD_SCORE;
  
  // If we have both scores and both are below threshold, definitely drop
  if (typeof semanticScore === 'number' && typeof keywordScore === 'number') {
    return semanticScore < semanticThreshold && keywordScore <= keywordThreshold;
  }
  
  // If we have only semantic score and it's below threshold, drop
  if (typeof semanticScore === 'number' && typeof keywordScore !== 'number') {
    return semanticScore < semanticThreshold;
  }
  
  // If we have only keyword score and it's below threshold, drop  
  if (typeof keywordScore === 'number' && typeof semanticScore !== 'number') {
    return keywordScore <= keywordThreshold;
  }
  
  // If no scores at all, drop unless we're in permissive mode
  return !permissive;
} 