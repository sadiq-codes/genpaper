/**
 * Background PDF Processing System
 * 
 * Handles lazy/on-demand processing of PDFs:
 * - Downloads PDF from storage
 * - Extracts text content
 * - Creates chunks with embeddings
 * - Extracts structured findings (for synthesis engine)
 * - Updates processing status
 */

import { createServiceClient } from '@/lib/supabase/service'
import { createChunksForPaper } from './ingestion'
import { extractPdfMetadataTiered } from '@/lib/pdf/tiered-extractor'
import { extractPaper } from '@/lib/extraction'
import { saveExtractionService, hasExtractionService } from '@/lib/extraction/db-service'
import pLimit from 'p-limit'

// Processing status types
export type ProcessingStatus = 'pending' | 'processing' | 'processed' | 'failed'

export interface ProcessingResult {
  paperId: string
  status: ProcessingStatus
  chunksCreated?: number
  error?: string
}

/**
 * Process a single paper - extract PDF content, create chunks, generate embeddings
 */
export async function processPaper(paperId: string): Promise<ProcessingResult> {
  const supabase = createServiceClient()
  
  try {
    // 1. Get paper record
    const { data: paper, error: fetchError } = await supabase
      .from('papers')
      .select('id, title, pdf_url, pdf_content, processing_status')
      .eq('id', paperId)
      .single()
    
    if (fetchError || !paper) {
      console.error(`[BackgroundProcessor] Paper not found: ${paperId}`, fetchError)
      return { paperId, status: 'failed', error: 'Paper not found' }
    }
    
    // 2. Skip if already processed
    if (paper.processing_status === 'processed') {
      console.log(`[BackgroundProcessor] Paper ${paperId} already processed, skipping`)
      return { paperId, status: 'processed' }
    }
    
    // 3. Check if we already have content
    if (paper.pdf_content && paper.pdf_content.length > 100) {
      console.log(`[BackgroundProcessor] Paper ${paperId} has existing content, creating chunks`)
      return await createChunksFromContent(paperId, paper.pdf_content)
    }
    
    // 4. Update status to processing
    await supabase
      .from('papers')
      .update({ processing_status: 'processing' })
      .eq('id', paperId)
    
    // 5. Get PDF from storage
    if (!paper.pdf_url) {
      console.error(`[BackgroundProcessor] Paper ${paperId} has no PDF URL`)
      await supabase
        .from('papers')
        .update({ processing_status: 'failed' })
        .eq('id', paperId)
      return { paperId, status: 'failed', error: 'No PDF URL available' }
    }
    
    // 6. Download PDF from storage
    let pdfBuffer: Buffer
    try {
      pdfBuffer = await downloadPdf(paper.pdf_url)
    } catch (downloadError) {
      console.error(`[BackgroundProcessor] Failed to download PDF for ${paperId}:`, downloadError)
      await supabase
        .from('papers')
        .update({ processing_status: 'failed' })
        .eq('id', paperId)
      return { paperId, status: 'failed', error: 'Failed to download PDF' }
    }
    
    // 7. Extract text and metadata from PDF
    console.log(`[BackgroundProcessor] Extracting text from PDF for paper ${paperId}`)
    let extractedText: string
    let extractedMetadata: {
      title?: string
      authors?: string[]
      abstract?: string
      year?: string
      doi?: string
    } = {}
    
    try {
      const extractionResult = await extractPdfMetadataTiered(pdfBuffer, { enableOcr: true })
      extractedText = extractionResult.fullText || ''
      
      // Capture extracted metadata for updating paper record
      extractedMetadata = {
        title: extractionResult.title,
        authors: extractionResult.authors,
        abstract: extractionResult.abstract,
        year: extractionResult.year,
        doi: extractionResult.doi,
      }
      
      if (extractedMetadata.title) {
        console.log(`[BackgroundProcessor] Extracted title: "${extractedMetadata.title}"`)
      }
      if (extractedMetadata.authors?.length) {
        console.log(`[BackgroundProcessor] Extracted authors: ${extractedMetadata.authors.join(', ')}`)
      }
      
      if (!extractedText || extractedText.length < 100) {
        throw new Error('Extracted text too short')
      }
    } catch (extractionError) {
      console.error(`[BackgroundProcessor] Text extraction failed for ${paperId}:`, extractionError)
      await supabase
        .from('papers')
        .update({ processing_status: 'failed' })
        .eq('id', paperId)
      return { paperId, status: 'failed', error: 'Text extraction failed' }
    }
    
    // 8. Save extracted content AND metadata to paper record
    // Only update fields if we extracted better data than the filename-based defaults
    const updateData: Record<string, unknown> = {
      pdf_content: extractedText,
    }
    
    // Update title if we extracted a real one (not just filename)
    if (extractedMetadata.title && extractedMetadata.title.length > 5) {
      updateData.title = extractedMetadata.title
      console.log(`[BackgroundProcessor] Updating paper title to: "${extractedMetadata.title}"`)
    }
    
    // Update authors if extracted
    if (extractedMetadata.authors && extractedMetadata.authors.length > 0) {
      updateData.authors = extractedMetadata.authors
    }
    
    // Update abstract if extracted
    if (extractedMetadata.abstract && extractedMetadata.abstract.length > 50) {
      updateData.abstract = extractedMetadata.abstract
    }
    
    // Update publication_date if year extracted
    if (extractedMetadata.year) {
      const year = parseInt(extractedMetadata.year, 10)
      if (year >= 1900 && year <= new Date().getFullYear() + 1) {
        updateData.publication_date = `${year}-01-01`
      }
    }
    
    // Update DOI if extracted
    if (extractedMetadata.doi) {
      updateData.doi = extractedMetadata.doi
    }
    
    await supabase
      .from('papers')
      .update(updateData)
      .eq('id', paperId)
    
    // 9. Create chunks with embeddings
    return await createChunksFromContent(paperId, extractedText)
    
  } catch (error) {
    console.error(`[BackgroundProcessor] Unexpected error processing ${paperId}:`, error)
    
    // Update status to failed
    await supabase
      .from('papers')
      .update({ processing_status: 'failed' })
      .eq('id', paperId)
    
    return { 
      paperId, 
      status: 'failed', 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}

/**
 * Create chunks from existing content
 */
async function createChunksFromContent(paperId: string, content: string): Promise<ProcessingResult> {
  const supabase = createServiceClient()
  
  try {
    console.log(`[BackgroundProcessor] Creating chunks for paper ${paperId}`)
    const chunksCreated = await createChunksForPaper(paperId, content)
    
    // Run structured extraction for synthesis engine (non-blocking)
    // This extracts findings, claims, methodology for cross-document analysis
    await runStructuredExtraction(paperId, content)
    
    // Update status to processed
    await supabase
      .from('papers')
      .update({ processing_status: 'processed' })
      .eq('id', paperId)
    
    console.log(`[BackgroundProcessor] Paper ${paperId} processed successfully, ${chunksCreated} chunks created`)
    return { paperId, status: 'processed', chunksCreated }
    
  } catch (error) {
    console.error(`[BackgroundProcessor] Failed to create chunks for ${paperId}:`, error)
    
    await supabase
      .from('papers')
      .update({ processing_status: 'failed' })
      .eq('id', paperId)
    
    return { 
      paperId, 
      status: 'failed', 
      error: error instanceof Error ? error.message : 'Chunk creation failed' 
    }
  }
}

/**
 * Run structured extraction for synthesis engine
 * This extracts findings, claims, methodology for cross-document analysis
 * Non-critical - if it fails, chunking still succeeds
 */
async function runStructuredExtraction(paperId: string, content: string): Promise<void> {
  try {
    // Skip if already extracted
    const alreadyExtracted = await hasExtractionService(paperId)
    if (alreadyExtracted) {
      console.log(`[BackgroundProcessor] Paper ${paperId} already has extraction, skipping`)
      return
    }
    
    // Skip if content is too short
    if (content.length < 500) {
      console.log(`[BackgroundProcessor] Paper ${paperId} content too short for extraction (${content.length} chars)`)
      return
    }
    
    console.log(`[BackgroundProcessor] Running structured extraction for ${paperId}`)
    
    const result = await extractPaper({
      paperId,
      text: content
    })
    
    if (result.success && result.extraction) {
      await saveExtractionService(result.extraction)
      console.log(`[BackgroundProcessor] Extracted ${result.extraction.findings.length} findings for ${paperId}`)
    } else {
      console.warn(`[BackgroundProcessor] Extraction failed for ${paperId}: ${result.error}`)
    }
  } catch (error) {
    // Non-critical failure - log but don't fail the processing
    console.warn(`[BackgroundProcessor] Extraction error for ${paperId}:`, error)
  }
}

/**
 * Download PDF from Supabase storage
 */
async function downloadPdf(pdfUrl: string): Promise<Buffer> {
  // Check if this is a Supabase storage URL/path or an external URL
  const isSupabaseStorage =
    pdfUrl.includes('supabase.co/storage') || pdfUrl.startsWith('papers/')
  const isExternalUrl =
    pdfUrl.startsWith('http://') || pdfUrl.startsWith('https://')

  if (isSupabaseStorage) {
    return downloadPdfFromSupabase(pdfUrl)
  }

  if (isExternalUrl) {
    return downloadPdfFromUrl(pdfUrl)
  }

  // Fallback: assume it's a Supabase storage path
  return downloadPdfFromSupabase(pdfUrl)
}

async function downloadPdfFromSupabase(pdfUrl: string): Promise<Buffer> {
  const supabase = createServiceClient()
  
  let storagePath: string
  if (pdfUrl.includes('supabase.co/storage')) {
    const match = pdfUrl.match(/\/storage\/v1\/object\/(?:public|authenticated)\/papers\/(.+)$/)
    if (match) {
      storagePath = match[1]
    } else {
      throw new Error(`Invalid storage URL format: ${pdfUrl}`)
    }
  } else if (pdfUrl.startsWith('papers/')) {
    storagePath = pdfUrl.replace('papers/', '')
  } else {
    storagePath = pdfUrl
  }
  
  console.log(`[BackgroundProcessor] Downloading PDF from storage: papers/${storagePath}`)
  
  const { data, error } = await supabase
    .storage
    .from('papers')
    .download(storagePath)
  
  if (error || !data) {
    throw new Error(`Storage download failed: ${error?.message || 'No data returned'}`)
  }
  
  const arrayBuffer = await data.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

async function downloadPdfFromUrl(pdfUrl: string): Promise<Buffer> {
  console.log(`[BackgroundProcessor] Downloading PDF from external URL: ${pdfUrl}`)
  
  const response = await fetch(pdfUrl, {
    headers: { 'Accept': 'application/pdf' },
    signal: AbortSignal.timeout(30_000),
  })
  
  if (!response.ok) {
    throw new Error(`External PDF download failed: ${response.status} ${response.statusText}`)
  }
  
  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * Process multiple papers with continuous concurrency
 * Uses p-limit to avoid batch synchronization (where slowest paper holds up the batch)
 */
export async function processMultiplePapers(
  paperIds: string[],
  options: { maxConcurrent?: number } = {}
): Promise<ProcessingResult[]> {
  const { maxConcurrent = 3 } = options
  
  console.log(`[BackgroundProcessor] Processing ${paperIds.length} papers (max concurrent: ${maxConcurrent})`)
  
  // Use p-limit for continuous concurrency without batch synchronization
  const limit = pLimit(maxConcurrent)
  
  const results = await Promise.all(
    paperIds.map(paperId => limit(() => processPaper(paperId)))
  )
  
  const successful = results.filter(r => r.status === 'processed').length
  const failed = results.filter(r => r.status === 'failed').length
  console.log(`[BackgroundProcessor] Completed: ${successful} successful, ${failed} failed`)
  
  return results
}

/**
 * Process all pending papers for a project
 */
export async function processProjectPapers(projectId: string): Promise<ProcessingResult[]> {
  const supabase = createServiceClient()
  
  // Get all papers linked to this project that need processing
  const { data: projectCitations, error } = await supabase
    .from('project_citations')
    .select(`
      paper_id,
      papers!inner (
        id,
        processing_status
      )
    `)
    .eq('project_id', projectId)
  
  if (error) {
    console.error(`[BackgroundProcessor] Failed to fetch project papers:`, error)
    return []
  }
  
  // Filter to papers that need processing
  const pendingPaperIds = (projectCitations || [])
    .filter(pc => {
      const paper = pc.papers as unknown as { id: string; processing_status: string }
      return paper && paper.processing_status !== 'processed'
    })
    .map(pc => pc.paper_id)
  
  if (pendingPaperIds.length === 0) {
    console.log(`[BackgroundProcessor] No pending papers for project ${projectId}`)
    return []
  }
  
  console.log(`[BackgroundProcessor] Processing ${pendingPaperIds.length} papers for project ${projectId}`)
  return await processMultiplePapers(pendingPaperIds)
}

/**
 * Get processing status for multiple papers
 * 
 * Falls back to checking if chunks exist when processing_status column is unavailable
 */
export async function getPapersProcessingStatus(
  paperIds: string[]
): Promise<Map<string, ProcessingStatus>> {
  if (paperIds.length === 0) {
    return new Map()
  }
  
  const supabase = createServiceClient()
  
  // Try to get processing_status from papers table
  const { data, error } = await supabase
    .from('papers')
    .select('id, processing_status')
    .in('id', paperIds)
  
  if (error) {
    console.error(`[BackgroundProcessor] Failed to fetch processing status:`, error)
    
    // Fallback: If the column doesn't exist, check for chunks instead
    // A paper with chunks is considered "processed"
    if (error.message?.includes('processing_status') || error.code === 'PGRST116') {
      console.log('[BackgroundProcessor] Falling back to chunk-based status detection')
      return await getStatusFromChunks(paperIds)
    }
    
    return new Map()
  }
  
  const statusMap = new Map<string, ProcessingStatus>()
  for (const paper of data || []) {
    statusMap.set(paper.id, (paper.processing_status as ProcessingStatus) || 'pending')
  }
  
  // For any papers not found in result, mark as pending
  for (const paperId of paperIds) {
    if (!statusMap.has(paperId)) {
      statusMap.set(paperId, 'pending')
    }
  }
  
  return statusMap
}

/**
 * Fallback: Determine processing status by checking for chunks
 */
async function getStatusFromChunks(paperIds: string[]): Promise<Map<string, ProcessingStatus>> {
  const supabase = createServiceClient()
  const statusMap = new Map<string, ProcessingStatus>()
  
  // Initialize all as pending
  for (const paperId of paperIds) {
    statusMap.set(paperId, 'pending')
  }
  
  // Check which papers have chunks
  const { data: chunks, error } = await supabase
    .from('paper_chunks')
    .select('paper_id')
    .in('paper_id', paperIds)
  
  if (error) {
    console.error('[BackgroundProcessor] Failed to fetch chunks for status fallback:', error)
    return statusMap
  }
  
  // Papers with at least one chunk are considered processed
  const papersWithChunks = new Set(chunks?.map(c => c.paper_id) || [])
  for (const paperId of papersWithChunks) {
    statusMap.set(paperId, 'processed')
  }
  
  return statusMap
}

/**
 * Check if all papers for a project are processed
 */
export async function areProjectPapersProcessed(projectId: string): Promise<boolean> {
  const supabase = createServiceClient()
  
  const { data, error } = await supabase
    .from('project_citations')
    .select(`
      paper_id,
      papers!inner (
        processing_status
      )
    `)
    .eq('project_id', projectId)
  
  if (error || !data) {
    return false
  }
  
  return data.every(pc => {
    const paper = pc.papers as unknown as { processing_status: string }
    return paper?.processing_status === 'processed'
  })
}
