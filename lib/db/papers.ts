import { createClient } from '@/lib/supabase/server'
import { createBrowserClient } from '@supabase/ssr'
import type { Paper, Author, PaperWithAuthors, SearchPapersRequest } from '@/types/simplified'
import { openai } from '@/lib/ai/sdk'
import { v5 as uuidv5 } from 'uuid'
import { type PaperDTO } from '@/lib/schemas/paper'

// Namespace UUID for generating deterministic paper UUIDs
const PAPER_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

// Helper function to generate deterministic UUID for papers
function generatePaperUUID(input: string): string {
  // Use UUID v5 for deterministic UUID generation based on input
  return uuidv5(input, PAPER_NAMESPACE)
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
  const supabase = await createClient()
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
  const supabase = await createClient()
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
  const supabase = await createClient()
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

export async function searchPapers({
  query,
  limit = 20,
  sources,
  useSemanticSearch = false
}: SearchPapersRequest): Promise<Paper[]> {
  // Use semantic search if requested and query is provided
  if (useSemanticSearch && query) {
    return await semanticSearchPapers(query, { limit, sources })
  }
  
  const supabase = await createClient()
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

  if (sources && sources.length > 0) {
    supabaseQuery = supabaseQuery.in('source', sources)
  }

  const { data, error } = await supabaseQuery
    .order('citation_count', { ascending: false, nullsFirst: false })
    .order('publication_date', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) throw error

  // Transform the data to include authors
  return (data || []).map((paper: DatabasePaper) => transformDatabasePaper(paper))
}

export async function getPaperByDOI(doi: string): Promise<Paper | null> {
  const supabase = await createClient()
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
  const supabase = await createClient()
  const { error } = await supabase
    .from('papers')
    .update(metadata)
    .eq('id', paperId)

  if (error) throw error
}

export async function getPopularPapers(limit = 10): Promise<Paper[]> {
  const supabase = await createClient()
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
    .order('impact_score', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) throw error

  return (data || []).map((paper: DatabasePaper) => transformDatabasePaper(paper))
}

export async function getRecentPapers(limit = 10): Promise<Paper[]> {
  const supabase = await createClient()
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
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  return (data || []).map((paper: DatabasePaper) => transformDatabasePaper(paper))
}

// Browser client functions for client components
export const clientPaperOperations = {
  async searchPapers(searchParams: SearchPapersRequest) {
    const supabase = createBrowserSupabaseClient()
    
    let query = supabase
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

    if (searchParams.sources && searchParams.sources.length > 0) {
      query = query.in('source', searchParams.sources)
    }

    const { data, error } = await query
      .order('citation_count', { ascending: false, nullsFirst: false })
      .limit(searchParams.limit || 20)

    if (error) throw error

    return (data || []).map((paper: DatabasePaper) => transformDatabasePaper(paper))
  },

  async getPaper(paperId: string) {
    const supabase = createBrowserSupabaseClient()
    
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
  },

  async getPopularPapers(limit = 10) {
    const supabase = createBrowserSupabaseClient()
    
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
}

// Task 1: Ingest & vectorise papers

// Vector index optimization after bulk insertions
async function optimizeVectorIndex(): Promise<void> {
  const supabase = await createClient()
  
  try {
    // Run ANALYZE to update statistics for optimal ivfflat performance
    await supabase.rpc('analyze_papers_table')
  } catch (error) {
    // Gracefully handle if RPC doesn't exist yet
    console.warn('Vector index optimization skipped:', error)
  }
}

export async function ingestPaper(paperMeta: PaperDTO): Promise<string> {
  const supabase = await createClient()
  
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
      impact_score: paperMeta.impact_score,
      embedding: embedding
    })
  
  if (error) throw error
  
  // Handle authors efficiently with batch operations
  if (paperMeta.authors && paperMeta.authors.length > 0) {
    await upsertPaperAuthors(paperId, paperMeta.authors)
  }
  
  return paperId
}

// Centralized embedding configuration to ensure consistency
const EMBEDDING_CONFIG = {
  model: 'text-embedding-3-small' as const,
  dimensions: 384
} as const

// Generate embeddings with consistent configuration
async function generateEmbeddings(inputs: string | string[]): Promise<number[][]> {
  const { data } = await openai.embeddings.create({
    model: EMBEDDING_CONFIG.model,
    input: inputs,
    dimensions: EMBEDDING_CONFIG.dimensions
  })
  
  return data.map(item => item.embedding)
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
  const supabase = await createClient()
  
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
      impact_score: paperMeta.impact_score,
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
  const supabase = await createClient()
  
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
    minYear?: number
    sources?: string[]
    semanticWeight?: number
    excludePaperIds?: string[]
  } = {}
): Promise<PaperWithAuthors[]> {
  const { 
    limit = 10, 
    minYear = 2018, 
    sources, 
    semanticWeight = 0.7,
    excludePaperIds = []
  } = options

  // 1. Generate embedding for the query using centralized configuration
  const [queryEmbedding] = await generateEmbeddings([query])

  // 2. Call the hybrid search RPC function
  const supabase = await createClient()
  const { data: searchResults, error } = await supabase
    .rpc('hybrid_search_papers', {
      query_text: query,
      query_embedding: queryEmbedding,
      match_count: limit * 2, // Get more results to account for filtering
      min_year: minYear,
      semantic_weight: semanticWeight
    })

  if (error) throw error

  // 3. Filter out excluded papers
  const filteredResults = (searchResults || []).filter(
    (result: HybridSearchResult) => !excludePaperIds.includes(result.paper_id)
  )

  // 4. Get the actual paper data
  const paperIds = filteredResults.slice(0, limit).map((result: HybridSearchResult) => result.paper_id)
  
  if (paperIds.length === 0) {
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
    .in('id', paperIds)

  // Apply source filter if specified
  if (sources && sources.length > 0) {
    papersQuery = papersQuery.in('source', sources)
  }

  const { data: papers, error: papersError } = await papersQuery

  if (papersError) throw papersError

  // 5. Transform and attach scores
  const transformedPapers = (papers || []).map((paper: DatabasePaper) => {
    const searchResult = filteredResults.find(
      (result: HybridSearchResult) => result.paper_id === paper.id
    )
    
    const transformedPaper = transformDatabasePaper(paper)

    return {
      ...transformedPaper,
      relevance_score: searchResult?.combined_score || 0
    }
  })

  return transformedPapers.sort((a, b) => b.relevance_score - a.relevance_score)
}

export async function findSimilarPapers(
  paperId: string,
  limit = 5
): Promise<PaperWithAuthors[]> {
  const supabase = await createClient()
  
  // Call the find_similar_papers RPC function
  const { data: matches, error } = await supabase
    .rpc('find_similar_papers', {
      source_paper_id: paperId,
      match_count: limit
    })
  
  if (error) throw error
  if (!matches || matches.length === 0) return []
  
  // Get full paper details with authors
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
    limit?: number
    paperIds?: string[]
    minScore?: number
  } = {}
): Promise<Array<{
  paper_id: string
  chunk_index: number
  content: string
  score: number
}>> {
  const supabase = await createClient()
  
  // Generate embedding for the query using centralized configuration
  const [queryEmbedding] = await generateEmbeddings([query])
  
  // Search chunks using cosine similarity
  const { data: matches, error } = await supabase
    .rpc('match_paper_chunks', {
      query_embedding: queryEmbedding,
      match_count: options.limit || 10,
      min_score: options.minScore || 0.5
    })
  
  if (error) throw error
  
  // Filter by paper IDs if specified
  if (options.paperIds && options.paperIds.length > 0) {
    return (matches || []).filter((match: { paper_id: string }) => 
      options.paperIds!.includes(match.paper_id)
    )
  }
  
  return matches || []
}

// Ingest paper with content chunks for RAG - optimized to reuse main embedding
export async function ingestPaperWithChunks(
  paperMeta: PaperDTO, 
  contentChunks?: string[]
): Promise<string> {
  const supabase = await createClient()
  
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
      impact_score: paperMeta.impact_score,
      embedding: mainEmbedding
    })
  
  if (error) throw error
  
  // Handle authors efficiently with batch operations
  if (paperMeta.authors && paperMeta.authors.length > 0) {
    await upsertPaperAuthors(paperId, paperMeta.authors)
  }
  
  // Handle content chunks if provided
  if (contentChunks && contentChunks.length > 0) {
    // Remove existing chunks for this paper
    await supabase
      .from('paper_chunks')
      .delete()
      .eq('paper_id', paperId)
    
    // Create embeddings for chunks in batches
    const BATCH_SIZE = 100
    for (let i = 0; i < contentChunks.length; i += BATCH_SIZE) {
      const batch = contentChunks.slice(i, i + BATCH_SIZE)
      
      // Generate embeddings for batch using centralized configuration
      const chunkEmbeddings = await generateEmbeddings(batch)
      
      // Insert chunks with embeddings
      const chunkRecords = batch.map((chunk, index) => ({
        paper_id: paperId,
        chunk_index: i + index,
        content: chunk,
        embedding: chunkEmbeddings[index]
      }))
      
      const { error: chunksError } = await supabase
        .from('paper_chunks')
        .insert(chunkRecords)
      
      if (chunksError) {
        console.error('Error inserting chunks:', chunksError)
        // Continue with next batch rather than failing completely
      }
    }
    
    // Optimize vector index after chunk insertion
    await optimizeVectorIndex()
  }
  
  return paperId
}

// Optimized batch author creation to replace createOrGetAuthor loops
export async function batchCreateOrGetAuthors(authorNames: string[]): Promise<Author[]> {
  if (authorNames.length === 0) return []
  
  const supabase = await createClient()
  
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
  
  const supabase = await createClient()
  
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