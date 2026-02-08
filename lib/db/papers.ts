import { getServiceClient } from '@/lib/supabase/service'
import type { PaperWithAuthors } from '@/types/simplified'
import { generateEmbeddings } from '@/lib/utils/embedding'
import { PaperDTO } from '@/lib/schemas/paper'
import { debug, info, warn, error as logError } from '@/lib/utils/logger'
import { expandWithStems } from '@/lib/utils/stemmer'
 

// Centralized embedding configuration to ensure consistency


// Simplified text processing - using centralized text utilities

// Import the unified chunk processor
import { createChunksForPaper } from '@/lib/content/ingestion'

// Type definitions for database query results  
interface DatabasePaper {
  id: string
  title: string
  abstract?: string
  publication_date?: string
  venue?: string
  doi?: string
  url?: string
  pdf_url?: string
  metadata?: Record<string, unknown>
  source: string
  citation_count: number
  created_at: string
  authors: string[]
}


// Helper function to transform database papers to app format
function transformDatabasePaper(dbPaper: DatabasePaper): PaperWithAuthors {
  const authors = Array.isArray(dbPaper.authors) ? dbPaper.authors : []

  return {
    ...dbPaper,
    authors: authors.map((name: string) => ({ id: '', name })), // Create minimal Author objects
    author_names: authors
  }
}

// UUID validator to guard DB queries against invalid inputs
function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(value)
}

export async function getPaper(paperId: string): Promise<PaperWithAuthors | null> {
  // Use service client to bypass RLS - papers table requires authenticated users
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('papers')
    .select(`
      *,
      authors
    `)
    .eq('id', paperId)
    .single()

  if (error && error.code !== 'PGRST116') throw error
  if (!data) return null

  return transformDatabasePaper(data as DatabasePaper)
}

export async function getPapersByIds(paperIds: string[]): Promise<PaperWithAuthors[]> {
  if (!paperIds || paperIds.length === 0) {
    return []
  }

  // Use service client to bypass RLS - papers table requires authenticated users
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('papers')
    .select(`
      *,
      authors
    `)
    .in('id', paperIds)

  if (error) throw error

  return (data || []).map((paper: DatabasePaper) => transformDatabasePaper(paper))
}

// Type definitions for RPC functions
interface HybridSearchResult {
  id: string  // Database RPC returns 'id', not 'paper_id'
  semantic_score: number
  keyword_score: number
  combined_score: number
}

interface SimilarPapersResult {
  paper_id: string
  score: number
}

export async function hybridSearchPapers(
  query: string,
  options: {
    limit?: number
    excludePaperIds?: string[]
    minYear?: number
    maxYear?: number
    sources?: string[]
    semanticWeight?: number
  } = {}
): Promise<PaperWithAuthors[]> {
  // Use service client to bypass RLS - this is called from Inngest background jobs
  const supabase = getServiceClient()
  const { 
    limit = 10, 
    minYear = 2000, 
    sources, 
    semanticWeight = 0.7,
    excludePaperIds = [],
    maxYear = 2024
  } = options

  debug({ query, limit, minYear, maxYear, sources, semanticWeight, excludeCount: excludePaperIds.length }, 'Hybrid search starting')

  // 1. Generate embedding for the query using centralized configuration
  const [queryEmbedding] = await generateEmbeddings([query])
  debug({ dimensions: queryEmbedding.length }, 'Query embedding generated')

  // 2. Call the hybrid search RPC function
  
  const { data: searchResults, error } = await supabase
    .rpc('hybrid_search_papers', {
      query_text: query,
      query_embedding: queryEmbedding,
      match_count: limit * 2,
      min_year: minYear,
      semantic_weight: semanticWeight
    })

  if (error) {
    warn({ error }, 'RPC search failed, falling back to text search')
    
    // Fallback to basic text search if RPC fails
    // Use stemming to match related words (e.g., "religion" matches "religious")
    const queryWords = query.toLowerCase().split(/\s+/).filter(word => word.length > 2)
    const expandedWords = expandWithStems(queryWords)
    debug({ queryWords, expandedWords }, 'Fallback search with stemmed terms')
    
    const { data: fallbackResults, error: fallbackError } = await supabase
      .from('papers')
      .select('*')
      .or(expandedWords.map(word => `title.ilike.%${word}%,abstract.ilike.%${word}%`).join(','))
      .gte('publication_date', `${minYear}-01-01`)
      .order('citation_count', { ascending: false })
      .limit(limit)
    
    if (fallbackError) {
      logError({ error: fallbackError }, 'Fallback search also failed')
      throw error // Throw original RPC error
    }
    
    debug({ count: fallbackResults?.length || 0 }, 'Fallback search completed')
    
    if (fallbackResults && fallbackResults.length > 0) {
      const transformedResults = fallbackResults.map((paper) => ({
        ...transformDatabasePaper(paper as DatabasePaper),
        relevance_score: 0.1, // Low score - text match only, no semantic verification
        semantic_score: 0.0,
        keyword_score: 0.1
      }))
      
      return transformedResults
    }
    
    throw error // If both searches fail, throw original error
  }

  debug({ resultCount: searchResults?.length || 0 }, 'RPC search completed')
  
  if (searchResults && searchResults.length > 0) {
    // Check for semantic search failure (all scores zero)
    const allSemanticZero = searchResults.every((r: HybridSearchResult) => r.semantic_score === 0)
    if (allSemanticZero) {
      warn('All semantic scores are zero, falling back to keyword-only ranking')
      // Re-rank by keyword score when semantic search fails
      searchResults.sort((a: HybridSearchResult, b: HybridSearchResult) => 
        b.keyword_score - a.keyword_score
      )
      searchResults.forEach((r: HybridSearchResult) => {
        r.combined_score = r.keyword_score
      })
    }
  } else {
    warn({ queryLength: queryEmbedding.length, minYear, semanticWeight }, 'RPC returned no results')
  }

  // 3. Filter out excluded papers with meaningful relevance threshold
  // A combined_score of 0.3 indicates reasonable semantic/keyword similarity
  // Lower scores often indicate irrelevant papers that happen to be in the database
  const MIN_RELEVANCE_SCORE = 0.3
  
  const filteredResults = (searchResults || []).filter(
    (result: HybridSearchResult) => 
      !excludePaperIds.includes(result.id) &&
      result.combined_score >= MIN_RELEVANCE_SCORE
  )

  debug({ beforeFilter: searchResults?.length || 0, afterFilter: filteredResults.length }, 'Filtered results')

  // 4. Get full paper details for the top results
  if (filteredResults.length === 0) {
    // No fallback to relaxed threshold - return empty instead of low-quality results
    // This ensures only genuinely relevant papers are returned
    debug('No papers passed relevance threshold (0.3) - returning empty results')
    return []
  }

  // 5. Get full paper details for the top results
  const topResults = filteredResults.slice(0, limit)
  
  // Guard invalid IDs before querying
  const topIds = topResults.map((r: HybridSearchResult) => r.id).filter(isValidUuid)
  if (topIds.length === 0) {
    debug('No valid UUIDs in top results')
    return []
  }

  let papersQuery = supabase
    .from('papers')
    .select(`
      *,
      authors
    `)
    .in('id', topIds)

  // Apply source filter if provided
  if (sources && sources.length > 0) {
    // Check if any papers match the source filter before applying it
    const sourceFilterTest = await supabase
      .from('papers')
      .select('id', { count: 'exact' })
      .in('id', topIds)
      .in('source', sources)
      .limit(1)
    
    if (sourceFilterTest.data && sourceFilterTest.data.length > 0) {
      papersQuery = papersQuery.in('source', sources)
    } else {
      debug({ sources }, 'Source filter would exclude all papers, skipping')
    }
  }

  const { data: papers, error: papersError } = await papersQuery

  if (papersError) {
    logError({ error: papersError }, 'Failed to fetch paper details')
    throw papersError
  }
  
  // If we got 0 papers due to source filtering, try without the filter
  if ((!papers || papers.length === 0) && sources && sources.length > 0) {
    const { data: unfilteredPapers, error: unfilteredError } = await supabase
      .from('papers')
      .select(`
        *,
        authors:paper_authors(
          ordinal,
          author:authors(*)
        )
      `)
      .in('id', topIds)
    
    if (unfilteredError) {
      logError({ error: unfilteredError }, 'Failed to fetch unfiltered paper details')
      throw unfilteredError
    }
    
    // Use the unfiltered results
    const paperMap = new Map(unfilteredPapers?.map(p => [p.id, p]) || [])
    
    const finalResults = topResults
      .map((result: HybridSearchResult) => {
        const paper = paperMap.get(result.id)
        if (!paper) return null
        
        const transformedPaper = transformDatabasePaper(paper as DatabasePaper)
        
        return {
          ...transformedPaper,
          relevance_score: result.combined_score,
          semantic_score: result.semantic_score,
          keyword_score: result.keyword_score
        }
      })
      .filter(Boolean) as PaperWithAuthors[]

    info({ count: finalResults.length }, 'Hybrid search completed (unfiltered)')
    return finalResults
  }

  // Transform and sort by hybrid score
  const paperMap = new Map(papers?.map(p => [p.id, p]) || [])
  
  const finalResults = topResults
    .map((result: HybridSearchResult) => {
        const paper = paperMap.get(result.id)
        if (!paper) {
          return null
        }
      
      const transformedPaper = transformDatabasePaper(paper as DatabasePaper)
      
      return {
        ...transformedPaper,
        relevance_score: result.combined_score,
        semantic_score: result.semantic_score,
        keyword_score: result.keyword_score
      }
    })
    .filter(Boolean) as PaperWithAuthors[]

  return finalResults
}

export async function findSimilarPapers(
  paperId: string,
  limit = 5
): Promise<PaperWithAuthors[]> {
  // Use service client to bypass RLS - papers table requires authenticated users
  const supabase = getServiceClient()
  
  // Get the embedding for the reference paper
  const { data: referencePaper, error: refError } = await supabase
    .from('papers')
    .select('embedding')
    .eq('id', paperId)
    .single()
  
  if (refError) throw refError
  if (!referencePaper?.embedding) {
    throw new Error('Reference paper has no embedding')
  }
  
  // Find similar papers using cosine similarity
  const { data: matches, error } = await supabase
    .rpc('find_similar_papers', {
      query_embedding: referencePaper.embedding,
      exclude_paper_id: paperId,
      match_count: limit
    })
  
  if (error) throw error
  if (!matches || matches.length === 0) return []
  
  // Get full paper details
  const { data: papers, error: papersError } = await supabase
    .from('papers')
    .select(`
      *,
      authors
    `)
    .in('id', (matches as SimilarPapersResult[]).map(m => m.paper_id))
  
  if (papersError) throw papersError
  
  // Transform and sort by similarity score
  const paperMap = new Map(papers?.map(p => [p.id, p]) || [])
  
  return (matches as SimilarPapersResult[])
    .map(match => {
      const paper = paperMap.get(match.paper_id)
      if (!paper) return null
      
      const transformedPaper = transformDatabasePaper(paper as DatabasePaper)
      
      return {
        ...transformedPaper,
        relevance_score: match.score
      }
    })
    .filter(Boolean) as PaperWithAuthors[]
}

export async function searchPaperChunks(
  query: string,
  options: {
    paperIds?: string[]
    limit?: number
    minScore?: number
  } = {}
): Promise<Array<{paper_id: string, content: string, score: number}>> {
  // Use service client to bypass RLS - paper_chunks table requires authenticated users
  const supabase = getServiceClient()
  
  // Generate embedding for the query
  const [queryEmbedding] = await generateEmbeddings([query])
  
  const {
    paperIds,
    limit = 50,
    minScore = 0.1
  } = options

  // Single-pass RPC call (MVP): one threshold, one limit, minimal logging
  const { data: searchResults, error } = await supabase
    .rpc('match_paper_chunks', {
      query_embedding: queryEmbedding,
      match_count: limit,
      min_score: minScore,
      paper_ids: paperIds || null
    })

  if (error) {
    logError({ error }, 'Chunk search failed')
    return []
  }

  const results = (searchResults as Array<{paper_id: string, content: string, score: number}> | null) || []
  return results.sort((a, b) => b.score - a.score).slice(0, limit)
}


// Clean, Simple Ingestion Interface

/**
 * THE ONLY ENTRY POINT for paper ingestion - Clean Gatekeeper Architecture
 * 
 * This function is the front door that validates requests and decides whether to:
 * 1. Process immediately (for small content)
 * 2. Hand off to background queue (for PDFs and large content)
 * 3. Create metadata only (for lightweight ingestion)
 * 
 * The key insight: This function NEVER does heavy processing itself.
 * It's purely a decision-maker and dispatcher.
 * 
 * @param paperData - Complete paper metadata
 * @param options - Processing configuration
 * @param options.ownerId - User ID for ownership. NULL/undefined = global paper, UUID = user-uploaded
 * @returns Result with paper ID and processing status
 */
export async function ingestPaper(
  paperData: PaperDTO,
  options: { fullText?: string; pdfUrl?: string; background?: boolean; priority?: 'low' | 'normal' | 'high'; ownerId?: string | null } = {}
): Promise<{ paperId: string; isNew: boolean; status: 'metadata_only' | 'processed' | 'queued' }> {
  
  // 1. Check for duplicates (idempotent)
  // For user uploads (ownerId provided): only match user's own papers or global papers
  // For API/search (no ownerId): match any existing paper
  // This ensures users can upload their own copy even if a global copy exists
  const checkOptions = options.ownerId 
    ? { ownerId: options.ownerId, userOnly: true } // For uploads: only reuse if user already has this paper
    : undefined // For search/cite: reuse any existing paper
  
  const { exists, paperId: existingId } = await checkPaperExists(paperData.doi, paperData.title, checkOptions)
  if (exists && existingId) {
    debug({ paperId: existingId }, 'Paper already exists')
    
    // If we have new content for existing paper, process it
    if (options.pdfUrl) {
      await queuePdfProcessing(existingId, options.pdfUrl, paperData.title, options.priority || 'normal')
      return { paperId: existingId, isNew: false, status: 'queued' }
    } else if (options.fullText) {
      await processContentImmediately(existingId, options.fullText)
      return { paperId: existingId, isNew: false, status: 'processed' }
    }
    
    return { paperId: existingId, isNew: false, status: 'metadata_only' }
  }

  // 2. Create the basic paper metadata record (with ownership)
  const newPaperId = await createPaperMetadata(paperData, options.ownerId)
  debug({ paperId: newPaperId }, 'Created new paper')

  // 3. Decide how to handle content
  if (options.pdfUrl) {
    // If there's a PDF URL, ALWAYS queue it for background processing
    await queuePdfProcessing(newPaperId, options.pdfUrl, paperData.title, options.priority || 'normal')
    return { paperId: newPaperId, isNew: true, status: 'queued' }
  } 
  else if (options.fullText) {
    // If raw text is provided, process it immediately
    await processContentImmediately(newPaperId, options.fullText)
    return { paperId: newPaperId, isNew: true, status: 'processed' }
  }

  // No content provided - this is a metadata-only paper
  // Mark as 'processed' since there's nothing more to process
  // (embedding was already generated from title+abstract in createPaperMetadata)
  const supabase = getServiceClient()
  await supabase
    .from('papers')
    .update({ processing_status: 'processed' })
    .eq('id', newPaperId)
  
  return { paperId: newPaperId, isNew: true, status: 'processed' }
}

/**
 * Create paper metadata (extracted from old ingestPaperLightweight)
 * 
 * Bibliographic fields (volume, issue, pages, publisher) are stored in the metadata JSONB column.
 * These fields come from academic APIs at ingestion time and are needed later for complete citations.
 * We store them here because:
 * 1. Academic APIs provide them during search/ingestion
 * 2. Papers may be cited much later, after the API data is gone
 * 3. CSL JSON generation reads from papers.metadata for these fields
 * 
 * @param paperData - Paper metadata to store
 * @param ownerId - Optional user ID for ownership. NULL = global/API paper, UUID = user-uploaded
 * 
 * NOTE: Uses service role client to bypass RLS (papers are shared resources)
 */
export async function createPaperMetadata(paperData: PaperDTO, ownerId?: string | null): Promise<string> {
  const supabase = getServiceClient()
  
  // Generate embedding from title + abstract before inserting
  // This is required because the database has a NOT NULL constraint on the embedding column
  const text = `${paperData.title}\n${paperData.abstract || ''}`
  const [embedding] = await generateEmbeddings([text])
  
  // Store bibliographic fields in metadata JSONB column
  // These are needed for complete citation generation (volume, issue, pages, publisher)
  const metadata: Record<string, unknown> = {}
  if (paperData.volume) metadata.volume = paperData.volume
  if (paperData.issue) metadata.issue = paperData.issue
  if (paperData.pages) metadata.pages = paperData.pages
  if (paperData.publisher) metadata.publisher = paperData.publisher
  
  // Insert paper metadata with embedding, authors, and ownership
  // processing_status starts as 'pending' - will be updated when content is processed
  const { data, error } = await supabase
    .from('papers')
    .insert({
      title: paperData.title,
      abstract: paperData.abstract,
      authors: paperData.authors || [], // Store authors as JSONB array
      publication_date: paperData.publication_date,
      venue: paperData.venue,
      doi: paperData.doi,
      pdf_url: paperData.pdf_url,
      source: paperData.source || 'unknown',
      citation_count: paperData.citation_count || 0,
      embedding: embedding, // Generate embedding immediately to satisfy NOT NULL constraint
      metadata: Object.keys(metadata).length > 0 ? metadata : null, // Store bibliographic fields
      owner_id: ownerId || null, // NULL = global paper, UUID = user-uploaded
      is_public: false, // User papers are private by default
      processing_status: 'pending' // Will be updated to 'processed' after content ingestion
    })
    .select('id')
    .single()
  
  if (error) throw error
  if (!data) throw new Error('Failed to create paper - no ID returned')
  
  const paperId = data.id
  
  // Seed an abstract chunk so Tier 3 RAG works immediately (before PDF processing).
  // The paper embedding was already generated from title+abstract above — reuse it.
  // When PDF processing completes, createChunksForPaper will replace this with
  // full-text chunks (it deletes existing chunks before writing new ones).
  const abstractText = paperData.abstract?.trim()
  if (abstractText && abstractText.length > 30) {
    try {
      const { createDeterministicChunkId } = await import('@/lib/utils/deterministic-id')
      const chunkId = createDeterministicChunkId(paperId, abstractText, 0)
      
      await supabase
        .from('paper_chunks')
        .upsert({
          id: chunkId,
          paper_id: paperId,
          chunk_index: 0,
          content: abstractText,
          embedding,  // Reuse the same embedding (title+abstract)
        }, {
          onConflict: 'paper_id,chunk_index',
          ignoreDuplicates: true,
        })
      
      debug({ paperId }, 'Seeded abstract chunk for immediate Tier 3 RAG')
    } catch (chunkErr) {
      // Non-fatal — PDF processing will create proper chunks later
      warn({ paperId, error: chunkErr }, 'Failed to seed abstract chunk')
    }
  }
  
  return paperId
}


/**
 * Process content immediately (synchronous)
 * Creates chunks and updates processing_status to 'processed'
 */
async function processContentImmediately(paperId: string, fullText: string): Promise<void> {
  const supabase = getServiceClient()
  
  try {
    // Update status to processing
    await supabase
      .from('papers')
      .update({ processing_status: 'processing' })
      .eq('id', paperId)
    
    // Create chunks from content
    await createChunksForPaper(paperId, fullText)
    
    // Update status to processed
    await supabase
      .from('papers')
      .update({ processing_status: 'processed' })
      .eq('id', paperId)
  } catch (err) {
    // Update status to failed on error
    await supabase
      .from('papers')
      .update({ processing_status: 'failed' })
      .eq('id', paperId)
    throw err
  }
}

/**
 * Queue PDF processing
 * Extracts text from PDF and creates chunks, managing processing_status throughout
 */
async function queuePdfProcessing(paperId: string, pdfUrl: string, _title: string, _priority: 'low' | 'normal' | 'high'): Promise<void> {
  const supabase = getServiceClient()
  
  try {
    // Update status to processing
    await supabase
      .from('papers')
      .update({ processing_status: 'processing' })
      .eq('id', paperId)
    
    // Direct processing via unified helper (no background queue)
    const { getOrExtractFullText } = await import('@/lib/services/pdf-processor')
    const text = await getOrExtractFullText({ pdfUrl, paperId, ocr: true, timeoutMs: 60000 })
    
    if (text && text.length > 100) {
      // Create chunks - processContentImmediately will update status to 'processed'
      await createChunksForPaper(paperId, text)
      
      // Update status to processed
      await supabase
        .from('papers')
        .update({ processing_status: 'processed' })
        .eq('id', paperId)
    } else {
      // No usable content extracted - mark as processed (metadata only)
      // This is not a failure, just means we only have metadata
      await supabase
        .from('papers')
        .update({ processing_status: 'processed' })
        .eq('id', paperId)
    }
  } catch (err) {
    // Update status to failed on error
    await supabase
      .from('papers')
      .update({ processing_status: 'failed' })
      .eq('id', paperId)
    // Don't throw - PDF processing failure shouldn't break paper ingestion
    console.error(`[queuePdfProcessing] Failed to process PDF for ${paperId}:`, err)
  }
}

// Author management functions removed - authors are now stored as JSONB arrays

/**
 * Check if paper exists by DOI or title to prevent duplicates
 * 
 * @param doi - DOI to check
 * @param title - Title to check (fuzzy match)
 * @param options - Optional parameters
 * @param options.ownerId - If provided, only match papers owned by this user OR global papers.
 *                          For uploads: pass the user's ID to avoid reusing another user's paper.
 *                          For search/cite: omit to match any existing paper (current behavior).
 * @param options.globalOnly - If true, only match global papers (owner_id IS NULL)
 * @param options.userOnly - If true, only match papers owned by ownerId (requires ownerId)
 */
export async function checkPaperExists(
  doi?: string, 
  title?: string,
  options?: { 
    ownerId?: string | null
    globalOnly?: boolean
    userOnly?: boolean
  }
): Promise<{ exists: boolean, paperId?: string, isGlobal?: boolean }> {
  // Use service client to bypass RLS - this is called from Inngest background jobs
  const supabase = getServiceClient()
  
  const { ownerId, globalOnly, userOnly } = options || {}
  
  // First check by DOI if available
  if (doi) {
    let query = supabase
      .from('papers')
      .select('id, owner_id')
      .eq('doi', doi)
    
    // Apply ownership filter
    if (globalOnly) {
      query = query.is('owner_id', null)
    } else if (userOnly && ownerId) {
      query = query.eq('owner_id', ownerId)
    } else if (ownerId) {
      // Match this user's papers OR global papers (for upload dedup)
      query = query.or(`owner_id.eq.${ownerId},owner_id.is.null`)
    }
    
    const { data, error } = await query.limit(1).single()
    
    if (!error && data) {
      return { exists: true, paperId: data.id, isGlobal: data.owner_id === null }
    }
  }
  
  // Fallback: check by normalized title for papers without DOI
  if (title) {
    const normalizedTitle = title.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    
    let query = supabase
      .from('papers')
      .select('id, title, owner_id')
      .ilike('title', `%${normalizedTitle}%`)
    
    // Apply ownership filter
    if (globalOnly) {
      query = query.is('owner_id', null)
    } else if (userOnly && ownerId) {
      query = query.eq('owner_id', ownerId)
    } else if (ownerId) {
      query = query.or(`owner_id.eq.${ownerId},owner_id.is.null`)
    }
    
    const { data, error } = await query.limit(5)
    
    if (!error && data) {
      // Check for close title matches
      for (const paper of data) {
        const paperTitle = paper.title.toLowerCase()
          .replace(/[^\w\s]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
        
        // Simple similarity check - if 90% of words match
        const titleWords = normalizedTitle.split(' ')
        const paperWords = paperTitle.split(' ')
        const commonWords = titleWords.filter(word => paperWords.includes(word))
        
        if (commonWords.length / titleWords.length > 0.9) {
          return { exists: true, paperId: paper.id, isGlobal: paper.owner_id === null }
        }
      }
    }
  }
  
  return { exists: false }
}

/**
 * Update citation fields for a paper
 */
export async function updatePaperCitationFields(
  paperId: string,
  citationData: {
    volume?: string
    issue?: string
    page?: string
    publisher?: string
    isbn?: string
    issn?: string
  }
): Promise<void> {
  // Use service client to bypass RLS - papers table requires authenticated users
  const supabase = getServiceClient()
  
  const { error } = await supabase
    .from('papers')
    .update({
      volume: citationData.volume || null,
      issue: citationData.issue || null,
      page_range: citationData.page || null,
      publisher: citationData.publisher || null,
      isbn: citationData.isbn || null,
      issn: citationData.issn || null
    })
    .eq('id', paperId)

  if (error) {
    throw new Error(`Failed to update paper citation fields: ${error.message}`)
  }

  debug({ paperId, fields: Object.keys(citationData) }, 'Updated paper citation fields')
}
