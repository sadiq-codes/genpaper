/**
 * Chunk Processor Module
 * 
 * Handles document chunk validation, clamping, batch processing,
 * and retry logic for paper ingestion pipeline.
 */

import { generateEmbeddings } from '@/lib/utils/embedding'
import { getSB } from '@/lib/supabase/server'

export interface ChunkValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
  clampedContent?: string
}

export interface ChunkProcessingOptions {
  maxChunkSize?: number
  minChunkSize?: number
  overlapSize?: number
  retryAttempts?: number
  retryDelayMs?: number
  concurrency?: number
}

export interface ProcessedChunk {
  id: string
  content: string
  metadata: Record<string, unknown>
  embedding?: number[]
  processingTime?: number
  warnings?: string[]
}

export interface FailedChunk {
  id: string
  content: string
  metadata?: Record<string, unknown>
}

export interface ChunkBatchResult {
  successful: ProcessedChunk[]
  failed: Array<{ id: string; error: string; chunk: FailedChunk }>
  stats: {
    total: number
    successful: number
    failed: number
    processingTimeMs: number
  }
}

const DEFAULT_CHUNK_OPTIONS: Required<ChunkProcessingOptions> = {
  maxChunkSize: 8000,
  minChunkSize: 100,
  overlapSize: 200,
  retryAttempts: 3,
  retryDelayMs: 1000,
  concurrency: 5
}

/**
 * Validate and optionally clamp chunk content
 */
export function validateAndClampChunk(
  content: string,
  options: ChunkProcessingOptions = {}
): ChunkValidationResult {
  const opts = { ...DEFAULT_CHUNK_OPTIONS, ...options }
  const errors: string[] = []
  const warnings: string[] = []
  
  // Basic validation
  if (!content || typeof content !== 'string') {
    errors.push('Content must be a non-empty string')
    return { isValid: false, errors, warnings }
  }

  const trimmedContent = content.trim()
  if (trimmedContent.length === 0) {
    errors.push('Content cannot be empty after trimming')
    return { isValid: false, errors, warnings }
  }

  // Size validation
  if (trimmedContent.length < opts.minChunkSize) {
    warnings.push(`Content length (${trimmedContent.length}) is below minimum (${opts.minChunkSize})`)
  }

  let finalContent = trimmedContent
  if (trimmedContent.length > opts.maxChunkSize) {
    warnings.push(`Content truncated from ${trimmedContent.length} to ${opts.maxChunkSize} characters`)
    finalContent = trimmedContent.substring(0, opts.maxChunkSize)
    
    // Try to break at sentence boundary if possible
    const lastSentenceEnd = Math.max(
      finalContent.lastIndexOf('.'),
      finalContent.lastIndexOf('!'),
      finalContent.lastIndexOf('?')
    )
    
    if (lastSentenceEnd > opts.maxChunkSize * 0.8) {
      finalContent = finalContent.substring(0, lastSentenceEnd + 1)
      warnings.push('Content truncated at sentence boundary')
    }
  }

  return {
    isValid: true,
    errors,
    warnings,
    clampedContent: finalContent
  }
}

/**
 * Process a single chunk with validation and error handling
 */
export async function processSingleChunk(
  id: string,
  content: string,
  metadata: Record<string, unknown> = {},
  options: ChunkProcessingOptions = {}
): Promise<ProcessedChunk> {
  const startTime = Date.now()
  
  try {
    // Validate and clamp content
    const validation = validateAndClampChunk(content, options)
    
    if (!validation.isValid) {
      throw new Error(`Chunk validation failed: ${validation.errors.join(', ')}`)
    }

    const finalContent = validation.clampedContent || content
    
    // Generate embedding for the chunk
    const [embedding] = await generateEmbeddings([finalContent])

    const processedChunk: ProcessedChunk = {
      id,
      content: finalContent,
      metadata: {
        ...metadata,
        originalLength: content.length,
        processedLength: finalContent.length,
        processedAt: new Date().toISOString()
      },
      embedding,
      processingTime: Date.now() - startTime,
      warnings: validation.warnings.length > 0 ? validation.warnings : undefined
    }

    return processedChunk

  } catch (error) {
    throw new Error(`Failed to process chunk ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * THE UNIFIED CHUNK PROCESSOR
 * Process and save chunks with concurrency control, embeddings, and database persistence
 */
export async function processAndSaveChunks(
  paperId: string,
  contentChunks: string[],
  options: ChunkProcessingOptions = {}
): Promise<ChunkBatchResult> {
  // Convert content to chunk format with robust index tracking
  const chunks = contentChunks.map((content, index) => ({
    id: `chunk-${index}`,
    content,
    metadata: { 
      chunkIndex: index, 
      paperId,
      totalChunks: contentChunks.length,
      originalLength: content.length
    }
  }))
  
  return await processChunkBatchInternal(chunks, options)
}

/**
 * Internal batch processing with concurrency control
 */
async function processChunkBatchInternal(
  chunks: Array<{ id: string; content: string; metadata?: Record<string, unknown> }>,
  options: ChunkProcessingOptions = {}
): Promise<ChunkBatchResult> {
  const opts = { ...DEFAULT_CHUNK_OPTIONS, ...options }
  const concurrency = opts.concurrency
  const startTime = Date.now()
  const successful: ProcessedChunk[] = []
  const failed: Array<{ id: string; error: string; chunk: FailedChunk }> = []

  // Process chunks in batches to control concurrency
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency)
    
    const promises = batch.map(async (chunk) => {
      try {
        const processed = await processSingleChunk(
          chunk.id,
          chunk.content,
          chunk.metadata,
          options
        )
        return { success: true, data: processed }
      } catch (error) {
        return {
          success: false,
          data: {
            id: chunk.id,
            error: error instanceof Error ? error.message : 'Unknown error',
            chunk
          }
        }
      }
    })

    const results = await Promise.all(promises)
    
    for (const result of results) {
      if (result.success) {
        successful.push(result.data as ProcessedChunk)
      } else {
        failed.push(result.data as { id: string; error: string; chunk: FailedChunk })
      }
    }
  }

  const result = {
    successful,
    failed,
    stats: {
      total: chunks.length,
      successful: successful.length,
      failed: failed.length,
      processingTimeMs: Date.now() - startTime
    }
  }

  // Save successful chunks to database
  if (successful.length > 0) {
    const paperId = successful[0]?.metadata?.paperId as string
    if (paperId) {
      await saveChunksToDatabase(paperId, successful)
    }
  }

  // Save failed chunks for retry tracking
  if (failed.length > 0) {
    const paperId = failed[0]?.chunk?.metadata?.paperId as string
    if (paperId) {
      await saveFailedChunks(paperId, failed)
    }
  }

  return result
}

/**
 * Retry failed chunks with exponential backoff
 */
export async function retryFailedChunks(
  failedChunks: Array<{ id: string; error: string; chunk: FailedChunk }>,
  options: ChunkProcessingOptions = {}
): Promise<ChunkBatchResult> {
  const opts = { ...DEFAULT_CHUNK_OPTIONS, ...options }
  const successful: ProcessedChunk[] = []
  const stillFailed: Array<{ id: string; error: string; chunk: FailedChunk }> = []

  for (const failedChunk of failedChunks) {
    let attempt = 0
    let success = false

    while (attempt < opts.retryAttempts && !success) {
      try {
        // Exponential backoff delay
        if (attempt > 0) {
          const delay = opts.retryDelayMs * Math.pow(2, attempt - 1)
          await new Promise(resolve => setTimeout(resolve, delay))
        }

        const processed = await processSingleChunk(
          failedChunk.chunk.id,
          failedChunk.chunk.content,
          failedChunk.chunk.metadata,
          options
        )

        successful.push(processed)
        success = true

      } catch (error) {
        attempt++
        
        if (attempt >= opts.retryAttempts) {
          stillFailed.push({
            id: failedChunk.id,
            error: `Failed after ${opts.retryAttempts} attempts: ${error instanceof Error ? error.message : 'Unknown error'}`,
            chunk: failedChunk.chunk
          })
        }
      }
    }
  }

  return {
    successful,
    failed: stillFailed,
    stats: {
      total: failedChunks.length,
      successful: successful.length,
      failed: stillFailed.length,
      processingTimeMs: 0 // Not tracking time for retries
    }
  }
}

/**
 * Split large content into smaller chunks with optional overlap
 */
export function splitIntoChunks(
  content: string,
  options: ChunkProcessingOptions = {}
): Array<{ id: string; content: string; metadata: Record<string, unknown> }> {
  const opts = { ...DEFAULT_CHUNK_OPTIONS, ...options }
  const chunks: Array<{ id: string; content: string; metadata: Record<string, unknown> }> = []

  if (content.length <= opts.maxChunkSize) {
    return [{
      id: `chunk-0`,
      content,
      metadata: { 
        chunkIndex: 0, 
        totalChunks: 1, 
        originalLength: content.length,
        chunkLength: content.length,
        startPosition: 0,
        endPosition: content.length
      }
    }]
  }

  let currentPosition = 0
  let chunkIndex = 0

  while (currentPosition < content.length) {
    const chunkEnd = Math.min(currentPosition + opts.maxChunkSize, content.length)
    let chunkContent = content.substring(currentPosition, chunkEnd)

    // Try to break at sentence boundary for better readability
    if (chunkEnd < content.length) {
      const lastSentenceEnd = Math.max(
        chunkContent.lastIndexOf('. '),
        chunkContent.lastIndexOf('! '),
        chunkContent.lastIndexOf('? ')
      )

      if (lastSentenceEnd > chunkContent.length * 0.8) {
        chunkContent = chunkContent.substring(0, lastSentenceEnd + 1)
      }
    }

    const finalChunkContent = chunkContent.trim()
    
    chunks.push({
      id: `chunk-${chunkIndex}`,
      content: finalChunkContent,
      metadata: {
        chunkIndex, // Ensure this is always set correctly
        totalChunks: 0, // Will be updated after all chunks are created
        originalLength: content.length,
        chunkLength: finalChunkContent.length,
        startPosition: currentPosition,
        endPosition: currentPosition + finalChunkContent.length
      }
    })

    // Move to next position with overlap consideration
    currentPosition += finalChunkContent.length - opts.overlapSize
    chunkIndex++
  }

  // Update total chunks count for all chunks
  chunks.forEach(chunk => {
    chunk.metadata.totalChunks = chunks.length
  })

  return chunks
}

/**
 * Get processing statistics for debugging and monitoring
 */
export function getProcessingStats(
  results: ChunkBatchResult[]
): {
  totalChunks: number
  successfulChunks: number
  failedChunks: number
  avgProcessingTime: number
  successRate: number
} {
  const totalStats = results.reduce(
    (acc, result) => ({
      total: acc.total + result.stats.total,
      successful: acc.successful + result.stats.successful,
      failed: acc.failed + result.stats.failed,
      totalTime: acc.totalTime + result.stats.processingTimeMs
    }),
    { total: 0, successful: 0, failed: 0, totalTime: 0 }
  )

  return {
    totalChunks: totalStats.total,
    successfulChunks: totalStats.successful,
    failedChunks: totalStats.failed,
    avgProcessingTime: totalStats.total > 0 ? totalStats.totalTime / totalStats.total : 0,
    successRate: totalStats.total > 0 ? totalStats.successful / totalStats.total : 0
  }
}

/**
 * Save processed chunks to database
 */
export async function saveChunksToDatabase(
  paperId: string,
  processedChunks: ProcessedChunk[]
): Promise<void> {
  const supabase = await getSB()
  
  // Prepare chunk records for database with robust index handling and comprehensive metadata
  const chunkRecords = processedChunks.map((chunk, fallbackIndex) => {
    // Ensure we always have a valid chunk index with multiple fallback strategies
    let chunkIndex: number
    
    if (typeof chunk.metadata.chunkIndex === 'number' && !isNaN(chunk.metadata.chunkIndex)) {
      chunkIndex = chunk.metadata.chunkIndex
    } else if (typeof chunk.metadata.index === 'number' && !isNaN(chunk.metadata.index)) {
      chunkIndex = chunk.metadata.index
    } else {
      // Parse from chunk ID as last resort
      const idMatch = chunk.id.match(/chunk-(\d+)/)
      chunkIndex = idMatch ? parseInt(idMatch[1], 10) : fallbackIndex
    }
    
    // Comprehensive metadata for better chunk management
    const enhancedMetadata = {
      ...chunk.metadata,
      chunkIndex,
      processingMethod: 'unified-processor',
      processingVersion: '2.0',
      contentHash: chunk.content.substring(0, 100), // For deduplication
      wordCount: chunk.content.split(/\s+/).length,
      characterCount: chunk.content.length,
      processedAt: new Date().toISOString(),
      embeddingDimensions: chunk.embedding ? chunk.embedding.length : 0,
      qualityScore: calculateChunkQualityScore(chunk.content)
    }
      
    return {
      paper_id: paperId,
      chunk_index: chunkIndex,
      content: chunk.content,
      embedding: chunk.embedding,
      processing_status: 'completed' as const,
      error_count: 0,
      metadata: enhancedMetadata
    }
  })
  
  // Insert chunks with error handling
  const { error } = await supabase
    .from('paper_chunks')
    .upsert(chunkRecords.map(record => ({
      paper_id: record.paper_id,
      chunk_index: record.chunk_index,
      content: record.content,
      embedding: record.embedding
      // Note: metadata is not stored in database, kept for processing only
    })), {
      onConflict: 'paper_id,chunk_index',
      ignoreDuplicates: false
    })
  
  if (error) {
    throw new Error(`Failed to save chunks to database: ${error.message}`)
  }
  
  console.log(`✅ Saved ${chunkRecords.length} chunks to database for paper ${paperId}`)
}

/**
 * Calculate a quality score for a chunk based on content characteristics
 */
function calculateChunkQualityScore(content: string): number {
  let score = 0.5 // Base score
  
  // Length factors
  const length = content.length
  if (length > 200) score += 0.1
  if (length > 500) score += 0.1
  if (length > 1000) score += 0.1
  
  // Word count factors
  const wordCount = content.split(/\s+/).length
  if (wordCount > 50) score += 0.1
  if (wordCount > 100) score += 0.1
  
  // Content quality indicators
  const sentences = content.split(/[.!?]+/).length
  if (sentences > 3) score += 0.1
  
  // Penalize low-quality content
  if (/^[\d\s.,-]+$/.test(content)) score -= 0.3 // Just numbers and punctuation
  if (content.toLowerCase().includes('lorem ipsum')) score -= 0.5
  
  return Math.max(0, Math.min(1, score))
}

/**
 * Save failed chunks to database for retry tracking
 */
export async function saveFailedChunks(
  paperId: string,
  failedChunks: Array<{ id: string; error: string; chunk: FailedChunk }>
): Promise<void> {
  const supabase = await getSB()
  
  const failedRecords = failedChunks.map((failed, fallbackIndex) => {
    // Ensure we always have a valid chunk index
    const chunkIndex = typeof failed.chunk.metadata?.chunkIndex === 'number'
      ? failed.chunk.metadata.chunkIndex
      : fallbackIndex
      
    return {
      paper_id: paperId,
      chunk_index: chunkIndex,
      content: failed.chunk.content,
      error_message: failed.error,
      error_count: 1,
      last_attempt_at: new Date().toISOString()
    }
  })
  
  const { error } = await supabase
    .from('failed_chunks')
    .upsert(failedRecords, {
      onConflict: 'paper_id,chunk_index',
      ignoreDuplicates: false
    })
  
  if (error) {
    console.error('Failed to save failed chunks:', error)
  }
} 