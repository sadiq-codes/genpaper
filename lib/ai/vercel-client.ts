import { createOpenAI } from '@ai-sdk/openai'
import { getModel, getChatModel as getChatModelName, getAutocompleteModel as getAutocompleteModelName, getFastAutocompleteModel as getFastAutocompleteModelName, getExtractionModel as getExtractionModelName, EMBEDDING_CONFIG } from './config'

// Vercel AI SDK client for paper generation
export const ai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
  // You can add custom headers or baseURL here if needed
  // baseURL: process.env.OPENAI_BASE_URL
})

/**
 * Get the configured language model instance
 * Model is determined by AI_MODEL env var (defaults to gpt-4o)
 */
export function getLanguageModel() {
  return ai.languageModel(getModel())
}

/**
 * Get the chat model for editor chat interactions
 * Uses GPT-4.1 for fast responses and good instruction following
 * Override with AI_CHAT_MODEL env var
 */
export function getChatLanguageModel() {
  return ai.languageModel(getChatModelName())
}

/**
 * Get the configured autocomplete model instance
 * Uses a faster model (gpt-4o-mini by default) for low-latency completions
 * Override with AI_AUTOCOMPLETE_MODEL env var
 */
export function getAutocompleteLanguageModel() {
  return ai.languageModel(getAutocompleteModelName())
}

/**
 * Get ultra-fast autocomplete model for simple completions
 * Used when citations are disabled for maximum speed
 * Override with AI_FAST_AUTOCOMPLETE_MODEL env var
 */
export function getFastAutocompleteLanguageModel() {
  return ai.languageModel(getFastAutocompleteModelName())
}

/**
 * Get the extraction model for paper processing
 * Uses a smaller, faster model since extraction is a structured task
 * Override with AI_EXTRACTION_MODEL env var
 */
export function getExtractionLanguageModel() {
  return ai.languageModel(getExtractionModelName())
}

/**
 * Get the embedding model instance.
 * 
 * When EMBEDDING_SERVER_URL is set, uses a self-hosted all-MiniLM-L6-v2 server
 * (OpenAI-compatible endpoint). Otherwise falls back to OpenAI's API.
 * 
 * Set EMBEDDING_SERVER_URL=http://<your-server>:8787 in .env.local
 * Set EMBEDDING_API_TOKEN to the token configured on the server (optional)
 */
export function getEmbeddingModel() {
  if (process.env.EMBEDDING_SERVER_URL) {
    const embeddingClient = createOpenAI({
      baseURL: `${process.env.EMBEDDING_SERVER_URL}/v1`,
      apiKey: process.env.EMBEDDING_API_TOKEN || 'unused',
    })
    return embeddingClient.embedding(EMBEDDING_CONFIG.model)
  }
  return ai.embedding(EMBEDDING_CONFIG.model)
}

// Re-export config for convenience
export { getModel, EMBEDDING_CONFIG } from './config'

// Re-export commonly used types for convenience
export type { 
  ModelMessage,
  LanguageModel
} from 'ai' 