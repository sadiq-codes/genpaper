/**
 * Centralized Content Ingestion Module
 * 
 * All content ingestion, chunking, and paper management functions are consolidated here
 * to avoid duplication across the codebase.
 */

import { getSB } from '@/lib/supabase/server'
import { splitIntoChunks, normalizeText } from '@/lib/utils/text'
import { ContentRetrievalError, NoRelevantContentError, IngestionError, ChunkingError } from './errors'
import { getPDFContent, hasPDFContent } from '@/lib/services/pdf-downloader'
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
  regionDetection?: { enabled: boolean }
  forceReprocess?: boolean
  chunkSize?: number
  chunkOverlap?: number
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

/**
 * Get content availability status for multiple papers
 */
export async function getContentStatus(paperIds: string[]): Promise<Map<string, ContentStatus>> {
  if (paperIds.length === 0) {
    return new Map()
  }

  try {
    const supabase = await getSB()
    
    // Get papers with their content info
    const { data: papers, error } = await supabase
      .from('papers')
      .select(`
        id,
        abstract,
        pdf_content,
        paper_chunks(count)
      `)
      .in('id', paperIds)

    if (error) {
      throw new ContentRetrievalError(`Failed to fetch content status: ${error.message}`)
    }

    const statusMap = new Map<string, ContentStatus>()

    for (const paper of papers || []) {
      const hasPdf = !!(paper.pdf_content && paper.pdf_content.length > 0)
      const hasAbstract = !!(paper.abstract && paper.abstract.length > 100)
      const chunkCount = Array.isArray(paper.paper_chunks) ? paper.paper_chunks.length : 0

      let contentType: 'pdf' | 'abstract' | 'none' = 'none'
      let contentLength = 0
      let hasContent = false

      if (hasPdf) {
        contentType = 'pdf'
        contentLength = paper.pdf_content.length
        hasContent = true
      } else if (hasAbstract) {
        contentType = 'abstract'
        contentLength = paper.abstract.length
        hasContent = true
      }

      statusMap.set(paper.id, {
        paperId: paper.id,
        hasContent,
        contentType,
        contentLength,
        chunkCount
      })
    }

    // Add missing papers as having no content
    for (const paperId of paperIds) {
      if (!statusMap.has(paperId)) {
        statusMap.set(paperId, {
          paperId,
          hasContent: false,
          contentType: 'none',
          contentLength: 0,
          chunkCount: 0
        })
      }
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
    const supabase = await getSB()
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
          url: paper.url || '',
          metadata: paper.metadata || {},
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
  options: { chunkSize?: number; overlap?: number } = {}
): Promise<number> {
  if (!content || content.trim().length < 100) {
    return 0
  }

  try {
    const supabase = await getSB()
    const normalizedContent = normalizeText(content)
    
    // Create chunks using centralized function
    const chunks = splitIntoChunks(normalizedContent, paperId, {
      maxLength: options.chunkSize || 1000,
      overlap: options.overlap || 100,
      preserveParagraphs: true,
      minChunkSize: 100
    })

    if (chunks.length === 0) {
      return 0
    }

    // Insert chunks into database
    const { error } = await supabase
      .from('paper_chunks')
      .insert(chunks.map(chunk => ({
        id: chunk.id,
        paper_id: paperId,
        content: chunk.content,
        position: chunk.position,
        metadata: {
          word_count: chunk.metadata?.wordCount || 0,
          char_count: chunk.metadata?.charCount || 0,
          is_overlap: chunk.metadata?.isOverlap || false
        }
      })))

    if (error) {
      throw new ChunkingError(`Failed to insert chunks: ${error.message}`)
    }

    console.log(`✅ Created ${chunks.length} chunks for paper ${paperId}`)
    return chunks.length
  } catch (error) {
    console.error(`Error creating chunks for paper ${paperId}:`, error)
    throw new ChunkingError(`Failed to create chunks for paper ${paperId}: ${error}`)
  }
}

/**
 * Bulk content ingestion with PDF processing
 */
export async function ensureBulkContentIngestion(
  papers: PaperWithAuthors[],
  options: IngestionOptions = {}
): Promise<BulkIngestionSummary> {
  const {
    skipChunks = false,
    forceReprocess = false,
    chunkSize = 1000,
    chunkOverlap = 100
  } = options

  console.log(`📥 Starting bulk content ingestion for ${papers.length} papers...`)
  
  const results: IngestionResult[] = []
  let totalChunks = 0

  try {
    // Ensure all papers exist in database
    await ensurePapersExist(papers)

    // Get current content status
    const contentStatus = await getContentStatus(papers.map(p => p.id))

    for (const paper of papers) {
      try {
        const status = contentStatus.get(paper.id)
        let content = ''
        let contentLength = 0
        let chunksCreated = 0

        // Skip if already has content and not forcing reprocess
        if (!forceReprocess && status?.hasContent && status.chunkCount > 0) {
          console.log(`⏭️  Skipping ${paper.title} - already has ${status.chunkCount} chunks`)
          results.push({
            paperId: paper.id,
            success: true,
            chunksCreated: status.chunkCount,
            contentLength: status.contentLength
          })
          totalChunks += status.chunkCount
          continue
        }

        // Try to get PDF content first
        const hasPdf = await hasPDFContent(paper.id)
        if (hasPdf) {
          const pdfContent = await getPDFContent(paper.id)
          if (pdfContent && pdfContent.length > 500) {
            content = pdfContent
            contentLength = content.length
            console.log(`📄 Using PDF content for "${paper.title}" (${contentLength} chars)`)
          }
        }

        // Fallback to abstract if no PDF content
        if (!content && paper.abstract && paper.abstract.length > 100) {
          content = paper.abstract
          contentLength = content.length
          console.log(`📝 Using abstract for "${paper.title}" (${contentLength} chars)`)
        }

        // Create chunks if we have content and not skipping
        if (content && !skipChunks) {
          chunksCreated = await createChunksForPaper(paper.id, content, {
            chunkSize,
            overlap: chunkOverlap
          })
          totalChunks += chunksCreated
        }

        results.push({
          paperId: paper.id,
          success: true,
          chunksCreated,
          contentLength
        })

      } catch (error) {
        console.error(`❌ Failed to process paper ${paper.title}:`, error)
        results.push({
          paperId: paper.id,
          success: false,
          chunksCreated: 0,
          contentLength: 0,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    const successful = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    console.log(`✅ Bulk ingestion complete: ${successful}/${papers.length} successful, ${totalChunks} total chunks`)

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