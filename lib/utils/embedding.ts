/**
 * Embedding Generation Utility
 * 
 * Centralized embedding generation to avoid circular dependencies
 * between papers.ts and chunk-processor.ts
 */

import { openai } from '@ai-sdk/openai'
import { embedMany } from 'ai'

// Centralized embedding configuration
export const EMBEDDING_CONFIG = {
  model: 'text-embedding-3-small',
  dimensions: 384
} as const

/**
 * Generate embeddings for input text(s) using centralized configuration
 */
export async function generateEmbeddings(inputs: string | string[]): Promise<number[][]> {
  const inputArray = Array.isArray(inputs) ? inputs : [inputs]
  
  if (inputArray.length === 0) {
    return []
  }

  try {
    const { embeddings } = await embedMany({
      model: openai.embedding(EMBEDDING_CONFIG.model, {
        dimensions: EMBEDDING_CONFIG.dimensions
      }),
      values: inputArray
    })
    
    return embeddings
  } catch (error) {
    console.error('Failed to generate embeddings:', error)
    throw new Error(`Embedding generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
} 