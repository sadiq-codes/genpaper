/**
 * Centralized Content Ingestion Module
 * 
 * All content ingestion, chunking, and paper management functions are consolidated here
 * to avoid duplication across the codebase.
 */

import { getServiceClient } from '@/lib/supabase/service'
import { chunkByTokens, normalizeText, type TokenChunkOptions } from '@/lib/utils/text'
import { collisionResistantHash } from '@/lib/utils/hash'
import { ContentRetrievalError, IngestionError, ChunkingError } from './errors'
import {
  normalizePaperProcessingStatus,
  isChunkReadyStatus,
  isFullTextReadyStatus,
  type PaperProcessingStatus,
} from './processing-status'
import { getPDFContent, hasPDFContent } from '@/lib/pdf/pdf-utils'
import { isQdrantConfigured, upsertChunks as upsertQdrantChunks, deleteChunksByPaperId as deleteQdrantChunks } from '@/lib/qdrant/client'
import type { PaperWithAuthors } from '@/types/simplified'

export interface ContentStatus {
  paperId: string
  hasContent: boolean
  contentType: 'pdf' | 'abstract' | 'none'
  contentLength: number
  chunkCount: number
}

export interface IngestionOptions {
  skipChunks?: boolean
  maxTokens?: number
  overlapTokens?: number
  tokenChunkOptions?: TokenChunkOptions
}

export interface IngestionResult {
  paperId: string
  success: boolean
  chunksCreated: number
  contentLength: number
  error?: string
}

export interface BulkIngestionSummary {
  successful: number
  failed: number
  totalChunks: number
  results: IngestionResult[]
}

function sanitizeUnicode(text: string): string {
  return text
    .replace(/[\uD800-\uDFFF]/g, '')
    .replace(/\\u(?![0-9a-fA-F]{4})\w*/g, '')
    .replace(/\u0000/g, '')
}

function isStatementTimeoutMessage(message: string): boolean {
  return message.toLowerCase().includes('statement timeout')
}

function isDuplicateKeyMessage(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('duplicate') ||
    normalized.includes('violates unique constraint') ||
    normalized.includes('23505')
  )
}

async function waitMs(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function updateQdrantSyncStatus(
  serviceClient: ReturnType<typeof getServiceClient>,
  paperId: string,
  status: 'synced' | 'pending',
  lastError?: string
): Promise<void> {
  try {
    const { data, error } = await serviceClient
      .from('papers')
      .select('metadata')
      .eq('id', paperId)
      .maybeSingle()

    if (error) {
      console.warn(`Failed to load metadata for qdrant sync status (${paperId}):`, error.message)
      return
    }

    const metadata = data?.metadata && typeof data.metadata === 'object'
      ? (data.metadata as Record<string, unknown>)
      : {}
    const previous = metadata.qdrant_sync && typeof metadata.qdrant_sync === 'object'
      ? (metadata.qdrant_sync as Record<string, unknown>)
      : {}
    const now = new Date().toISOString()

    const qdrantSync: Record<string, unknown> = {
      ...previous,
      status,
      updated_at: now
    }

    if (status === 'pending') {
      qdrantSync.pending_since = typeof previous.pending_since === 'string' ? previous.pending_since : now
      qdrantSync.last_error = lastError || 'unknown'
    } else {
      qdrantSync.synced_at = now
      delete qdrantSync.pending_since
      delete qdrantSync.last_error
    }

    const { error: updateError } = await serviceClient
      .from('papers')
      .update({ metadata: { ...metadata, qdrant_sync: qdrantSync } })
      .eq('id', paperId)

    if (updateError) {
      console.warn(`Failed to persist qdrant sync status (${paperId}):`, updateError.message)
    }
  } catch (err) {
    console.warn(`Unexpected qdrant sync metadata error (${paperId}):`, err)
  }
}

export async function getPaperProcessingStatusMap(
  paperIds: string[]
): Promise<Map<string, PaperProcessingStatus>> {
  if (paperIds.length === 0) {
    return new Map()
  }

  try {
    const supabase = getServiceClient()
    const { data, error } = await supabase
      .from('papers')
      .select('id, processing_status')
      .in('id', paperIds)

    if (error) {
      throw new ContentRetrievalError(`Failed to fetch paper processing_status: ${error.message}`)
    }

    const statusMap = new Map<string, PaperProcessingStatus>()
    for (const row of data || []) {
      statusMap.set(
        row.id,
        normalizePaperProcessingStatus((row as { processing_status?: string | null }).processing_status)
      )
    }

    for (const paperId of paperIds) {
      if (!statusMap.has(paperId)) {
        statusMap.set(paperId, 'pending')
      }
    }

    return statusMap
  } catch (error) {
    console.error('Error getting processing status map:', error)
    throw new ContentRetrievalError(`Processing status lookup failed: ${error}`)
  }
}

/**
 * Get content availability status for multiple papers
 */
export async function getContentStatus(paperIds: string[]): Promise<Map<string, ContentStatus>> {
  if (paperIds.length === 0) {
    return new Map()
  }

  try {
    const processingStatusMap = await getPaperProcessingStatusMap(paperIds)

    const statusMap = new Map<string, ContentStatus>()
    for (const paperId of paperIds) {
      const processingStatus = processingStatusMap.get(paperId) || 'pending'
      statusMap.set(paperId, {
        paperId,
        hasContent: isChunkReadyStatus(processingStatus),
        contentType: isFullTextReadyStatus(processingStatus)
          ? 'pdf'
          : processingStatus === 'abstract_ready'
            ? 'abstract'
            : 'none',
        // Exact content length is intentionally not derived here.
        contentLength: 0,
        chunkCount: isChunkReadyStatus(processingStatus) ? 1 : 0,
      })
    }

    return statusMap
  } catch (error) {
    console.error('Error getting content status:', error)
    throw new ContentRetrievalError(`Content status check failed: ${error}`)
  }
}

/**
 * Ensure papers exist in database (handle foreign key constraints)
 */
export async function ensurePapersExist(papers: PaperWithAuthors[]): Promise<string[]> {
  if (papers.length === 0) {
    return []
  }

  try {
    // Use service client to bypass RLS - this is called from background generation jobs
    const supabase = getServiceClient()
    const existingIds: string[] = []

    // Check which papers already exist
    const { data: existing } = await supabase
      .from('papers')
      .select('id')
      .in('id', papers.map(p => p.id))

    const existingSet = new Set(existing?.map(p => p.id) || [])

    // Insert missing papers
    const missingPapers = papers.filter(p => !existingSet.has(p.id))
    
    if (missingPapers.length > 0) {
      const { data: inserted, error } = await supabase
        .from('papers')
        .insert(missingPapers.map(paper => ({
          id: paper.id,
          title: paper.title,
          abstract: paper.abstract || '',
          publication_date: paper.publication_date,
          venue: paper.venue || '',
          doi: paper.doi || '',
          created_at: new Date().toISOString()
        })))
        .select('id')

      if (error) {
        console.warn('Some papers failed to insert:', error.message)
      } else {
        existingIds.push(...(inserted?.map(p => p.id) || []))
      }
    }

    // Add existing papers
    existingIds.push(...Array.from(existingSet))

    return existingIds
  } catch (error) {
    console.error('Error ensuring papers exist:', error)
    throw new IngestionError(`Failed to ensure papers exist: ${error}`)
  }
}

/**
 * Create chunks for a single paper
 */
export async function createChunksForPaper(
  paperId: string,
  content: string,
  options: { 
    maxTokens?: number; 
    overlapTokens?: number;
    tokenChunkOptions?: TokenChunkOptions;
  } = {}
): Promise<number> {
  const trimmed = (content || '').trim()
  if (!trimmed) {
    return 0
  }

  try {
    // Use service client to bypass RLS - this is called from background generation jobs
    // paper_chunks requires authenticated users for SELECT and service_role for writes
    const serviceClient = getServiceClient()

    // Fetch existing chunks to detect content changes via hash
    const { data: existingChunks, error: checkError } = await serviceClient
      .from('paper_chunks')
      .select('content, chunk_index')
      .eq('paper_id', paperId)
      .order('chunk_index', { ascending: true })

    if (checkError) {
      console.warn(`Error fetching existing chunks for paper ${paperId}:`, checkError.message)
      // Continue; we'll attempt to (re)create chunks
    }

    const normalizedContent = sanitizeUnicode(normalizeText(trimmed))
    const newHash = collisionResistantHash(normalizedContent)

    const existingConcatenated = (existingChunks || []).map(c => c.content).join('\n\n')
    const existingHash = existingConcatenated ? collisionResistantHash(existingConcatenated) : null

    if (existingHash && existingHash === newHash) {
      // No content change; keep existing chunks
      console.log(`⏭️ No content change for paper ${paperId} - keeping existing ${(existingChunks || []).length} chunks`)
      return (existingChunks || []).length
    }

    // Content changed; delete previous chunks before writing new ones
    if (existingChunks && existingChunks.length > 0) {
      const { error: deleteError } = await serviceClient
        .from('paper_chunks')
        .delete()
        .eq('paper_id', paperId)
      if (deleteError) {
        console.warn(`Failed to delete existing chunks for paper ${paperId}:`, deleteError.message)
      }
      
      // Also delete from Qdrant if configured
      if (isQdrantConfigured()) {
        try {
          await deleteQdrantChunks(paperId)
        } catch (qdrantErr) {
          console.warn(`Failed to delete Qdrant chunks for paper ${paperId}:`, qdrantErr)
        }
      }
    }

    // Handle short content: ensure at least one chunk for short abstracts
    if (normalizedContent.length < 100) {
      const { createDeterministicChunkId } = await import('@/lib/utils/deterministic-id')
      const { generateEmbeddings } = await import('@/lib/utils/embedding')

      const [embedding] = await generateEmbeddings([normalizedContent])
      const chunkId = createDeterministicChunkId(paperId, normalizedContent, 0)

      // Insert to Supabase WITHOUT embedding (Qdrant only for embeddings)
      const { error } = await serviceClient
        .from('paper_chunks')
        .upsert({
          id: chunkId,
          paper_id: paperId,
          chunk_index: 0,
          content: normalizedContent,
        }, {
          onConflict: 'id',
          ignoreDuplicates: false
        })

      if (error) {
        // Log error but don't throw - chunk might already exist from parallel processing
        console.warn(`Chunk insertion warning for paper ${paperId}:`, error.message)
        
        // Verify chunk exists - if not, this is a real error
        const { data: verifyChunk } = await serviceClient
          .from('paper_chunks')
          .select('id')
          .eq('paper_id', paperId)
          .limit(1)
        
        if (!verifyChunk || verifyChunk.length === 0) {
          throw new ChunkingError(`Failed to insert short-content chunk: ${error.message}`)
        }
      }
      
      // Insert embedding into Qdrant ONLY
      if (isQdrantConfigured()) {
        try {
          await upsertQdrantChunks([{
            id: chunkId,
            paper_id: paperId,
            chunk_index: 0,
            content: normalizedContent,
            embedding
          }])
          await updateQdrantSyncStatus(serviceClient, paperId, 'synced')
        } catch (qdrantErr) {
          console.warn(`Failed to insert Qdrant chunk for paper ${paperId}:`, qdrantErr)
          const message = qdrantErr instanceof Error ? qdrantErr.message : String(qdrantErr)
          await updateQdrantSyncStatus(serviceClient, paperId, 'pending', message)
        }
      } else {
        console.warn(`⚠️ Qdrant not configured - embedding for paper ${paperId} not stored!`)
        await updateQdrantSyncStatus(serviceClient, paperId, 'pending', 'qdrant_not_configured')
      }

      console.log(`✅ Created 1 short-content chunk for paper ${paperId}`)
      return 1
    }
    
    // Create chunks using token-based chunking only
    const maxTokens = options.maxTokens ?? 500
    const overlapTokens = options.overlapTokens ?? 80

    const chunks = await chunkByTokens(normalizedContent, paperId, {
      maxTokens,
      overlapTokens,
      preserveParagraphs: true,
      minChunkTokens: 50,
      ...(options.tokenChunkOptions || {})
    })

    if (chunks.length === 0) {
      return 0
    }

    // Generate embeddings for all chunks
    const { generateEmbeddings } = await import('@/lib/utils/embedding')
    
    const chunkTexts = chunks.map(chunk => chunk.content)
    const embeddings = await generateEmbeddings(chunkTexts)
    
    // Note: Chunk metadata extraction removed - was computing section_type, has_citations, 
    // has_data, has_figures, is_conclusion, complexity_score, key_terms but these were
    // never used for filtering or retrieval. Semantic search uses embeddings only.

    // Prepare chunk data with embeddings (for Qdrant)
    const chunkDataWithEmbeddings = chunks.map((chunk, index) => ({
      id: chunk.id,
      paper_id: paperId,
      chunk_index: index,
      content: chunk.content,
      embedding: embeddings[index]
    }))
    
    // Insert to Supabase WITHOUT embeddings (Qdrant only for embeddings)
    const chunkDataWithoutEmbeddings = chunkDataWithEmbeddings.map(({ embedding: _embedding, ...rest }) => rest)
    
    // Insert chunks in smaller batches to reduce statement-timeout risk.
    const DB_BATCH_SIZE = 20
    const DB_TIMEOUT_MAX_RETRIES = 3
    const DB_TIMEOUT_BACKOFF_MS = 250
    let error: { message: string } | null = null
    const dedupedById = new Map<string, (typeof chunkDataWithoutEmbeddings)[number]>()
    for (const chunk of chunkDataWithoutEmbeddings) {
      // Deterministic IDs make this dedupe safe and idempotent.
      dedupedById.set(chunk.id, chunk)
    }
    const dedupedChunks = Array.from(dedupedById.values())

    if (dedupedChunks.length !== chunkDataWithoutEmbeddings.length) {
      console.warn(
        `⚠️ Deduped ${chunkDataWithoutEmbeddings.length - dedupedChunks.length} duplicate chunks before DB upsert for paper ${paperId}`
      )
    }

    const upsertBatchWithRetries = async (
      batch: typeof dedupedChunks
    ): Promise<string | null> => {
      let batchErrorMessage: string | null = null

      for (let attempt = 1; attempt <= DB_TIMEOUT_MAX_RETRIES; attempt++) {
        const { error: batchError } = await serviceClient
          .from('paper_chunks')
          .upsert(batch, {
            // `paper_chunks` primary key is `id` (deterministic UUID). Conflict on id
            // makes retries/idempotency safe without duplicate-key crashes.
            onConflict: 'id',
            ignoreDuplicates: false
          })

        if (!batchError) {
          return null
        }

        batchErrorMessage = batchError.message
        if (isStatementTimeoutMessage(batchErrorMessage) && attempt < DB_TIMEOUT_MAX_RETRIES) {
          const backoffMs = DB_TIMEOUT_BACKOFF_MS * attempt
          console.warn(
            `⚠️ Batch upsert timeout for paper ${paperId} (attempt ${attempt}/${DB_TIMEOUT_MAX_RETRIES}), retrying in ${backoffMs}ms`
          )
          await waitMs(backoffMs)
          continue
        }
        break
      }

      return batchErrorMessage
    }

    const insertSingleRowWithRetries = async (
      row: (typeof dedupedChunks)[number]
    ): Promise<string | null> => {
      let singleErrorMessage: string | null = null

      for (let attempt = 1; attempt <= DB_TIMEOUT_MAX_RETRIES; attempt++) {
        const { error: singleError } = await serviceClient
          .from('paper_chunks')
          .insert(row)

        if (!singleError) {
          return null
        }

        singleErrorMessage = singleError.message
        if (isDuplicateKeyMessage(singleErrorMessage)) {
          return null
        }
        if (isStatementTimeoutMessage(singleErrorMessage) && attempt < DB_TIMEOUT_MAX_RETRIES) {
          const backoffMs = DB_TIMEOUT_BACKOFF_MS * attempt
          await waitMs(backoffMs)
          continue
        }
        break
      }

      const { data: existingRow } = await serviceClient
        .from('paper_chunks')
        .select('id')
        .eq('id', row.id)
        .limit(1)

      if (existingRow && existingRow.length > 0) {
        return null
      }

      return singleErrorMessage
    }

    const insertBatchWithAdaptiveFallback = async (
      batch: typeof dedupedChunks
    ): Promise<string | null> => {
      const pending = [batch]

      while (pending.length > 0) {
        const currentBatch = pending.shift()
        if (!currentBatch || currentBatch.length === 0) {
          continue
        }

        const batchErrorMessage = await upsertBatchWithRetries(currentBatch)
        if (!batchErrorMessage) {
          continue
        }

        const canSplitFurther =
          currentBatch.length > 1 &&
          (
            batchErrorMessage.includes('ON CONFLICT DO UPDATE command cannot affect row a second time') ||
            isStatementTimeoutMessage(batchErrorMessage)
          )

        if (canSplitFurther) {
          const midpoint = Math.ceil(currentBatch.length / 2)
          console.warn(
            `⚠️ Batch upsert failed for paper ${paperId} at size ${currentBatch.length}, splitting into ${midpoint} and ${currentBatch.length - midpoint}: ${batchErrorMessage}`
          )
          pending.unshift(currentBatch.slice(midpoint))
          pending.unshift(currentBatch.slice(0, midpoint))
          continue
        }

        if (currentBatch.length === 1 && isStatementTimeoutMessage(batchErrorMessage)) {
          const singleErrorMessage = await insertSingleRowWithRetries(currentBatch[0])
          if (!singleErrorMessage) {
            continue
          }
          return singleErrorMessage
        }

        return batchErrorMessage
      }

      return null
    }

    for (let i = 0; i < dedupedChunks.length; i += DB_BATCH_SIZE) {
      const batch = dedupedChunks.slice(i, i + DB_BATCH_SIZE)
      const batchErrorMessage = await insertBatchWithAdaptiveFallback(batch)
      if (batchErrorMessage) {
        error = { message: batchErrorMessage }
        break
      }
    }

    if (error) {
      // Log warning but don't throw - chunks might already exist from parallel processing
      console.warn(`Chunk insertion warning for paper ${paperId}:`, error.message)
      
      // Verify at least some chunks exist - if not, this is a real error
      const { data: verifyChunks } = await serviceClient
        .from('paper_chunks')
        .select('id')
        .eq('paper_id', paperId)
        .limit(3)
      
      if (!verifyChunks || verifyChunks.length === 0) {
        throw new ChunkingError(`Failed to insert chunks: ${error.message}`)
      }
      
      console.log(`⚠️ Some chunks may have been duplicates, but ${verifyChunks.length} chunks exist for paper`)
    }
    
    // Insert embeddings into Qdrant ONLY
    if (isQdrantConfigured()) {
      try {
        await upsertQdrantChunks(chunkDataWithEmbeddings)
        console.log(`✅ Inserted ${chunkDataWithEmbeddings.length} chunks into Qdrant for paper ${paperId}`)
        await updateQdrantSyncStatus(serviceClient, paperId, 'synced')
      } catch (qdrantErr) {
        console.warn(`Failed to insert Qdrant chunks for paper ${paperId}:`, qdrantErr)
        const message = qdrantErr instanceof Error ? qdrantErr.message : String(qdrantErr)
        await updateQdrantSyncStatus(serviceClient, paperId, 'pending', message)
      }
    } else {
      console.warn(`⚠️ Qdrant not configured - embeddings for paper ${paperId} not stored!`)
      await updateQdrantSyncStatus(serviceClient, paperId, 'pending', 'qdrant_not_configured')
    }

    // Verify actual chunk count in database
    const { count: actualCount } = await serviceClient
      .from('paper_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('paper_id', paperId)
    
    const finalCount = actualCount || chunks.length
    console.log(`✅ Created ${chunks.length} chunks for paper ${paperId} (${finalCount} total in DB)`)
    return finalCount
  } catch (error) {
    console.error(`Error creating chunks for paper ${paperId}:`, error)
    throw new ChunkingError(`Failed to create chunks for paper ${paperId}: ${error}`)
  }
}

/**
 * Process a single paper for content ingestion
 * Extracted to enable parallel processing
 */
async function processSinglePaper(
  paper: PaperWithAuthors,
  options: {
    skipChunks: boolean
    maxTokens: number
    overlapTokens: number
    tokenChunkOptions: TokenChunkOptions
  }
): Promise<IngestionResult> {
  const { skipChunks, maxTokens, overlapTokens, tokenChunkOptions } = options
  
  try {
    let content = ''
    let contentLength = 0
    let chunksCreated = 0

    // Try to get PDF content first
    const hasPdf = await hasPDFContent(paper.id)
    if (hasPdf) {
      const pdfContent = await getPDFContent(paper.id)
      if (pdfContent && pdfContent.length > 500) {
        content = pdfContent
        contentLength = content.length
        console.log(`📄 Using PDF content for "${paper.title.slice(0, 50)}..." (${contentLength} chars)`)
      }
    }

    // Fallback to abstract if no PDF content
    if (!content && paper.abstract && paper.abstract.length > 100) {
      content = paper.abstract
      contentLength = content.length
      console.log(`📝 Using abstract for "${paper.title.slice(0, 50)}..." (${contentLength} chars)`)
    }

    // Create chunks if we have content and not skipping
    if (content && !skipChunks) {
      chunksCreated = await createChunksForPaper(paper.id, content, {
        maxTokens,
        overlapTokens,
        tokenChunkOptions
      })
    }

    return {
      paperId: paper.id,
      success: true,
      chunksCreated,
      contentLength
    }

  } catch (error) {
    console.error(`❌ Failed to process paper "${paper.title.slice(0, 50)}...":`, error)
    return {
      paperId: paper.id,
      success: false,
      chunksCreated: 0,
      contentLength: 0,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Bulk content ingestion with PDF processing
 * 
 * Processes papers in parallel batches for better performance.
 * Default concurrency: 5 papers at a time (safe for OpenAI rate limits)
 */
export async function ensureBulkContentIngestion(
  papers: PaperWithAuthors[],
  options: IngestionOptions = {}
): Promise<BulkIngestionSummary> {
  const {
    skipChunks = false,
    maxTokens = 500,
    overlapTokens = 80,
    tokenChunkOptions = {}
  } = options

  // Concurrency limit - process N papers at a time
  const CONCURRENCY = 5

  console.log(`📥 Starting bulk content ingestion for ${papers.length} papers (concurrency: ${CONCURRENCY})...`)
  const startTime = Date.now()
  
  const results: IngestionResult[] = []

  try {
    // Ensure all papers exist in database (do this first, once)
    await ensurePapersExist(papers)

    // Process options for single paper processing
    const processOptions = {
      skipChunks,
      maxTokens,
      overlapTokens,
      tokenChunkOptions
    }

    // Process papers in parallel batches
    const totalBatches = Math.ceil(papers.length / CONCURRENCY)
    
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batchStart = batchIndex * CONCURRENCY
      const batchEnd = Math.min(batchStart + CONCURRENCY, papers.length)
      const batch = papers.slice(batchStart, batchEnd)
      
      console.log(`[Ingestion] Processing batch ${batchIndex + 1}/${totalBatches} (papers ${batchStart + 1}-${batchEnd})`)
      const batchStartTime = Date.now()
      
      // Process batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map(paper => processSinglePaper(paper, processOptions))
      )
      
      // Collect results
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value)
        } else {
          // Promise rejection - shouldn't happen since processSinglePaper catches errors
          results.push({
            paperId: 'unknown',
            success: false,
            chunksCreated: 0,
            contentLength: 0,
            error: result.reason?.message || 'Unknown error'
          })
        }
      }
      
      const batchDuration = Date.now() - batchStartTime
      const batchSuccessful = batchResults.filter(r => r.status === 'fulfilled' && r.value.success).length
      console.log(`[Ingestion] Batch ${batchIndex + 1} complete: ${batchSuccessful}/${batch.length} successful in ${batchDuration}ms`)
    }

    const successful = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length
    const totalChunks = results.reduce((sum, r) => sum + r.chunksCreated, 0)
    const totalDuration = Date.now() - startTime

    console.log(`✅ Bulk ingestion complete: ${successful}/${papers.length} successful, ${totalChunks} total chunks in ${totalDuration}ms`)

    return {
      successful,
      failed,
      totalChunks,
      results
    }

  } catch (error) {
    console.error('❌ Bulk content ingestion failed:', error)
    throw new IngestionError(`Bulk content ingestion failed: ${error}`)
  }
}

/**
 * Check content availability for papers and provide recommendations
 */
export async function checkContentAvailability(paperIds: string[]): Promise<{
  available: string[]
  missing: string[]
  recommendations: string[]
}> {
  const contentStatus = await getContentStatus(paperIds)
  const available: string[] = []
  const missing: string[] = []
  const recommendations: string[] = []

  for (const [paperId, status] of contentStatus) {
    if (status.hasContent && status.chunkCount > 0) {
      available.push(paperId)
    } else {
      missing.push(paperId)
      
      if (status.contentType === 'none') {
        recommendations.push(`Paper ${paperId}: No content available - consider adding to library with PDF`)
      } else if (status.chunkCount === 0) {
        recommendations.push(`Paper ${paperId}: Content available but not chunked - run ingestion`)
      }
    }
  }

  return { available, missing, recommendations }
} 
