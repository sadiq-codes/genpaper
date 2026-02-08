/**
 * Embedding Generation Utility
 * 
 * Centralized embedding generation to avoid circular dependencies
 * between papers.ts and text utilities
 * 
 * Supports two providers (in priority order):
 * 1. Self-hosted TEI server - if EMBEDDING_SERVER_URL set
 * 2. Direct OpenAI - default fallback
 */

import { embedMany } from 'ai'
import { getEmbeddingModel, EMBEDDING_CONFIG, isSelfHostedEmbeddingConfigured } from '@/lib/ai/vercel-client'

// Re-export for backwards compatibility
export { EMBEDDING_CONFIG } from '@/lib/ai/vercel-client'

// Track if we've logged the provider (to avoid spam)
let hasLoggedProvider = false

/**
 * Call TEI (Text Embeddings Inference) server directly
 * TEI uses a different API format than OpenAI
 */
async function callTEI(inputs: string[]): Promise<number[][]> {
  const url = process.env.EMBEDDING_SERVER_URL
  if (!url) throw new Error('EMBEDDING_SERVER_URL not set')
  
  const response = await fetch(`${url}/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs }),
  })
  
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`TEI error ${response.status}: ${error}`)
  }
  
  // TEI returns array of arrays directly
  const embeddings = await response.json() as number[][]
  return embeddings
}

/**
 * Generate embeddings for input text(s) using centralized configuration
 */
export async function generateEmbeddings(inputs: string | string[]): Promise<number[][]> {
  const inputArray = Array.isArray(inputs) ? inputs : [inputs]
  
  if (inputArray.length === 0) {
    return []
  }

  const isTEI = isSelfHostedEmbeddingConfigured()
  const provider = isTEI ? 'TEI' : 'OpenAI'

  // Log provider on first use (helps verify which provider is being used)
  if (!hasLoggedProvider) {
    const providerDetails = isTEI
      ? `TEI BGE-large-en-v1.5 (${EMBEDDING_CONFIG.dimensions} dims) @ ${process.env.EMBEDDING_SERVER_URL}`
      : `OpenAI text-embedding-3-large (${EMBEDDING_CONFIG.dimensions} dims)`
    console.log(`📊 Embedding provider: ${providerDetails}`)
    hasLoggedProvider = true
  }

  const startTime = Date.now()
  
  try {
    let embeddings: number[][]
    
    // Use TEI if configured (faster, self-hosted)
    if (isTEI) {
      embeddings = await callTEI(inputArray)
    } else {
      // Fallback to OpenAI
      const model = getEmbeddingModel()
      
      const result = await embedMany({
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
      
      embeddings = result.embeddings
    }
    
    const duration = Date.now() - startTime
    
    // Log timing for monitoring (always log in production for visibility)
    if (duration > 500 || process.env.NODE_ENV === 'production') {
      console.log(`[Embedding] ${provider}: ${duration}ms for ${inputArray.length} text(s)`)
    }
    
    return embeddings
  } catch (error) {
    const duration = Date.now() - startTime
    console.error(`[Embedding] ${provider} failed after ${duration}ms:`, error)
    throw new Error(`Embedding generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
} 