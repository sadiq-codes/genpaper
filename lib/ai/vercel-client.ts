import { createOpenAI } from '@ai-sdk/openai'
import { createAzure } from '@ai-sdk/azure'
import { 
  getModel, 
  getChatModel as getChatModelName, 
  getAutocompleteModel as getAutocompleteModelName, 
  getFastAutocompleteModel as getFastAutocompleteModelName, 
  getExtractionModel as getExtractionModelName, 
  EMBEDDING_CONFIG, 
  getAzureEmbeddingDeployment,
  isAzureOpenAIConfigured,
  isSelfHostedEmbeddingConfigured,
  shouldUseAzureOpenAIForLLM,
  shouldUseOpenAIForGeneration,
  shouldUseOpenAIForExtraction,
  getAzureDeploymentForModel
} from './config'

// Vercel AI SDK client for paper generation (OpenAI)
export const ai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
})

// Azure OpenAI client (lazy initialized)
let azureClient: ReturnType<typeof createAzure> | null = null

function getAzureClientForLLM() {
  if (!azureClient) {
    azureClient = createAzure({
      resourceName: process.env.AZURE_OPENAI_RESOURCE_NAME!,
      apiKey: process.env.AZURE_OPENAI_API_KEY!,
    })
  }
  return azureClient
}

/**
 * Get a language model instance for the given model name
 * Uses Azure OpenAI if USE_AZURE_OPENAI=true, otherwise OpenAI
 */
function getLanguageModelForName(modelName: string) {
  if (shouldUseAzureOpenAIForLLM()) {
    const deployment = getAzureDeploymentForModel(modelName)
    return getAzureClientForLLM().languageModel(deployment)
  }
  return ai.languageModel(modelName)
}

/**
 * Get the configured language model instance
 * Model is determined by AI_MODEL env var (defaults to gpt-4o)
 */
export function getLanguageModel() {
  return getLanguageModelForName(getModel())
}

/**
 * Get the chat model for editor chat interactions
 * Uses GPT-4.1 for fast responses and good instruction following
 * Override with AI_CHAT_MODEL env var
 */
export function getChatLanguageModel() {
  return getLanguageModelForName(getChatModelName())
}

/**
 * Get the configured autocomplete model instance
 * Uses a faster model (gpt-4.1-mini by default) for low-latency completions
 * Override with AI_AUTOCOMPLETE_MODEL env var
 */
export function getAutocompleteLanguageModel() {
  return getLanguageModelForName(getAutocompleteModelName())
}

/**
 * Get ultra-fast autocomplete model for simple completions
 * Used when citations are disabled for maximum speed
 * Override with AI_FAST_AUTOCOMPLETE_MODEL env var
 */
export function getFastAutocompleteLanguageModel() {
  return getLanguageModelForName(getFastAutocompleteModelName())
}

/**
 * Get the extraction model for paper processing
 * Uses OpenAI directly if USE_OPENAI_FOR_EXTRACTION=true (bypasses Azure rate limits)
 * Otherwise uses the standard language model (Azure or OpenAI based on config)
 * Override model with AI_EXTRACTION_MODEL env var
 */
export function getExtractionLanguageModel() {
  if (shouldUseOpenAIForExtraction()) {
    return ai.languageModel(getExtractionModelName())
  }
  return getLanguageModelForName(getExtractionModelName())
}

/**
 * Get the generation model for paper writing
 * Uses OpenAI directly if USE_OPENAI_FOR_GENERATION=true (bypasses Azure rate limits)
 * Otherwise uses the standard language model (Azure or OpenAI based on config)
 */
export function getGenerationModel() {
  if (shouldUseOpenAIForGeneration()) {
    return ai.languageModel(getModel())
  }
  return getLanguageModel()
}

/**
 * Get Azure OpenAI client for embeddings
 */
function getAzureClientForEmbeddings() {
  return createAzure({
    resourceName: process.env.AZURE_OPENAI_RESOURCE_NAME!,
    apiKey: process.env.AZURE_OPENAI_API_KEY!,
  })
}

/**
 * Get the embedding model instance.
 * 
 * Priority:
 * 1. Self-hosted TEI server (if EMBEDDING_SERVER_URL is set)
 * 2. Azure OpenAI (if AZURE_OPENAI_RESOURCE_NAME is set)
 * 3. OpenAI text-embedding-3-large (fallback)
 */
export function getEmbeddingModel() {
  // 1. Self-hosted TEI
  if (isSelfHostedEmbeddingConfigured()) {
    const embeddingClient = createOpenAI({
      baseURL: `${process.env.EMBEDDING_SERVER_URL}/v1`,
      apiKey: 'unused', // Self-hosted doesn't need API key
    })
    return embeddingClient.embedding('bge-large-en-v1.5')
  }
  
  // 2. Azure OpenAI
  if (isAzureOpenAIConfigured()) {
    const azure = getAzureClientForEmbeddings()
    return azure.embedding(getAzureEmbeddingDeployment())
  }
  
  // 3. OpenAI (fallback)
  return ai.embedding('text-embedding-3-large')
}

/**
 * Get the current embedding provider name (for logging/debugging)
 */
export function getEmbeddingProviderName(): string {
  if (isSelfHostedEmbeddingConfigured()) {
    return `TEI BGE-large-en-v1.5 (${EMBEDDING_CONFIG.dimensions} dims) @ ${process.env.EMBEDDING_SERVER_URL}`
  }
  if (isAzureOpenAIConfigured()) {
    return `Azure OpenAI ${getAzureEmbeddingDeployment()} (${EMBEDDING_CONFIG.dimensions} dims)`
  }
  return `OpenAI text-embedding-3-large (${EMBEDDING_CONFIG.dimensions} dims)`
}

// Re-export config for convenience
export { getModel, EMBEDDING_CONFIG, isSelfHostedEmbeddingConfigured } from './config'

// Re-export commonly used types for convenience
export type { 
  ModelMessage,
  LanguageModel
} from 'ai' 