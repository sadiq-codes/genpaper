import { createOpenAI } from '@ai-sdk/openai'
import { getModel, getAutocompleteModel as getAutocompleteModelName, EMBEDDING_CONFIG } from './config'

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
 * Get the configured autocomplete model instance
 * Uses a faster model (gpt-4o-mini by default) for low-latency completions
 * Override with AI_AUTOCOMPLETE_MODEL env var
 */
export function getAutocompleteLanguageModel() {
  return ai.languageModel(getAutocompleteModelName())
}

/**
 * Get the embedding model instance
 * Always uses OpenAI embeddings regardless of chat model
 */
export function getEmbeddingModel() {
  return ai.embedding(EMBEDDING_CONFIG.model)
}

// Re-export config for convenience
export { getModel, EMBEDDING_CONFIG } from './config'

// Re-export commonly used types for convenience
export type { 
  ModelMessage,
  LanguageModel
} from 'ai' 