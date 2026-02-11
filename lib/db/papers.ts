import { getServiceClient } from '@/lib/supabase/service'
import type { PaperWithAuthors } from '@/types/simplified'
import { generateEmbeddings } from '@/lib/utils/embedding'
import { PaperDTO } from '@/lib/schemas/paper'
import { debug, info, warn, error as logError } from '@/lib/utils/logger'
import { expandWithStems } from '@/lib/utils/stemmer'
import { searchChunks as qdrantSearchChunks, isQdrantConfigured } from '@/lib/qdrant/client'
 

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

  // Hybrid search: Qdrant for vector + Supabase for keyword
  const MIN_RELEVANCE_SCORE = 0.3
  
  // 1. Vector search via Qdrant (if configured)
  let vectorResults: Array<{ id: string; score: number; title: string }> = []
  
  if (isQdrantConfigured()) {
    try {
      const [queryEmbedding] = await generateEmbeddings([query])
      debug({ dimensions: queryEmbedding.length }, 'Query embedding generated')
      
      const { searchPapers } = await import('@/lib/qdrant/client')
      vectorResults = await searchPapers(queryEmbedding, {
        limit: limit * 3, // Over-fetch for filtering
        minScore: MIN_RELEVANCE_SCORE,
      })
      debug({ count: vectorResults.length }, 'Qdrant vector search completed')
    } catch (err) {
      warn({ error: err }, 'Qdrant vector search failed')
    }
  } else {
    warn({}, 'Qdrant not configured - using keyword search only')
  }
  
  // 2. Keyword search via Supabase (text matching, no embeddings needed)
  const queryWords = query.toLowerCase().split(/\s+/).filter(word => word.length > 2)
  const expandedWords = expandWithStems(queryWords)
  
  const { data: keywordResults, error: keywordError } = await supabase
    .from('papers')
    .select('id, title, citation_count')
    .or(expandedWords.map(word => `title.ilike.%${word}%,abstract.ilike.%${word}%`).join(','))
    .gte('publication_date', `${minYear}-01-01`)
    .order('citation_count', { ascending: false })
    .limit(limit * 2)
  
  if (keywordError) {
    debug({ error: keywordError }, 'Keyword search failed')
  }
  
  debug({ count: keywordResults?.length || 0 }, 'Keyword search completed')
  
  // 3. Merge and score results
  const scoreMap = new Map<string, { semantic_score: number; keyword_score: number; combined_score: number }>()
  
  // Add vector results with semantic scores
  for (const result of vectorResults) {
    if (excludePaperIds.includes(result.id)) continue
    scoreMap.set(result.id, {
      semantic_score: result.score,
      keyword_score: 0,
      combined_score: result.score * semanticWeight
    })
  }
  
  // Add/merge keyword results
  const keywordWeight = 1 - semanticWeight
  const maxKeywordScore = 0.5 // Normalize keyword matches to max 0.5
  
  for (const result of (keywordResults || [])) {
    if (excludePaperIds.includes(result.id)) continue
    
    const existing = scoreMap.get(result.id)
    const keywordScore = maxKeywordScore // Simple binary match score
    
    if (existing) {
      // Paper found in both - combine scores
      existing.keyword_score = keywordScore
      existing.combined_score = (existing.semantic_score * semanticWeight) + (keywordScore * keywordWeight)
    } else {
      // Keyword-only result
      scoreMap.set(result.id, {
        semantic_score: 0,
        keyword_score: keywordScore,
        combined_score: keywordScore * keywordWeight
      })
    }
  }
  
  // 4. Filter and sort by combined score
  const rankedResults = Array.from(scoreMap.entries())
    .map(([id, scores]) => ({ id, ...scores }))
    .filter(r => r.combined_score >= MIN_RELEVANCE_SCORE)
    .sort((a, b) => b.combined_score - a.combined_score)
    .slice(0, limit)
  
  debug({ beforeFilter: scoreMap.size, afterFilter: rankedResults.length }, 'Filtered and ranked results')
  
  if (rankedResults.length === 0) {
    debug('No papers passed relevance threshold - returning empty results')
    return []
  }
  
  // 5. Get full paper details
  const topIds = rankedResults.map(r => r.id).filter(isValidUuid)
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

  // Transform and sort by combined score
  const paperMap = new Map(papers?.map(p => [p.id, p]) || [])
  
  const finalResults = rankedResults
    .map((result) => {
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

  info({ count: finalResults.length }, 'Hybrid search completed')
  return finalResults
}

export async function findSimilarPapers(
  paperId: string,
  limit = 5
): Promise<PaperWithAuthors[]> {
  const supabase = getServiceClient()
  
  // Qdrant only - no pgvector fallback
  if (!isQdrantConfigured()) {
    warn({}, 'Qdrant not configured - cannot find similar papers')
    return []
  }
  
  // 1. Get the reference paper's title and abstract to generate embedding
  const { data: referencePaper, error: refError } = await supabase
    .from('papers')
    .select('title, abstract')
    .eq('id', paperId)
    .single()
  
  if (refError) throw refError
  if (!referencePaper) {
    throw new Error('Reference paper not found')
  }
  
  // 2. Generate embedding from title + abstract
  const textToEmbed = `${referencePaper.title}\n${referencePaper.abstract || ''}`
  const [embedding] = await generateEmbeddings([textToEmbed])
  
  // 3. Search Qdrant for similar papers
  const { searchPapers } = await import('@/lib/qdrant/client')
  
  try {
    const matches = await searchPapers(embedding, {
      limit: limit + 1, // +1 to account for excluding self
      minScore: 0.3,
    })
    
    // Filter out the reference paper itself
    const filteredMatches = matches.filter(m => m.id !== paperId).slice(0, limit)
    
    if (filteredMatches.length === 0) return []
    
    // 4. Get full paper details from Supabase
    const { data: papers, error: papersError } = await supabase
      .from('papers')
      .select(`
        *,
        authors
      `)
      .in('id', filteredMatches.map(m => m.id))
    
    if (papersError) throw papersError
    
    // Transform and sort by similarity score
    const paperMap = new Map(papers?.map(p => [p.id, p]) || [])
    
    return filteredMatches
      .map(match => {
        const paper = paperMap.get(match.id)
        if (!paper) return null
        
        const transformedPaper = transformDatabasePaper(paper as DatabasePaper)
        
        return {
          ...transformedPaper,
          relevance_score: match.score
        }
      })
      .filter(Boolean) as PaperWithAuthors[]
  } catch (err) {
    logError({ error: err }, 'Qdrant similar papers search failed')
    return []
  }
}

export async function searchPaperChunks(
  query: string,
  options: {
    paperIds?: string[]
    limit?: number
    minScore?: number
  } = {}
): Promise<Array<{paper_id: string, content: string, score: number}>> {
  const {
    paperIds,
    limit = 50,
    minScore = 0.1
  } = options

  // Qdrant only - no pgvector fallback (embeddings are only in Qdrant)
  if (!isQdrantConfigured()) {
    warn({}, 'Qdrant not configured - cannot search paper chunks')
    return []
  }

  // Generate embedding for the query
  const [queryEmbedding] = await generateEmbeddings([query])

  try {
    const qdrantResults = await qdrantSearchChunks(queryEmbedding, {
      limit,
      minScore,
      paperIds: paperIds && paperIds.length > 0 ? paperIds : undefined,
    })
    return qdrantResults.map(r => ({
      paper_id: r.paper_id,
      content: r.content,
      score: r.score,
    }))
  } catch (qdrantErr) {
    logError({ error: qdrantErr }, 'Qdrant chunk search failed')
    return []
  }
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
  
  // Store bibliographic and extended fields in metadata JSONB column
  const metadata: Record<string, unknown> = {}
  // Bibliographic fields (for citation generation)
  if (paperData.volume) metadata.volume = paperData.volume
  if (paperData.issue) metadata.issue = paperData.issue
  if (paperData.pages) metadata.pages = paperData.pages
  if (paperData.publisher) metadata.publisher = paperData.publisher
  // Extended metadata
  if (paperData.paper_type) metadata.paper_type = paperData.paper_type
  if (paperData.keywords?.length) metadata.keywords = paperData.keywords
  if (paperData.fields_of_study?.length) metadata.fields_of_study = paperData.fields_of_study
  if (paperData.tldr) metadata.tldr = paperData.tldr
  if (paperData.is_open_access !== undefined) metadata.is_open_access = paperData.is_open_access
  if (paperData.open_access_status) metadata.open_access_status = paperData.open_access_status
  if (paperData.license) metadata.license = paperData.license
  if (paperData.influential_citation_count) metadata.influential_citation_count = paperData.influential_citation_count
  if (paperData.references_count) metadata.references_count = paperData.references_count
  if (paperData.is_retracted) metadata.is_retracted = paperData.is_retracted
  if (paperData.external_ids && Object.keys(paperData.external_ids).length > 0) metadata.external_ids = paperData.external_ids
  if (paperData.language) metadata.language = paperData.language
  
  // Insert paper metadata WITHOUT embedding (embeddings are stored in Qdrant only)
  // The papers.embedding column is nullable per migration 20260208000000
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
      // embedding: null - column is nullable, embeddings go to Qdrant only
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
  
  // Generate embedding from title + abstract for Qdrant
  const text = `${paperData.title}\n${paperData.abstract || ''}`
  const [embedding] = await generateEmbeddings([text])
  
  // Upsert paper embedding to Qdrant (for paper-level similarity search)
  try {
    const { upsertPaper, isQdrantConfigured } = await import('@/lib/qdrant/client')
    if (isQdrantConfigured()) {
      await upsertPaper(paperId, embedding, {
        title: paperData.title,
        doi: paperData.doi,
      })
      debug({ paperId }, 'Upserted paper embedding to Qdrant')
    }
  } catch (qdrantErr) {
    // Non-fatal - paper is still usable without embedding
    warn({ paperId, error: qdrantErr }, 'Failed to upsert paper embedding to Qdrant')
  }
  
  // Seed an abstract chunk so RAG works immediately (before PDF processing).
  // When PDF processing completes, createChunksForPaper will replace this with
  // full-text chunks (it deletes existing chunks before writing new ones).
  const abstractText = paperData.abstract?.trim()
  if (abstractText && abstractText.length > 30) {
    try {
      const { createDeterministicChunkId } = await import('@/lib/utils/deterministic-id')
      const { upsertChunks, isQdrantConfigured } = await import('@/lib/qdrant/client')
      const chunkId = createDeterministicChunkId(paperId, abstractText, 0)
      
      // Insert chunk to Supabase WITHOUT embedding (for content storage only)
      await supabase
        .from('paper_chunks')
        .upsert({
          id: chunkId,
          paper_id: paperId,
          chunk_index: 0,
          content: abstractText,
        }, {
          onConflict: 'id',
          ignoreDuplicates: true,
        })
      
      // Upsert chunk embedding to Qdrant (for vector search)
      if (isQdrantConfigured()) {
        await upsertChunks([{
          id: chunkId,
          paper_id: paperId,
          chunk_index: 0,
          content: abstractText,
          embedding,
        }])
      }
      
      debug({ paperId }, 'Seeded abstract chunk for immediate RAG')
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
