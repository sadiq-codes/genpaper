/**
 * Centralized AI Configuration
 * 
 * Single source of truth for AI model settings.
 * Change the model via AI_MODEL environment variable.
 */

// Default models if not specified in environment
const DEFAULT_MODEL = 'gpt-4o-2024-11-20'
const DEFAULT_AUTOCOMPLETE_MODEL = 'gpt-4.1-2025-04-14' // Faster model for inline completions

/**
 * Get the configured AI model from environment
 * Supports any model string (OpenAI, Anthropic, etc.)
 * 
 * Examples:
 *   - gpt-5-mini-2025-08-07
 *   - gpt-5-nano
 */
export function getModel(): string {
  return process.env.AI_MODEL || DEFAULT_MODEL
}

/**
 * Get the configured autocomplete model from environment
 * Uses a faster model by default for low-latency inline completions
 * 
 * Set AI_AUTOCOMPLETE_MODEL env var to override
 * Falls back to gpt-4o-mini for speed
 */
export function getAutocompleteModel(): string {
  return process.env.AI_AUTOCOMPLETE_MODEL || DEFAULT_AUTOCOMPLETE_MODEL
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
