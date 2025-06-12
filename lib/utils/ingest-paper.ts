/**
 * Paper Ingestion Module
 * 
 * Orchestrates the complete paper ingestion pipeline:
 * - Region detection
 * - Chunk processing 
 * - Database operations
 * - Error handling and retries
 */

import { 
  detectPaperRegion, 
  enrichMetadataWithRegion,
  type RegionDetectionInputs,
  type RegionDetectionResult
} from './global-region-detection'
import { 
  processChunkBatch, 
  retryFailedChunks,
  splitIntoChunks,
  type ChunkProcessingOptions,
  type ChunkBatchResult 
} from './chunk-processor'
import { 
  createPaper, 
  batchUpdatePaperRegions,
  type PaperData,
  type CreatePaperParams 
} from './paper-repository'

export interface PaperIngestionOptions {
  // Region detection options
  regionDetection?: {
    enabled?: boolean
    overrideRegion?: string
    fallbackRegion?: string
    enableDebug?: boolean
  }
  
  // Chunk processing options
  chunkProcessing?: ChunkProcessingOptions
  
  // Ingestion control
  skipChunks?: boolean
  skipRegionDetection?: boolean
  validateOnly?: boolean // For testing - don't actually insert
  
  // Retry configuration
  retryFailedChunks?: boolean
  maxRetryAttempts?: number
}

export interface IngestionResult {
  paperId: string
  success: boolean
  regionDetected?: {
    region: string | null
    confidence: string
    source: string | null
  }
  chunksProcessed?: {
    total: number
    successful: number
    failed: number
    processingTimeMs: number
  }
  errors?: string[]
  warnings?: string[]
}

export interface BatchIngestionResult {
  results: IngestionResult[]
  summary: {
    total: number
    successful: number
    failed: number
    regionsDetected: number
    chunksProcessed: number
    totalProcessingTimeMs: number
  }
  failedPapers: Array<{ 
    paper: Partial<PaperData>
    error: string 
  }>
}

const DEFAULT_INGESTION_OPTIONS: Required<PaperIngestionOptions> = {
  regionDetection: {
    enabled: true,
    overrideRegion: undefined,
    fallbackRegion: undefined,
    enableDebug: false
  },
  chunkProcessing: {
    maxChunkSize: 8000,
    minChunkSize: 100,
    overlapSize: 200,
    retryAttempts: 3,
    retryDelayMs: 1000
  },
  skipChunks: false,
  skipRegionDetection: false,
  validateOnly: false,
  retryFailedChunks: true,
  maxRetryAttempts: 3
}

/**
 * Ingest a single paper with full pipeline processing
 */
export async function ingestPaper(
  paperData: PaperData,
  options: PaperIngestionOptions = {}
): Promise<IngestionResult> {
  const opts = { ...DEFAULT_INGESTION_OPTIONS, ...options }
  const startTime = Date.now()
  const errors: string[] = []
  const warnings: string[] = []

  try {
    // Step 1: Validate input data
    if (!paperData.title || !paperData.authors || paperData.authors.length === 0) {
      throw new Error('Paper must have title and at least one author')
    }

    // Step 2: Region detection
    let enrichedMetadata = { ...paperData.metadata }
    let regionResult = null

    if (!opts.skipRegionDetection) {
      try {
        const regionInputs: RegionDetectionInputs = {
          venue: paperData.venue,
          url: paperData.url,
          affiliations: paperData.metadata?.affiliations as string[] | undefined,
          title: paperData.title
        }

        regionResult = detectPaperRegion(regionInputs, opts.regionDetection)
        enrichedMetadata = enrichMetadataWithRegion(enrichedMetadata, regionResult)

        if (regionResult.region) {
          console.log(`Detected region: ${regionResult.region} (${regionResult.confidence}) for paper: ${paperData.title}`)
        }
      } catch (error) {
        const errorMsg = `Region detection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        warnings.push(errorMsg)
        console.warn(errorMsg)
      }
    }

    // Step 3: Chunk processing
    let chunksResult: ChunkBatchResult | undefined

    if (!opts.skipChunks && paperData.content) {
      try {
        // Split content into chunks
        const rawChunks = splitIntoChunks(paperData.content, opts.chunkProcessing)
        
        // Process chunks
        chunksResult = await processChunkBatch(rawChunks, opts.chunkProcessing)

        // Retry failed chunks if configured
        if (opts.retryFailedChunks && chunksResult.failed.length > 0) {
          const retryResult = await retryFailedChunks(chunksResult.failed, opts.chunkProcessing)
          chunksResult.successful.push(...retryResult.successful)
          chunksResult.failed = retryResult.failed
          chunksResult.stats.successful += retryResult.stats.successful
          chunksResult.stats.failed = retryResult.stats.failed
        }

        if (chunksResult.failed.length > 0) {
          warnings.push(`${chunksResult.failed.length} chunks failed processing`)
        }
      } catch (error) {
        const errorMsg = `Chunk processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        warnings.push(errorMsg)
        console.warn(errorMsg)
      }
    }

    // Step 4: Database insertion (skip if validate only)
    let paperId = ''
    if (!opts.validateOnly) {
      const paperWithMetadata: PaperData = {
        ...paperData,
        metadata: enrichedMetadata
      }

      const createParams: CreatePaperParams = {
        data: paperWithMetadata,
        chunks: chunksResult?.successful.map(chunk => ({
          content: chunk.content,
          embedding: chunk.embedding,
          metadata: chunk.metadata
        })) || []
      }

      paperId = await createPaper(createParams)
    }

    // Step 5: Build result
    const result: IngestionResult = {
      paperId,
      success: true,
      regionDetected: regionResult ? {
        region: regionResult.region,
        confidence: regionResult.confidence,
        source: regionResult.source
      } : undefined,
      chunksProcessed: chunksResult ? {
        total: chunksResult.stats.total,
        successful: chunksResult.stats.successful,
        failed: chunksResult.stats.failed,
        processingTimeMs: chunksResult.stats.processingTimeMs
      } : undefined,
      warnings: warnings.length > 0 ? warnings : undefined
    }

    console.log(`Successfully ingested paper: ${paperData.title} (ID: ${paperId}) in ${Date.now() - startTime}ms`)
    return result

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    errors.push(errorMsg)
    
    console.error(`Failed to ingest paper: ${paperData.title}`, error)
    
    return {
      paperId: '',
      success: false,
      errors: errors,
      warnings: warnings.length > 0 ? warnings : undefined
    }
  }
}

/**
 * Ingest multiple papers in batch with concurrency control
 */
export async function batchIngestPapers(
  papers: PaperData[],
  options: PaperIngestionOptions = {},
  concurrency = 3
): Promise<BatchIngestionResult> {
  const startTime = Date.now()
  const results: IngestionResult[] = []
  const failedPapers: Array<{ paper: Partial<PaperData>; error: string }> = []

  console.log(`Starting batch ingestion of ${papers.length} papers with concurrency ${concurrency}`)

  // Process papers in batches to control concurrency
  for (let i = 0; i < papers.length; i += concurrency) {
    const batch = papers.slice(i, i + concurrency)
    
    const promises = batch.map(async (paper) => {
      try {
        const result = await ingestPaper(paper, options)
        return result
      } catch (error) {
        // This should not happen as ingestPaper handles its own errors
        return {
          paperId: '',
          success: false,
          errors: [error instanceof Error ? error.message : 'Unknown error']
        } as IngestionResult
      }
    })

    const batchResults = await Promise.all(promises)
    results.push(...batchResults)

    // Track failed papers
    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j]
      if (!result.success) {
        failedPapers.push({
          paper: { 
            title: batch[j].title, 
            authors: batch[j].authors,
            venue: batch[j].venue 
          },
          error: result.errors?.join(', ') || 'Unknown error'
        })
      }
    }

    // Log progress
    const processed = Math.min(i + concurrency, papers.length)
    console.log(`Batch progress: ${processed}/${papers.length} papers processed`)
  }

  // Calculate summary statistics
  const successful = results.filter(r => r.success).length
  const regionsDetected = results.filter(r => r.regionDetected?.region).length
  const totalChunks = results.reduce((sum, r) => sum + (r.chunksProcessed?.total || 0), 0)
  const totalProcessingTime = Date.now() - startTime

  const summary: BatchIngestionResult = {
    results,
    summary: {
      total: papers.length,
      successful,
      failed: papers.length - successful,
      regionsDetected,
      chunksProcessed: totalChunks,
      totalProcessingTimeMs: totalProcessingTime
    },
    failedPapers
  }

  console.log(`Batch ingestion completed: ${successful}/${papers.length} successful, ${regionsDetected} regions detected, ${totalChunks} chunks processed in ${totalProcessingTime}ms`)

  return summary
}

/**
 * Update regions for existing papers in batch
 */
export async function batchUpdateRegions(
  paperIds: string[],
  options: Pick<PaperIngestionOptions, 'regionDetection'> = {}
): Promise<{
  successful: number
  failed: Array<{ paperId: string; error: string }>
  summary: {
    total: number
    regionsDetected: number
    processingTimeMs: number
  }
}> {
  const startTime = Date.now()
  const updates: Array<{ paperId: string; regionResult: RegionDetectionResult }> = []
  const processingErrors: Array<{ paperId: string; error: string }> = []

  console.log(`Starting batch region update for ${paperIds.length} papers with options:`, options)

  // First, fetch paper data and detect regions
  for (const paperId of paperIds) {
    try {
      // Note: In a real implementation, you'd fetch the paper data from the database
      // For now, this is a simplified version that would need paper data
      console.warn(`Batch region update requires paper data fetching - not implemented in this simplified version`)
      // const paper = await getPaperById(paperId)
      // if (paper) {
      //   const regionInputs = { ... }
      //   const regionResult = detectPaperRegion(regionInputs, options.regionDetection)
      //   updates.push({ paperId, regionResult })
      // }
    } catch (error) {
      processingErrors.push({
        paperId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  // Batch update the regions
  let updateResult = { successful: 0, failed: [] as Array<{ paperId: string; error: string }> }
  if (updates.length > 0) {
    updateResult = await batchUpdatePaperRegions(updates)
  }

  // Combine processing errors with update errors
  const allFailed = [
    ...processingErrors,
    ...updateResult.failed
  ]

  const totalDetected = updates.length - processingErrors.length

  console.log(`Batch region update completed: ${updateResult.successful} successful, ${allFailed.length} failed, ${totalDetected} regions detected`)

  return {
    successful: updateResult.successful,
    failed: allFailed,
    summary: {
      total: paperIds.length,
      regionsDetected: totalDetected,
      processingTimeMs: Date.now() - startTime
    }
  }
}

/**
 * Validate paper data without ingesting
 */
export async function validatePaper(
  paperData: PaperData,
  options: PaperIngestionOptions = {}
): Promise<{
  valid: boolean
  errors: string[]
  warnings: string[]
  regionPreview?: {
    region: string | null
    confidence: string
    source: string | null
  }
  chunksPreview?: {
    count: number
    avgSize: number
    estimatedProcessingTime: number
  }
}> {
  const validationOptions = {
    ...options,
    validateOnly: true,
    skipChunks: false // Still process chunks for preview
  }

  const result = await ingestPaper(paperData, validationOptions)
  
  return {
    valid: result.success,
    errors: result.errors || [],
    warnings: result.warnings || [],
    regionPreview: result.regionDetected,
    chunksPreview: result.chunksProcessed ? {
      count: result.chunksProcessed.total,
      avgSize: Math.round((paperData.content?.length || 0) / result.chunksProcessed.total),
      estimatedProcessingTime: result.chunksProcessed.processingTimeMs
    } : undefined
  }
}

/**
 * Get ingestion statistics for monitoring
 */
export function getIngestionStats(results: IngestionResult[]): {
  successRate: number
  avgProcessingTime: number
  regionDetectionRate: number
  avgChunksPerPaper: number
  commonErrors: Array<{ error: string; count: number }>
} {
  const successful = results.filter(r => r.success)
  const withRegions = results.filter(r => r.regionDetected?.region)
  const totalChunks = results.reduce((sum, r) => sum + (r.chunksProcessed?.total || 0), 0)
  
  // Count error occurrences
  const errorCounts: Record<string, number> = {}
  results.forEach(r => {
    r.errors?.forEach(error => {
      errorCounts[error] = (errorCounts[error] || 0) + 1
    })
  })

  const commonErrors = Object.entries(errorCounts)
    .map(([error, count]) => ({ error, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return {
    successRate: results.length > 0 ? successful.length / results.length : 0,
    avgProcessingTime: 0, // Would need to track this in results
    regionDetectionRate: results.length > 0 ? withRegions.length / results.length : 0,
    avgChunksPerPaper: results.length > 0 ? totalChunks / results.length : 0,
    commonErrors
  }
} 