/**
 * Embedding Generation Utility
 * 
 * Centralized embedding generation to avoid circular dependencies
 * between papers.ts and text utilities
 * 
 * Supports three providers (in priority order):
 * 1. Azure OpenAI - if AZURE_OPENAI_RESOURCE_NAME + AZURE_OPENAI_API_KEY set
 * 2. Self-hosted server - if EMBEDDING_SERVER_URL set
 * 3. Direct OpenAI - default fallback
 */

import { embedMany } from 'ai'
import { getEmbeddingModel, EMBEDDING_CONFIG, getEmbeddingProviderName } from '@/lib/ai/vercel-client'

// Re-export for backwards compatibility
export { EMBEDDING_CONFIG } from '@/lib/ai/vercel-client'

// Track if we've logged the provider (to avoid spam)
let hasLoggedProvider = false

/**
 * Generate embeddings for input text(s) using centralized configuration
 */
export async function generateEmbeddings(inputs: string | string[]): Promise<number[][]> {
  const inputArray = Array.isArray(inputs) ? inputs : [inputs]
  
  if (inputArray.length === 0) {
    return []
  }

  // Log provider on first use (helps verify which provider is being used)
  if (!hasLoggedProvider) {
    const provider = getEmbeddingProviderName()
    console.log(`📊 Embedding provider: ${provider}`)
    hasLoggedProvider = true
  }

  try {
    const model = getEmbeddingModel()
    
    const { embeddings } = await embedMany({
      model,
      values: inputArray,
      // Request 1024 dimensions from OpenAI text-embedding-3-small
      providerOptions: {
        openai: {
          dimensions: EMBEDDING_CONFIG.dimensions,
        },
      },
      experimental_telemetry: { isEnabled: false },
    })
    
    return embeddings
  } catch (error) {
    console.error('Failed to generate embeddings:', error)
    throw new Error(`Embedding generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
} 