import { getSB } from '@/lib/supabase/server'
import { createBrowserClient } from '@supabase/ssr'
import type { Paper, Author, PaperWithAuthors, SearchPapersRequest } from '@/types/simplified'
import { ai } from '@/lib/ai/vercel-client'
import { embedMany } from 'ai'
import { v5 as uuidv5 } from 'uuid'
import { type PaperDTO } from '@/lib/schemas/paper'

// Namespace UUID for generating deterministic paper UUIDs
const PAPER_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

// Helper function to generate deterministic UUID for papers
export function generatePaperUUID(input: string): string {
  // Use UUID v5 for deterministic UUID generation based on input
  return uuidv5(input, PAPER_NAMESPACE)
}

// Centralized embedding configuration to ensure consistency
const EMBEDDING_CONFIG = {
  model: 'text-embedding-3-small' as const,
  dimensions: 384,
  maxTokens: 8192 // Fix: Add token limit for embedding model
} as const

// Fix: Fallback token estimation without tiktoken dependency
function estimateTokenCount(text: string): number {
  // Rough estimation: 1 token ≈ 4 characters for English text
  // This is less accurate than tiktoken but prevents WASM loading issues
  return Math.ceil(text.length / 4)
}

// Fix: Simplified tiktoken encoder with fallback
async function getTokenEncoder() {
  try {
    // Dynamic import to avoid loading WASM at startup
    const { encoding_for_model } = await import('@dqbd/tiktoken')
    return encoding_for_model(EMBEDDING_CONFIG.model)
  } catch (error) {
    console.warn('Tiktoken not available, using fallback token estimation:', error)
    return null
  }
}

// Fix: Smart chunk validation with simplified tiktoken usage
async function validateAndClampChunk(text: string, targetTokens: number = 500): Promise<string> {
  // First, do a quick estimate to avoid expensive operations
  const estimatedTokens = estimateTokenCount(text)
  
  // If estimate is within target, return as-is
  if (estimatedTokens <= targetTokens) {
    return text
  }
  
  // Try to get precise token count if available
  let actualTokens = estimatedTokens
  
  try {
    const encoder = await getTokenEncoder()
    if (encoder) {
      const tokens = encoder.encode(text)
      actualTokens = tokens.length
      
      // If within target size with precise counting, return as-is
      if (actualTokens <= targetTokens) {
        encoder.free()
        return text
      }
      
      // If exceeds model limit, perform emergency truncation with sentence boundaries
      if (actualTokens > EMBEDDING_CONFIG.maxTokens) {
        const safeTokens = Array.from(tokens).slice(0, EMBEDDING_CONFIG.maxTokens - 10) // Leave margin
        const safeUint32Array = new Uint32Array(safeTokens)
        const truncatedText = new TextDecoder().decode(encoder.decode(safeUint32Array))
        encoder.free()
        
        // Try to preserve sentence boundaries
        const sentences = truncatedText.split(/[.!?]\s+/)
        if (sentences.length > 1) {
          sentences.pop() // Remove potentially incomplete last sentence
          return sentences.join('. ') + '.'
        }
        
        return truncatedText
      }
      
      encoder.free()
    }
  } catch (error) {
    console.warn('Token counting failed, using character-based fallback:', error)
  }
  
  // Fallback to character-based truncation with sentence preservation
  if (estimatedTokens > EMBEDDING_CONFIG.maxTokens) {
    const maxChars = EMBEDDING_CONFIG.maxTokens * 4 // Conservative estimate
    const truncated = text.substring(0, maxChars)
    
    // Try to preserve sentence boundaries
    const sentences = truncated.split(/[.!?]\s+/)
    if (sentences.length > 1) {
      sentences.pop()
      return sentences.join('. ') + '.'
    }
    
    return truncated
  }
  
  return text
}

// Fix: Enhanced chunk processing with error tracking
interface ChunkProcessingResult {
  success: boolean
  chunkIndex: number
  error?: string
}

// Fix: Batch chunk processing with error handling and async token validation
async function processChunkBatch(
  paperId: string,
  chunks: Array<{ content: string; index: number }>,
  retryAttempt: number = 0
): Promise<ChunkProcessingResult[]> {
  const supabase = await getSB()
  const results: ChunkProcessingResult[] = []
  
  try {
    // Validate and clamp chunks for token limits (now async)
    const validatedChunks = await Promise.all(
      chunks.map(async (chunk) => ({
        ...chunk,
        content: await validateAndClampChunk(chunk.content)
      }))
    )
    
    // Generate embeddings for batch
    const chunkTexts = validatedChunks.map(chunk => chunk.content)
    const chunkEmbeddings = await generateEmbeddings(chunkTexts)
    
    // Prepare chunk records
    const chunkRecords = validatedChunks.map((chunk, batchIndex) => ({
      paper_id: paperId,
      chunk_index: chunk.index,
      content: chunk.content,
      embedding: chunkEmbeddings[batchIndex],
      processing_status: 'completed',
      error_count: retryAttempt
    }))
    
    // Insert chunks with improved error handling
    const { error: chunksError } = await supabase
      .from('paper_chunks')
      .upsert(chunkRecords, {
        onConflict: 'paper_id,chunk_index',
        ignoreDuplicates: false
      })
    
    if (chunksError) {
      throw new Error(`Chunk insertion failed: ${chunksError.message}`)
    }
    
    // Mark all chunks as successful
    chunks.forEach(chunk => {
      results.push({ success: true, chunkIndex: chunk.index })
    })
    
  } catch (error) {
    console.error(`Chunk batch processing failed (attempt ${retryAttempt + 1}):`, error)
    
    // Mark all chunks in batch as failed and track them
    for (const chunk of chunks) {
      results.push({ 
        success: false, 
        chunkIndex: chunk.index,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      
      // Insert into failed_chunks table for retry
      try {
        await supabase
          .from('failed_chunks')
          .upsert({
            paper_id: paperId,
            chunk_index: chunk.index,
            content: chunk.content,
            error_message: error instanceof Error ? error.message : 'Unknown error',
            error_count: retryAttempt + 1,
            last_attempt_at: new Date().toISOString()
          }, {
            onConflict: 'paper_id,chunk_index',
            ignoreDuplicates: false
          })
      } catch (trackingError) {
        console.error('Failed to track failed chunk:', trackingError)
      }
    }
  }
  
  return results
}

// Type definitions for database query results
interface PaperAuthorRelation {
  ordinal: number
  author: Author
}

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
  impact_score?: number
  created_at: string
  authors: PaperAuthorRelation[]
}

// Browser-side client
export const createBrowserSupabaseClient = () => {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export async function createOrGetAuthor(name: string): Promise<Author> {
  const supabase = await getSB()
  // First try to get existing author
  const { data: existingAuthor } = await supabase
    .from('authors')
    .select('*')
    .eq('name', name)
    .single()

  if (existingAuthor) return existingAuthor

  // Create new author if doesn't exist
  const { data, error } = await supabase
    .from('authors')
    .insert({ name })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function createPaper(
  paperData: Omit<Paper, 'id' | 'created_at'>,
  authorNames: string[]
): Promise<PaperWithAuthors> {
  const supabase = await getSB()
  // Create the paper first
  const { data: paper, error: paperError } = await supabase
    .from('papers')
    .insert({
      title: paperData.title,
      abstract: paperData.abstract,
      publication_date: paperData.publication_date,
      venue: paperData.venue,
      doi: paperData.doi,
      url: paperData.url,
      pdf_url: paperData.pdf_url,
      metadata: paperData.metadata,
      source: paperData.source,
      citation_count: paperData.citation_count,
      impact_score: paperData.impact_score
    })
    .select()
    .single()

  if (paperError) throw paperError

  // Create or get authors and link them to the paper
  const authors: Author[] = []
  for (let i = 0; i < authorNames.length; i++) {
    const author = await createOrGetAuthor(authorNames[i])
    authors.push(author)

    // Link author to paper with ordinal
    await supabase
      .from('paper_authors')
      .insert({
        paper_id: paper.id,
        author_id: author.id,
        ordinal: i + 1
      })
  }

  return {
    ...paper,
    authors,
    author_names: authorNames
  }
}

// Helper function to transform database papers to app format
function transformDatabasePaper(dbPaper: DatabasePaper): PaperWithAuthors {
  const authors = dbPaper.authors
    ?.sort((a: PaperAuthorRelation, b: PaperAuthorRelation) => a.ordinal - b.ordinal)
    ?.map((pa: PaperAuthorRelation) => pa.author) || []

  return {
    ...dbPaper,
    authors,
    author_names: authors.map((a: Author) => a.name)
  }
}

export async function getPaper(paperId: string): Promise<PaperWithAuthors | null> {
  const supabase = await getSB()
  const { data, error } = await supabase
    .from('papers')
    .select(`
      *,
      authors:paper_authors(
        ordinal,
        author:authors(*)
      )
    `)
    .eq('id', paperId)
    .single()

  if (error && error.code !== 'PGRST116') throw error
  if (!data) return null

  return transformDatabasePaper(data as DatabasePaper)
}

export async function searchPapers(
  query: string,
  filters: { sources?: string[] } = {},
  limit = 20,
  offset = 0
): Promise<PaperWithAuthors[]> {
  const supabase = await getSB()
  let supabaseQuery = supabase
    .from('papers')
    .select(`
      *,
      authors:paper_authors(
        ordinal,
        author:authors(*)
      )
    `)

  if (query) {
    // Full-text search on title and abstract
    supabaseQuery = supabaseQuery.textSearch('search_vector', query)
  }

  if (filters.sources && filters.sources.length > 0) {
    supabaseQuery = supabaseQuery.in('source', filters.sources)
  }

  const { data, error } = await supabaseQuery
    .order('citation_count', { ascending: false, nullsFirst: false })
    .order('publication_date', { ascending: false, nullsFirst: false })
    .limit(limit)
    .range(offset, offset + limit - 1)

  if (error) throw error

  // Transform the data to include authors
  return (data || []).map((paper: DatabasePaper) => transformDatabasePaper(paper))
}

export async function getPaperByDOI(doi: string): Promise<Paper | null> {
  const supabase = await getSB()
  const { data, error } = await supabase
    .from('papers')
    .select(`
      *,
      authors:paper_authors(
        ordinal,
        author:authors(*)
      )
    `)
    .eq('doi', doi)
    .single()

  if (error && error.code !== 'PGRST116') throw error
  if (!data) return null

  return transformDatabasePaper(data as DatabasePaper)
}

export async function updatePaperMetadata(
  paperId: string,
  metadata: Partial<Paper>
): Promise<void> {
  const supabase = await getSB()
  const { error } = await supabase
    .from('papers')
    .update(metadata)
    .eq('id', paperId)

  if (error) throw error
}

export async function getPopularPapers(limit = 10): Promise<Paper[]> {
  const supabase = await getSB()
  const { data, error } = await supabase
    .from('papers')
    .select(`
      *,
      authors:paper_authors(
        ordinal,
        author:authors(*)
      )
    `)
    .order('citation_count', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) throw error

  return (data || []).map((paper: DatabasePaper) => transformDatabasePaper(paper))
}

export async function getRecentPapers(
  limit = 10
): Promise<PaperWithAuthors[]> {
  const supabase = await getSB()
  const { data, error } = await supabase
    .from('papers')
    .select(`
      *,
      authors:paper_authors(
        ordinal,
        author:authors(*)
      )
    `)
    .order('publication_date', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) throw error

  return (data || []).map((paper: DatabasePaper) => transformDatabasePaper(paper))
}

// Browser client class for client-side operations
export class BrowserPapersClient {
  private supabase = createBrowserSupabaseClient()

  async searchPapers(searchParams: SearchPapersRequest) {
    let query = this.supabase
      .from('papers')
      .select(`
        *,
        authors:paper_authors(
          ordinal,
          author:authors(*)
        )
      `)

    if (searchParams.query) {
      query = query.textSearch('search_vector', searchParams.query)
    }

    if (searchParams.sources?.length) {
      query = query.in('source', searchParams.sources)
    }

    const { data, error } = await query
      .order('citation_count', { ascending: false, nullsFirst: false })
      .limit(searchParams.limit || 20)

    if (error) throw error

    return (data || []).map((paper: DatabasePaper) => transformDatabasePaper(paper))
  }

  async getPaper(paperId: string) {
    const { data, error } = await this.supabase
      .from('papers')
      .select(`
        *,
        authors:paper_authors(
          ordinal,
          author:authors(*)
        )
      `)
      .eq('id', paperId)
      .single()

    if (error && error.code !== 'PGRST116') throw error
    if (!data) return null

    return transformDatabasePaper(data as DatabasePaper)
  }

  async getPopularPapers(limit = 10) {
    const { data, error } = await this.supabase
      .from('papers')
      .select(`
        *,
        authors:paper_authors(
          ordinal,
          author:authors(*)
        )
      `)
      .order('citation_count', { ascending: false, nullsFirst: false })
      .limit(limit)

    if (error) throw error

    return (data || []).map((paper: DatabasePaper) => transformDatabasePaper(paper))
  }
}

// Fix: Add vector index optimization with better error handling
async function optimizeVectorIndex(): Promise<void> {
  try {
    const supabase = await getSB()
    // Call the optimize function if available
    await supabase.rpc('optimize_vector_index')
  } catch (error) {
    // Log but don't fail - optimization is not critical
    console.warn('Vector index optimization failed:', error)
  }
}

export async function ingestPaper(paperMeta: PaperDTO): Promise<string> {
  const supabase = await getSB()
  
  // Create text for embedding (title + abstract)
  const text = `${paperMeta.title}\n${paperMeta.abstract || ''}`
  
  // Generate embedding using centralized configuration
  const [embedding] = await generateEmbeddings([text])
  
  // Create deterministic UUID from DOI or content
  const paperId = paperMeta.doi 
    ? generatePaperUUID(paperMeta.doi)
    : generatePaperUUID(text)
  
  // Upsert paper with embedding
  const { error } = await supabase
    .from('papers')
    .upsert({
      id: paperId,
      title: paperMeta.title,
      abstract: paperMeta.abstract,
      publication_date: paperMeta.publication_date,
      venue: paperMeta.venue,
      doi: paperMeta.doi,
      url: paperMeta.url,
      pdf_url: paperMeta.pdf_url,
      metadata: paperMeta.metadata,
      source: paperMeta.source || 'unknown',
      citation_count: paperMeta.citation_count || 0,
      impact_score: Math.max(paperMeta.impact_score || 0, 0),
      embedding: embedding
    })
  
  if (error) throw error
  
  // Handle authors efficiently with batch operations
  if (paperMeta.authors && paperMeta.authors.length > 0) {
    await upsertPaperAuthors(paperId, paperMeta.authors)
  }
  
  return paperId
}

// Generate embeddings with consistent configuration
async function generateEmbeddings(inputs: string | string[]): Promise<number[][]> {
  // Convert single input to array for consistent processing
  const inputArray = Array.isArray(inputs) ? inputs : [inputs]
  
  // Use AI SDK embedMany for batch processing with proper dimensions
  const { embeddings } = await embedMany({
    model: ai.embedding(EMBEDDING_CONFIG.model, {
      dimensions: EMBEDDING_CONFIG.dimensions
    }),
    values: inputArray,
    maxRetries: 3 // Built-in retry logic
  })
  
  return embeddings
}

// Batch ingest function for processing multiple papers efficiently
export async function batchIngestPapers(papers: PaperDTO[]): Promise<string[]> {
  const BATCH_SIZE = 100 // OpenAI embeddings batch limit
  const paperIds: string[] = []
  
  // Process papers in batches for embedding generation
  for (let i = 0; i < papers.length; i += BATCH_SIZE) {
    const batch = papers.slice(i, i + BATCH_SIZE)
    
    // Prepare texts for embedding
    const texts = batch.map(paper => `${paper.title}\n${paper.abstract || ''}`)
    
    // Generate embeddings in batch with consistent dimensions
    const embeddings = await generateEmbeddings(texts)
    
    // Process each paper in the batch
    for (let j = 0; j < batch.length; j++) {
      const paper = batch[j]
      const embedding = embeddings[j]
      
      const paperId = await ingestPaperWithEmbedding(paper, embedding)
      paperIds.push(paperId)
    }
  }
  
  // Optimize vector index after bulk insertion
  await optimizeVectorIndex()
  
  return paperIds
}

// Helper function to ingest paper with pre-generated embedding
async function ingestPaperWithEmbedding(paperMeta: PaperDTO, embedding: number[]): Promise<string> {
  const supabase = await getSB()
  
  const text = `${paperMeta.title}\n${paperMeta.abstract || ''}`
  const paperId = paperMeta.doi 
    ? generatePaperUUID(paperMeta.doi)
    : generatePaperUUID(text)
  
  // Upsert paper with embedding
  const { error } = await supabase
    .from('papers')
    .upsert({
      id: paperId,
      title: paperMeta.title,
      abstract: paperMeta.abstract,
      publication_date: paperMeta.publication_date,
      venue: paperMeta.venue,
      doi: paperMeta.doi,
      url: paperMeta.url,
      pdf_url: paperMeta.pdf_url,
      metadata: paperMeta.metadata,
      source: paperMeta.source || 'unknown',
      citation_count: paperMeta.citation_count || 0,
      impact_score: Math.max(paperMeta.impact_score || 0, 0),
      embedding: embedding
    })
  
  if (error) throw error
  
  // Handle authors efficiently with batch operations
  if (paperMeta.authors && paperMeta.authors.length > 0) {
    await upsertPaperAuthors(paperId, paperMeta.authors)
  }
  
  return paperId
}

// Task 3: Type definitions for RPC functions
interface MatchPapersResult {
  paper_id: string
  score: number
}

interface HybridSearchResult {
  paper_id: string
  semantic_score: number
  keyword_score: number
  combined_score: number
}

interface SimilarPapersResult {
  paper_id: string
  score: number
}

// Task 3: Semantic similarity search functions
export async function semanticSearchPapers(
  query: string,
  options: {
    limit?: number
    minYear?: number
    sources?: string[]
  } = {}
): Promise<PaperWithAuthors[]> {
  const supabase = await getSB()
  
  // Generate embedding for the query using centralized configuration
  const [queryEmbedding] = await generateEmbeddings([query])
  
  // Call the match_papers RPC function
  const { data: matches, error } = await supabase
    .rpc('match_papers', {
      query_embedding: queryEmbedding,
      match_count: options.limit || 8,
      min_year: options.minYear || 2018
    })
  
  if (error) throw error
  if (!matches || matches.length === 0) return []
  
  // Get full paper details with authors
  let papersQuery = supabase
    .from('papers')
    .select(`
      *,
      authors:paper_authors(
        ordinal,
        author:authors(*)
      )
    `)
    .in('id', (matches as MatchPapersResult[]).map(m => m.paper_id))
  
  // Apply source filter if provided
  if (options.sources && options.sources.length > 0) {
    papersQuery = papersQuery.in('source', options.sources)
  }
  
  const { data: papers, error: papersError } = await papersQuery
  
  if (papersError) throw papersError
  
  // Transform and sort by similarity score
  const paperMap = new Map(papers?.map(p => [p.id, p]) || [])
  
  return (matches as MatchPapersResult[])
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
    minYear = 2018, 
    sources, 
    semanticWeight = 0.7,
    excludePaperIds = [],
    maxYear = 2024
  } = options

  console.log(`🔍 Hybrid Search Starting:`)
  console.log(`   🎯 Query: "${query}"`)
  console.log(`   📊 Limit: ${limit}`)
  console.log(`   📅 Min Year: ${minYear}`)
  console.log(`   📅 Max Year: ${maxYear}`)
  console.log(`   🏷️ Sources Filter: ${sources ? `[${sources.join(', ')}]` : 'None'}`)
  console.log(`   ⚖️ Semantic Weight: ${semanticWeight}`)
  console.log(`   🚫 Excluded IDs: ${excludePaperIds.length > 0 ? `[${excludePaperIds.join(', ')}]` : 'None'}`)

  // 1. Generate embedding for the query using centralized configuration
  console.log(`🧠 Generating embedding for query...`)
  const [queryEmbedding] = await generateEmbeddings([query])
  console.log(`✅ Embedding generated: ${queryEmbedding.length} dimensions`)

  // 2. Call the hybrid search RPC function
  console.log(`🗄️ Calling hybrid_search_papers RPC...`)
  const { data: searchResults, error } = await supabase
    .rpc('hybrid_search_papers', {
      query_text: query,
      query_embedding: queryEmbedding,
      match_count: limit * 2, // Get more results to account for filtering
      min_year: minYear,
      semantic_weight: semanticWeight
    })

  if (error) {
    console.error(`❌ RPC search failed:`, error)
    throw error
  }

  console.log(`📋 RPC returned ${searchResults?.length || 0} initial results`)
  if (searchResults && searchResults.length > 0) {
    searchResults.slice(0, 5).forEach((result: HybridSearchResult, idx: number) => {
      console.log(`   ${idx + 1}. Paper ID: ${result.paper_id}`)
      console.log(`      Combined Score: ${result.combined_score}`)
      console.log(`      Semantic Score: ${result.semantic_score}`)
      console.log(`      Keyword Score: ${result.keyword_score}`)
    })
    if (searchResults.length > 5) {
      console.log(`   ... and ${searchResults.length - 5} more results`)
    }
  }

  // 3. Filter out excluded papers
  const filteredResults = (searchResults || []).filter(
    (result: HybridSearchResult) => 
      !excludePaperIds.includes(result.paper_id) &&
      result.combined_score >= 0.0001 // Apply minimum score threshold
  )

  console.log(`🔧 After filtering excluded papers: ${filteredResults.length} results`)
  if (filteredResults.length !== (searchResults?.length || 0)) {
    const excludedCount = (searchResults?.length || 0) - filteredResults.length
    console.log(`   🚫 Excluded ${excludedCount} papers from previous searches`)
  }

  // 4. Get full paper details for the top results
  if (filteredResults.length === 0) {
    console.warn(`⚠️ No papers found after filtering`)
    return []
  }

  const topResults = filteredResults.slice(0, limit)
  console.log(`📄 Fetching full details for top ${topResults.length} papers...`)
  
  let papersQuery = supabase
    .from('papers')
    .select(`
      *,
      authors:paper_authors(
        ordinal,
        author:authors(*)
      )
    `)
    .in('id', topResults.map((r: HybridSearchResult) => r.paper_id))

  // Apply source filter if provided
  if (sources && sources.length > 0) {
    papersQuery = papersQuery.in('source', sources)
    console.log(`🏷️ Applied source filter: [${sources.join(', ')}]`)
  }

  const { data: papers, error: papersError } = await papersQuery

  if (papersError) {
    console.error(`❌ Failed to fetch paper details:`, papersError)
    throw papersError
  }

  console.log(`📚 Retrieved ${papers?.length || 0} full paper records`)

  // 5. Transform and sort by hybrid score
  const paperMap = new Map(papers?.map(p => [p.id, p]) || [])
  
  const finalResults = topResults
    .map((result: HybridSearchResult) => {
      const paper = paperMap.get(result.paper_id)
      if (!paper) {
        console.warn(`⚠️ Paper ${result.paper_id} not found in detailed results`)
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

  console.log(`✅ Hybrid search completed: ${finalResults.length} final papers`)
  finalResults.forEach((paper, idx) => {
    console.log(`   ${idx + 1}. "${paper.title}"`)
    console.log(`      Authors: ${paper.author_names?.join(', ') || 'Unknown'}`)
    console.log(`      Year: ${paper.publication_date ? new Date(paper.publication_date).getFullYear() : 'Unknown'}`)
    console.log(`      Venue: ${paper.venue || 'Unknown'}`)
    console.log(`      Relevance: ${(paper as { relevance_score?: number }).relevance_score?.toFixed(3) || 'N/A'}`)
    console.log(`      Source: ${paper.source}`)
  })

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
      authors:paper_authors(
        ordinal,
        author:authors(*)
      )
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

// Search paper chunks for RAG
export async function searchPaperChunks(
  query: string,
  options: {
    paperIds?: string[]
    limit?: number
    minScore?: number
  } = {}
): Promise<Array<{paper_id: string, content: string, score: number}>> {
  const supabase = await getSB()
  console.log(`📄 Searching paper chunks:`)
  console.log(`   🎯 Query: "${query}"`)
  console.log(`   📊 Limit: ${options.limit || 10}`)
  console.log(`   📋 Paper IDs: ${options.paperIds ? `[${options.paperIds.join(', ')}]` : 'All papers'}`)
  console.log(`   🎯 Min Score: ${options.minScore || 0.5}`)

  // Generate embedding for the query using centralized configuration
  console.log(`🧠 Generating embedding for chunk search...`)
  const [queryEmbedding] = await generateEmbeddings([query])
  console.log(`✅ Chunk search embedding generated: ${queryEmbedding.length} dimensions`)
  
  // Search chunks using cosine similarity
  console.log(`🗄️ Calling match_paper_chunks RPC...`)
  const { data: matches, error } = await supabase
    .rpc('match_paper_chunks', {
      query_embedding: queryEmbedding,
      match_count: options.limit || 10,
      min_score: options.minScore || 0.5
    })
  
  if (error) {
    console.error(`❌ Chunk search RPC failed:`, error)
    throw error
  }

  console.log(`📄 RPC returned ${matches?.length || 0} chunk matches`)
  
  // Filter by paper IDs if specified
  let finalMatches = matches || []
  if (options.paperIds && options.paperIds.length > 0) {
    const beforeFilter = finalMatches.length
    finalMatches = finalMatches.filter((match: { paper_id: string }) => 
      options.paperIds!.includes(match.paper_id)
    )
    console.log(`🔧 Filtered chunks by paper IDs: ${beforeFilter} → ${finalMatches.length}`)
  }

  console.log(`✅ Final chunk results: ${finalMatches.length}`)
  finalMatches.forEach((match: { paper_id: string; chunk_index: number; content: string; score: number }, idx: number) => {
    console.log(`   ${idx + 1}. Paper: ${match.paper_id}, Chunk: ${match.chunk_index}`)
    console.log(`      Score: ${match.score?.toFixed(3) || 'N/A'}`)
    console.log(`      Content: "${match.content.substring(0, 150)}..."`)
  })
  
  return finalMatches
}

// Fix: Enhanced ingest paper with chunks and comprehensive error handling
export async function ingestPaperWithChunks(
  paperMeta: PaperDTO, 
  contentChunks?: string[]
): Promise<string> {
  const supabase = await getSB()
  
  // Create main embedding from title + abstract (existing behavior)
  const mainText = `${paperMeta.title}\n${paperMeta.abstract || ''}`
  
  // Generate main embedding using centralized configuration
  const [mainEmbedding] = await generateEmbeddings([mainText])
  
  // Create deterministic UUID from DOI or content
  const paperId = paperMeta.doi 
    ? generatePaperUUID(paperMeta.doi)
    : generatePaperUUID(mainText)
  
  // Upsert main paper record with main embedding
  const { error } = await supabase
    .from('papers')
    .upsert({
      id: paperId,
      title: paperMeta.title,
      abstract: paperMeta.abstract,
      publication_date: paperMeta.publication_date,
      venue: paperMeta.venue,
      doi: paperMeta.doi,
      url: paperMeta.url,
      pdf_url: paperMeta.pdf_url,
      metadata: paperMeta.metadata,
      source: paperMeta.source || 'unknown',
      citation_count: paperMeta.citation_count || 0,
      impact_score: Math.max(paperMeta.impact_score || 0, 0),
      embedding: mainEmbedding
    })
  
  if (error) throw error
  
  // Handle authors efficiently with batch operations
  if (paperMeta.authors && paperMeta.authors.length > 0) {
    await upsertPaperAuthors(paperId, paperMeta.authors)
  }
  
  // Fix: Enhanced chunk processing with error tracking and retry mechanism
  if (contentChunks && contentChunks.length > 0) {
    console.log(`Processing ${contentChunks.length} chunks for paper ${paperId}`)
    
    // Remove existing chunks for this paper
    await supabase
      .from('paper_chunks')
      .delete()
      .eq('paper_id', paperId)
    
    // Clear any previous failed chunks for this paper
    await supabase
      .from('failed_chunks')
      .delete()
      .eq('paper_id', paperId)
    
    // Process chunks in batches with enhanced error handling
    const BATCH_SIZE = 50 // Smaller batches for better error isolation
    let totalSuccessful = 0
    let totalFailed = 0
    
    for (let i = 0; i < contentChunks.length; i += BATCH_SIZE) {
      const batch = contentChunks.slice(i, i + BATCH_SIZE)
      const batchChunks = batch.map((chunk, index) => ({
        content: chunk,
        index: i + index
      }))
      
      try {
        const results = await processChunkBatch(paperId, batchChunks)
        
        // Count successes and failures
        const successful = results.filter(r => r.success).length
        const failed = results.filter(r => !r.success).length
        
        totalSuccessful += successful
        totalFailed += failed
        
        console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${successful} successful, ${failed} failed`)
        
      } catch (batchError) {
        console.error(`Entire batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, batchError)
        totalFailed += batch.length
        
        // Track all chunks in failed batch
        for (const batchChunk of batchChunks) {
          try {
            await supabase
              .from('failed_chunks')
              .insert({
                paper_id: paperId,
                chunk_index: batchChunk.index,
                content: batchChunk.content,
                error_message: batchError instanceof Error ? batchError.message : 'Batch processing failed',
                error_count: 1,
                last_attempt_at: new Date().toISOString()
              })
          } catch (trackingError) {
            console.error('Failed to track failed chunk:', trackingError)
          }
        }
      }
    }
    
    console.log(`Chunk processing summary: ${totalSuccessful} successful, ${totalFailed} failed`)
    
    // Fix: Ensure paper exists with chunks before continuing
    if (totalSuccessful === 0 && totalFailed > 0) {
      console.warn(`Paper ${paperId} has no successfully processed chunks - marking for retry`)
      // Don't fail the entire operation, but log for monitoring
    }
    
    // Optimize vector index after chunk insertion (only if we have successful chunks)
    if (totalSuccessful > 0) {
      await optimizeVectorIndex()
    }
  }
  
  return paperId
}

// Fix: Retry failed chunks function
export async function retryFailedChunks(maxRetries: number = 100): Promise<{
  attempted: number
  successful: number
  failed: number
}> {
  const supabase = await getSB()
  
  // Get failed chunks ready for retry
  const { data: failedChunks, error } = await supabase
    .rpc('retry_failed_chunks')
    .limit(maxRetries)
  
  if (error) throw error
  if (!failedChunks || failedChunks.length === 0) {
    return { attempted: 0, successful: 0, failed: 0 }
  }
  
  console.log(`Retrying ${failedChunks.length} failed chunks`)
  
  // Group chunks by paper for batch processing
  const chunksByPaper = new Map<string, Array<{ content: string; index: number; retryCount: number }>>()
  
  for (const chunk of failedChunks) {
    const paperId = chunk.paper_id
    if (!chunksByPaper.has(paperId)) {
      chunksByPaper.set(paperId, [])
    }
    chunksByPaper.get(paperId)!.push({
      content: chunk.content,
      index: chunk.chunk_index,
      retryCount: chunk.retry_count
    })
  }
  
  let totalSuccessful = 0
  let totalFailed = 0
  
  // Process each paper's failed chunks
  for (const [paperId, chunks] of chunksByPaper) {
    try {
      const results = await processChunkBatch(paperId, chunks, chunks[0].retryCount)
      
      const successful = results.filter(r => r.success).length
      const failed = results.filter(r => !r.success).length
      
      totalSuccessful += successful
      totalFailed += failed
      
    } catch (error) {
      console.error(`Retry failed for paper ${paperId}:`, error)
      totalFailed += chunks.length
    }
  }
  
  // Clean up successful retries
  if (totalSuccessful > 0) {
    try {
      const cleaned = await supabase.rpc('cleanup_successful_chunks')
      console.log(`Cleaned up ${cleaned} successfully retried chunks`)
    } catch (error) {
      console.error('Failed to clean up successful chunks:', error)
    }
  }
  
  return {
    attempted: failedChunks.length,
    successful: totalSuccessful,
    failed: totalFailed
  }
}

// Optimized batch author creation to replace createOrGetAuthor loops
export async function batchCreateOrGetAuthors(authorNames: string[]): Promise<Author[]> {
  if (authorNames.length === 0) return []
  
  const supabase = await getSB()
  
  // 1. Fetch all existing authors in one query
  const { data: existingAuthors, error: fetchError } = await supabase
    .from('authors')
    .select('*')
    .in('name', authorNames)
  
  if (fetchError) throw fetchError
  
  // 2. Find which authors don't exist yet
  const existingNames = new Set(existingAuthors?.map(a => a.name) || [])
  const newAuthorNames = authorNames.filter(name => !existingNames.has(name))
  
  // 3. Insert new authors in batch with ON CONFLICT handling
  if (newAuthorNames.length > 0) {
    const { data: newAuthors, error: insertError } = await supabase
      .from('authors')
      .upsert(
        newAuthorNames.map(name => ({ name })),
        { onConflict: 'name', ignoreDuplicates: false }
      )
      .select()
    
    if (insertError) throw insertError
    
    // Combine existing and new authors
    const allAuthors = [...(existingAuthors || []), ...(newAuthors || [])]
    
    // Return in the same order as input with proper null checking
    return authorNames.map(name => {
      const author = allAuthors.find(author => author.name === name)
      if (!author) {
        throw new Error(`Author not found after creation: ${name}`)
      }
      return author
    })
  }
  
  // Return existing authors in input order with proper null checking
  return authorNames.map(name => {
    const author = existingAuthors?.find(author => author.name === name)
    if (!author) {
      throw new Error(`Author not found: ${name}`)
    }
    return author
  })
}

// Optimized paper-author relationship management
export async function upsertPaperAuthors(paperId: string, authorNames: string[]): Promise<void> {
  if (authorNames.length === 0) return
  
  const supabase = await getSB()
  
  // 1. Get all authors efficiently (using batch function)
  const authors = await batchCreateOrGetAuthors(authorNames)
  
  // 2. Get current author IDs for this paper
  const { data: currentRelations } = await supabase
    .from('paper_authors')
    .select('author_id')
    .eq('paper_id', paperId)
  
  const currentAuthorIds = new Set(currentRelations?.map(r => r.author_id) || [])
  const newAuthorIds = authors.map(a => a.id)
  
  // 3. Delete relationships that should no longer exist
  const authorsToRemove = [...currentAuthorIds].filter(id => !newAuthorIds.includes(id))
  if (authorsToRemove.length > 0) {
    await supabase
      .from('paper_authors')
      .delete()
      .eq('paper_id', paperId)
      .in('author_id', authorsToRemove)
  }
  
  // 4. Insert new relationships in batch
  const relationshipsToInsert = authors.map((author, index) => ({
    paper_id: paperId,
    author_id: author.id,
    ordinal: index + 1
  }))
  
  const { error } = await supabase
    .from('paper_authors')
    .upsert(relationshipsToInsert, {
      onConflict: 'paper_id,author_id',
      ignoreDuplicates: false
    })
  
  if (error) throw error
}

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

// Lightweight ingestion for Library Manager - no chunks, faster UX
export async function ingestPaperLightweight(paperMeta: PaperDTO): Promise<string> {
  const supabase = await getSB()
  
  // Check for duplicates first
  const { exists, paperId: existingId } = await checkPaperExists(paperMeta.doi, paperMeta.title)
  if (exists && existingId) {
    console.log(`📚 Paper already exists, returning existing ID: ${existingId}`)
    return existingId
  }
  
  // Create text for embedding (title + abstract)
  const text = `${paperMeta.title}\n${paperMeta.abstract || ''}`
  
  // Generate embedding using centralized configuration
  const [embedding] = await generateEmbeddings([text])
  
  // Create deterministic UUID from DOI or content
  const paperId = paperMeta.doi 
    ? generatePaperUUID(paperMeta.doi)
    : generatePaperUUID(text)
  
  // Upsert paper with embedding (no chunks)
  const { error } = await supabase
    .from('papers')
    .upsert({
      id: paperId,
      title: paperMeta.title,
      abstract: paperMeta.abstract,
      publication_date: paperMeta.publication_date,
      venue: paperMeta.venue,
      doi: paperMeta.doi,
      url: paperMeta.url,
      pdf_url: paperMeta.pdf_url,
      metadata: paperMeta.metadata,
      source: paperMeta.source || 'unknown',
      citation_count: paperMeta.citation_count || 0,
      impact_score: Math.max(paperMeta.impact_score || 0, 0),
      embedding: embedding
    })
  
  if (error) throw error
  
  // Handle authors efficiently with batch operations
  if (paperMeta.authors && paperMeta.authors.length > 0) {
    await upsertPaperAuthors(paperId, paperMeta.authors)
  }
  
  console.log(`📚 Lightweight ingestion completed: ${paperMeta.title} (ID: ${paperId})`)
  
  return paperId
}
