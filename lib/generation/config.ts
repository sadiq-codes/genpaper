import type { PaperLength } from '@/lib/ai/generation-defaults'
import { 
  GENERATION_DEFAULTS, 
  getMinCitationCoverage,
  getMinCitationFloor,
  getEvidenceSnippetLength
} from '@/lib/ai/generation-defaults'
import { mergeWithDefaults } from '@/lib/ai/generation-config-schema'

// Re-export configuration utilities
export { 
  GENERATION_DEFAULTS,
  getMinCitationCoverage, 
  getMinCitationFloor,
  getEvidenceSnippetLength,
  mergeWithDefaults
}

// Utility functions for generation configuration
// Use default word targets instead of template-derived ones
export function getTargetLength(length?: PaperLength, paperType?: string): number {
  // Use standard academic section lengths based on paper type
  const standardLengths: Record<string, number> = {
    'research-paper': 8000,
    'review-paper': 6000,
    'case-study': 5000,
    'short-paper': 3000,
    'conference-paper': 4000,
    'journal-article': 7000,
    'thesis-chapter': 10000,
    'default': 5000
  }
  
  return standardLengths[paperType || 'default'] || standardLengths.default
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

/**
 * Block generation configuration constants
 * Extracted from hardcoded values for better maintainability
 */
export const BLOCK_GENERATION_CONFIG = {
  maxSteps: 5,
  temperature: 0.2,
  bufferSizeLimit: 800,
  progressReportInterval: 20,
  defaultModel: 'gpt-4o',
  sentenceBreakPoints: /[.!?]\s+/g,
  wordBoundaryThreshold: 2, // Minimum words before force-breaking
} as const

/**
 * Block detection thresholds and patterns
 */
export const BLOCK_DETECTION_CONFIG = {
  minParagraphLength: 50,
  maxBufferSize: 800,
  forceBreakAtSentence: true,
  headingLevels: [1, 2, 3, 4, 5, 6] as const,
  codeBlockLanguages: ['javascript', 'typescript', 'python', 'sql', 'bash', 'json', 'yaml'] as const
} as const