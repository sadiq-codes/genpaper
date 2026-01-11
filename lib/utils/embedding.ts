/**
 * Embedding Generation Utility
 * 
 * Centralized embedding generation to avoid circular dependencies
 * between papers.ts and text utilities
 */

import { embedMany } from 'ai'
import { getEmbeddingModel } from '@/lib/ai/vercel-client'

// Re-export for backwards compatibility
export { EMBEDDING_CONFIG } from '@/lib/ai/vercel-client'

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
      model: getEmbeddingModel(),
      values: inputArray
    })
    
    return embeddings
  } catch (error) {
    console.error('Failed to generate embeddings:', error)
    throw new Error(`Embedding generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
} 