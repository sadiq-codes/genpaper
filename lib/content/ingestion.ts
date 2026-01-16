/**
 * Centralized Content Ingestion Module
 * 
 * All content ingestion, chunking, and paper management functions are consolidated here
 * to avoid duplication across the codebase.
 */

import { getSB } from '@/lib/supabase/server'
import { getServiceClient } from '@/lib/supabase/service'
import { chunkByTokens, normalizeText, type TokenChunkOptions } from '@/lib/utils/text'
import { collisionResistantHash } from '@/lib/utils/hash'
import { ContentRetrievalError, IngestionError, ChunkingError } from './errors'
import { getPDFContent, hasPDFContent } from '@/lib/pdf/pdf-utils'
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
    const supabase = await getSB()
    // Use service client for paper_chunks writes to bypass RLS
    // (RLS requires service_role for INSERT/UPDATE/DELETE on paper_chunks)
    const serviceClient = getServiceClient()

    // Fetch existing chunks to detect content changes via hash
    const { data: existingChunks, error: checkError } = await supabase
      .from('paper_chunks')
      .select('content, chunk_index')
      .eq('paper_id', paperId)
      .order('chunk_index', { ascending: true })

    if (checkError) {
      console.warn(`Error fetching existing chunks for paper ${paperId}:`, checkError.message)
      // Continue; we'll attempt to (re)create chunks
    }

    const normalizedContent = normalizeText(trimmed)
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
    }

    // Handle short content: ensure at least one chunk for short abstracts
    if (normalizedContent.length < 100) {
      const { createDeterministicChunkId } = await import('@/lib/utils/deterministic-id')
      const { generateEmbeddings } = await import('@/lib/utils/embedding')

      const [embedding] = await generateEmbeddings([normalizedContent])
      const chunkId = createDeterministicChunkId(paperId, normalizedContent, 0)

      const { error } = await serviceClient
        .from('paper_chunks')
        .upsert({
          id: chunkId,
          paper_id: paperId,
          chunk_index: 0,
          content: normalizedContent,
          embedding
          // Note: metadata field removed - was computing section_type, has_citations, etc.
          // but these were never used for filtering or retrieval
        }, {
          onConflict: 'id',
          ignoreDuplicates: true
        })

      if (error) {
        // Log error but don't throw - chunk might already exist from parallel processing
        console.warn(`Chunk insertion warning for paper ${paperId}:`, error.message)
        
        // Verify chunk exists - if not, this is a real error
        const { data: verifyChunk } = await supabase
          .from('paper_chunks')
          .select('id')
          .eq('paper_id', paperId)
          .limit(1)
        
        if (!verifyChunk || verifyChunk.length === 0) {
          throw new ChunkingError(`Failed to insert short-content chunk: ${error.message}`)
        }
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

    // Insert chunks into database with embeddings
    const chunkData = chunks.map((chunk, index) => ({
      id: chunk.id,
      paper_id: paperId,
      chunk_index: index,
      content: chunk.content,
      embedding: embeddings[index]
    }))
    
    let { error } = await serviceClient
      .from('paper_chunks')
      .upsert(chunkData, {
        onConflict: 'id',
        ignoreDuplicates: true
      })
    
    if (error) {
      // Log warning but don't throw - chunks might already exist from parallel processing
      console.warn(`Chunk insertion warning for paper ${paperId}:`, error.message)
      
      // Verify at least some chunks exist - if not, this is a real error
      const { data: verifyChunks } = await supabase
        .from('paper_chunks')
        .select('id')
        .eq('paper_id', paperId)
        .limit(3)
      
      if (!verifyChunks || verifyChunks.length === 0) {
        throw new ChunkingError(`Failed to insert chunks: ${error.message}`)
      }
      
      console.log(`⚠️ Some chunks may have been duplicates, but ${verifyChunks.length} chunks exist for paper`)
    }

    // Verify actual chunk count in database
    const { count: actualCount } = await supabase
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
 * Bulk content ingestion with PDF processing
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
        const _status = contentStatus.get(paper.id)
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
            maxTokens,
            overlapTokens,
            tokenChunkOptions
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
