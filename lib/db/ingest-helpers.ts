/**
 * Paper Ingestion Helpers
 * 
 * Region detection, validation, and statistics helpers
 * for the unified ingestPaper() function
 */

import { 
  detectPaperRegion, 
  enrichMetadataWithRegion,
  type RegionDetectionInputs
} from '@/lib/utils/region-detection'
import { generateEmbeddings } from '@/lib/utils/embedding'

export interface RegionDetectionOptions {
  enabled?: boolean
  overrideRegion?: string
  fallbackRegion?: string
  enableDebug?: boolean
}

export interface RegionDetectionResult {
  region: string | null
  confidence: string
  source: string | null
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  regionPreview?: RegionDetectionResult
  chunksPreview?: {
    count: number
    avgSize: number
    estimatedProcessingTime: number
  }
}

export interface IngestionStats {
  processingTimeMs: number
  chunksProcessed?: {
    total: number
    successful: number
    failed: number
  }
  regionDetected?: RegionDetectionResult
  warnings?: string[]
}

/**
 * Detect and enrich paper metadata with region information
 */
export async function processRegionDetection(
  paperData: { title: string; venue?: string; url?: string; metadata?: any },
  options: RegionDetectionOptions = {}
): Promise<{ enrichedMetadata: any; regionResult: RegionDetectionResult | null; warnings: string[] }> {
  const warnings: string[] = []
  let enrichedMetadata = { ...paperData.metadata }
  let regionResult = null

  if (options.enabled) {
    try {
      const regionInputs: RegionDetectionInputs = {
        venue: paperData.venue,
        url: paperData.url,
        affiliations: paperData.metadata?.affiliations as string[] | undefined,
        title: paperData.title
      }

      regionResult = detectPaperRegion(regionInputs, options)
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

  return { enrichedMetadata, regionResult, warnings }
}

/**
 * Validate paper data and generate preview information
 */
export async function validatePaperData(
  paperData: { title: string; authors: string[]; content?: string; venue?: string; url?: string; metadata?: any },
  options: { enableRegionDetection?: boolean; processChunks?: boolean } = {}
): Promise<ValidationResult> {
  const errors: string[] = []
  const warnings: string[] = []

  // Basic validation
  if (!paperData.title || !paperData.authors || paperData.authors.length === 0) {
    errors.push('Paper must have title and at least one author')
  }

  // Region detection preview
  let regionPreview: RegionDetectionResult | undefined
  if (options.enableRegionDetection) {
    try {
      const { regionResult, warnings: regionWarnings } = await processRegionDetection(paperData, { enabled: true })
      regionPreview = regionResult || undefined
      warnings.push(...regionWarnings)
    } catch (error) {
      warnings.push(`Region detection preview failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // Chunks preview
  let chunksPreview: { count: number; avgSize: number; estimatedProcessingTime: number } | undefined
  if (options.processChunks && paperData.content) {
    try {
      const { splitIntoChunks } = await import('@/lib/utils/text')
      const chunks = splitIntoChunks(paperData.content, 'validation-preview')
      
      chunksPreview = {
        count: chunks.length,
        avgSize: Math.round(paperData.content.length / chunks.length),
        estimatedProcessingTime: chunks.length * 100 // rough estimate: 100ms per chunk
      }
    } catch (error) {
      warnings.push(`Chunks preview failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    regionPreview,
    chunksPreview
  }
}

/**
 * Process chunks in memory (without saving to DB yet)
 */
export async function processChunksInMemory(
  content: string,
  options: { minChunkSize?: number } = {}
): Promise<{ processedChunks: Array<{content: string, embedding: number[], metadata: {chunkIndex: number}}>; warnings: string[] }> {
  const warnings: string[] = []
  const processedChunks: Array<{content: string, embedding: number[], metadata: {chunkIndex: number}}> = []

  try {
    const { splitIntoChunks } = await import('@/lib/utils/text')
    const rawChunks = splitIntoChunks(content, 'temp-paper-id')
    const contentChunks = rawChunks.map(chunk => chunk.content)
    
    for (let i = 0; i < contentChunks.length; i++) {
      const chunk = contentChunks[i]
      try {
        if (chunk.length < (options.minChunkSize || 100)) {
          warnings.push(`Chunk ${i} too short (${chunk.length} chars), skipping`)
          continue
        }
        
        // Generate embedding for this chunk
        const [embedding] = await generateEmbeddings([chunk])
        processedChunks.push({
          content: chunk,
          embedding,
          metadata: { chunkIndex: i }
        })
      } catch (error) {
        warnings.push(`Failed to process chunk ${i}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    console.log(`Processed ${processedChunks.length}/${contentChunks.length} chunks successfully`)
  } catch (error) {
    const errorMsg = `Chunk processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    warnings.push(errorMsg)
    console.warn(errorMsg)
  }

  return { processedChunks, warnings }
}

/**
 * Generate ingestion statistics
 */
export function generateIngestionStats(
  startTime: number,
  regionResult: RegionDetectionResult | null,
  processedChunks: Array<any>,
  warnings: string[]
): IngestionStats {
  return {
    processingTimeMs: Date.now() - startTime,
    regionDetected: regionResult || undefined,
    chunksProcessed: processedChunks.length > 0 ? {
      total: processedChunks.length,
      successful: processedChunks.length,
      failed: 0
    } : undefined,
    warnings: warnings.length > 0 ? warnings : undefined
  }
} 