/**
 * Centralized AI Configuration
 * 
 * Single source of truth for AI model settings.
 * Change the model via AI_MODEL environment variable.
 */

// Default model if not specified in environment
const DEFAULT_MODEL = 'gpt-4o'

/**
 * Get the configured AI model from environment
 * Supports any model string (OpenAI, Anthropic, etc.)
 * 
 * Examples:
 *   - gpt-4o
 *   - gpt-4o-mini
 *   - gpt-4-turbo
 */
export function getModel(): string {
  return process.env.AI_MODEL || DEFAULT_MODEL
}

/**
 * Embedding configuration (OpenAI only)
 * Note: Changing embedding model requires re-embedding all stored vectors
 */
export const EMBEDDING_CONFIG = {
  model: 'text-embedding-3-small',
  dimensions: 384,
} as const

export type EmbeddingConfig = typeof EMBEDDING_CONFIG
