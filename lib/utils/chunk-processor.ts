/**
 * Chunk Processor Module
 * 
 * Handles document chunk validation, clamping, batch processing,
 * and retry logic for paper ingestion pipeline.
 */

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
  retryDelayMs: 1000
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

    const processedChunk: ProcessedChunk = {
      id,
      content: validation.clampedContent || content,
      metadata: {
        ...metadata,
        originalLength: content.length,
        processedLength: (validation.clampedContent || content).length,
        processedAt: new Date().toISOString()
      },
      processingTime: Date.now() - startTime,
      warnings: validation.warnings.length > 0 ? validation.warnings : undefined
    }

    return processedChunk

  } catch (error) {
    throw new Error(`Failed to process chunk ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Process multiple chunks in batch with concurrency control
 */
export async function processChunkBatch(
  chunks: Array<{ id: string; content: string; metadata?: Record<string, unknown> }>,
  options: ChunkProcessingOptions = {},
  concurrency = 5
): Promise<ChunkBatchResult> {
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

  return {
    successful,
    failed,
    stats: {
      total: chunks.length,
      successful: successful.length,
      failed: failed.length,
      processingTimeMs: Date.now() - startTime
    }
  }
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
      metadata: { chunkIndex: 0, totalChunks: 1, originalLength: content.length }
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

    chunks.push({
      id: `chunk-${chunkIndex}`,
      content: chunkContent.trim(),
      metadata: {
        chunkIndex,
        totalChunks: 0, // Will be updated after all chunks are created
        originalLength: content.length,
        chunkLength: chunkContent.length,
        startPosition: currentPosition,
        endPosition: currentPosition + chunkContent.length
      }
    })

    // Move to next position with overlap consideration
    currentPosition += chunkContent.length - opts.overlapSize
    chunkIndex++
  }

  // Update total chunks count
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