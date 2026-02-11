/**
 * Centralized AI Configuration
 * 
 * Single source of truth for AI model settings.
 * Change the model via AI_MODEL environment variable.
 */

// Default models if not specified in environment
// GPT-4.1 family: smartest non-reasoning models with 1M context window
const DEFAULT_MODEL = 'gpt-4.1' // Smartest non-reasoning model, 1M context, optimized for coding/long-context
const DEFAULT_CHAT_MODEL = 'gpt-4.1' // Advanced model for editor chat (excellent instruction following)
const DEFAULT_AUTOCOMPLETE_MODEL = 'gpt-4.1-mini' // Fast, cost-efficient for inline completions
const DEFAULT_FAST_AUTOCOMPLETE_MODEL = 'gpt-4.1-nano' // Fastest, most cost-efficient for high-volume tasks
const DEFAULT_EXTRACTION_MODEL = 'gpt-4.1-nano' // Fast model for paper extraction (structured task)

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
 * Falls back to gpt-4.1-mini for speed
 */
export function getAutocompleteModel(): string {
  return process.env.AI_AUTOCOMPLETE_MODEL || DEFAULT_AUTOCOMPLETE_MODEL
}

/**
 * Get ultra-fast autocomplete model for simple completions
 * Used when citations are disabled (skipRAG=true) for maximum speed
 * 
 * Set AI_FAST_AUTOCOMPLETE_MODEL env var to override
 * Falls back to gpt-4.1-nano for lowest latency
 */
export function getFastAutocompleteModel(): string {
  return process.env.AI_FAST_AUTOCOMPLETE_MODEL || DEFAULT_FAST_AUTOCOMPLETE_MODEL
}

/**
 * Get the extraction model for paper processing
 * Uses a smaller, faster model since extraction is a structured task
 * 
 * Set AI_EXTRACTION_MODEL env var to override
 * Defaults to gpt-4.1-nano for cost efficiency
 */
export function getExtractionModel(): string {
  return process.env.AI_EXTRACTION_MODEL || DEFAULT_EXTRACTION_MODEL
}

/**
 * Get the chat model for editor chat interactions
 * Uses GPT-4.1 for fast responses and good instruction following
 * 
 * Set AI_CHAT_MODEL env var to override
 */
export function getChatModel(): string {
  return process.env.AI_CHAT_MODEL || DEFAULT_CHAT_MODEL
}

/**
 * Embedding configuration
 * Note: Changing embedding model requires re-embedding all stored vectors
 * 
 * Current model: OpenAI text-embedding-3-large (1024 dimensions)
 * - Best quality on MTEB benchmark (~64.6%)
 * - Better than BGE-large for academic/scientific text
 * - Uses Matryoshka embeddings (can truncate to 1024 dims with minimal quality loss)
 * - Cost: $0.13/1M tokens
 * 
 * Falls back to self-hosted TEI if EMBEDDING_SERVER_URL is set
 */
export const EMBEDDING_CONFIG = {
  model: 'text-embedding-3-large',
  dimensions: 1024, // Truncated from 3072 using Matryoshka
} as const

export type EmbeddingConfig = typeof EMBEDDING_CONFIG

/**
 * Get Azure OpenAI embedding deployment name
 * This is the name you gave when deploying the model in Azure OpenAI Studio
 * Defaults to the model name if not specified
 */
export function getAzureEmbeddingDeployment(): string {
  return process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || EMBEDDING_CONFIG.model
}

/**
 * Check if Azure OpenAI is configured for embeddings
 */
export function isAzureOpenAIConfigured(): boolean {
  return !!(process.env.AZURE_OPENAI_RESOURCE_NAME && process.env.AZURE_OPENAI_API_KEY)
}

/**
 * Check if self-hosted embedding server is configured
 */
export function isSelfHostedEmbeddingConfigured(): boolean {
  return !!process.env.EMBEDDING_SERVER_URL
}
