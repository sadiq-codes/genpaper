import { getSB } from '@/lib/supabase/server'
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
  const supabase = await getSB()
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

  const supabase = await getSB()
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
  const supabase = await getSB()
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
        relevance_score: 0.5, // Default relevance score for fallback
        semantic_score: 0.0,
        keyword_score: 0.5
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
    debug('No papers passed relevance threshold, trying relaxed approach')
    
    // Try again with a slightly relaxed threshold (0.15 instead of 0.3)
    // This catches papers that may be relevant but have lower embedding similarity
    // Important: We don't fall back to ANY positive score as that returns irrelevant papers
    const RELAXED_RELEVANCE_SCORE = 0.15
    
    const relaxedResults = (searchResults || []).filter(
      (result: HybridSearchResult) => 
        !excludePaperIds.includes(result.id) &&
        result.combined_score >= RELAXED_RELEVANCE_SCORE
    )
    
    debug({ count: relaxedResults.length, threshold: RELAXED_RELEVANCE_SCORE }, 'Relaxed filtering results')
    
    if (relaxedResults.length === 0) {
      debug('No papers found even with relaxed threshold - query may have no relevant papers in database')
      return []
    }
    
    // Use the relaxed results instead
    const topPermissiveResults = relaxedResults.slice(0, limit)

    const permissiveIds = topPermissiveResults.map((r: HybridSearchResult) => r.id).filter(isValidUuid)
    if (permissiveIds.length === 0) {
      debug('No valid UUIDs in permissive results')
      return []
    }

    let papersQuery = supabase
      .from('papers')
      .select(`
        *,
        authors:paper_authors(
          ordinal,
          author:authors(*)
        )
      `)
      .in('id', permissiveIds)

    // Apply source filter if provided
    if (sources && sources.length > 0) {
      papersQuery = papersQuery.in('source', sources)
    }

    const { data: papers, error: papersError } = await papersQuery

    if (papersError) {
      logError({ error: papersError }, 'Failed to fetch paper details')
      throw papersError
    }

    // Transform and sort by hybrid score
    const paperMap = new Map(papers?.map(p => [p.id, p]) || [])
    
    const finalResults = topPermissiveResults
      .map((result: HybridSearchResult) => {
        const paper = paperMap.get(result.id)
        if (!paper) {
          debug({ paperId: result.id }, 'Paper not found in detailed results')
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

    info({ count: finalResults.length }, 'Hybrid search completed (permissive)')
    return finalResults
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
  const supabase = await getSB()
  
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
  const supabase = await getSB()
  
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
 * @returns Result with paper ID and processing status
 */
export async function ingestPaper(
  paperData: PaperDTO,
  options: { fullText?: string; pdfUrl?: string; background?: boolean; priority?: 'low' | 'normal' | 'high' } = {}
): Promise<{ paperId: string; isNew: boolean; status: 'metadata_only' | 'processed' | 'queued' }> {
  
  // 1. Check for duplicates (idempotent)
  const { exists, paperId: existingId } = await checkPaperExists(paperData.doi, paperData.title)
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

  // 2. Create the basic paper metadata record
  const newPaperId = await createPaperMetadata(paperData)
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

  // Embedding is now generated during createPaperMetadata, so we're done
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
 * NOTE: Uses service role client to bypass RLS (papers are shared resources)
 */
export async function createPaperMetadata(paperData: PaperDTO): Promise<string> {
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
  
  // Insert paper metadata with embedding and authors
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
      metadata: Object.keys(metadata).length > 0 ? metadata : null // Store bibliographic fields
    })
    .select('id')
    .single()
  
  if (error) throw error
  if (!data) throw new Error('Failed to create paper - no ID returned')
  
  const paperId = data.id
  
  // Authors are now stored directly in the JSONB column during insert
  // No separate author handling needed
  
  return paperId
}


/**
 * Process content immediately (synchronous)
 */
async function processContentImmediately(paperId: string, fullText: string): Promise<void> {
  // Use the new content ingestion system
  await createChunksForPaper(paperId, fullText)
}

/**
 * Queue PDF processing
 */
async function queuePdfProcessing(paperId: string, pdfUrl: string, _title: string, _priority: 'low' | 'normal' | 'high'): Promise<void> {
  // Direct processing via unified helper (no background queue)
  const { getOrExtractFullText } = await import('@/lib/services/pdf-processor')
  const text = await getOrExtractFullText({ pdfUrl, paperId, ocr: true, timeoutMs: 60000 })
  if (text && text.length > 100) {
    await processContentImmediately(paperId, text)
  }
}

// Author management functions removed - authors are now stored as JSONB arrays

// Check if paper exists by DOI to prevent duplicates
export async function checkPaperExists(doi?: string, title?: string): Promise<{ exists: boolean, paperId?: string }> {
  const supabase = await getSB()
  
  // First check by DOI if available
  if (doi) {
    const { data, error } = await supabase
      .from('papers')
      .select('id')
      .eq('doi', doi)
      .single()
    
    if (!error && data) {
      return { exists: true, paperId: data.id }
    }
  }
  
  // Fallback: check by normalized title for papers without DOI
  if (title) {
    const normalizedTitle = title.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    
    const { data, error } = await supabase
      .from('papers')
      .select('id, title')
      .ilike('title', `%${normalizedTitle}%`)
      .limit(5)
    
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
          return { exists: true, paperId: paper.id }
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
  const supabase = await getSB()
  
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
