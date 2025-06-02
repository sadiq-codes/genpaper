import { createClient } from '@/lib/supabase/server'
import { createBrowserClient } from '@supabase/ssr'
import type { Paper, Author, PaperWithAuthors, SearchPapersRequest } from '@/types/simplified'
import { openai } from '@/lib/ai/sdk'
import { createHash } from 'crypto'

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

  // Transform the data to match our types
  const authors = data.authors
    ?.sort((a: any, b: any) => a.ordinal - b.ordinal)
    ?.map((pa: any) => pa.author) || []

  return {
    ...data,
    authors,
    author_names: authors.map((a: Author) => a.name)
  }
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
  return (data || []).map((paper: any) => {
    const authors = paper.authors
      ?.sort((a: any, b: any) => a.ordinal - b.ordinal)
      ?.map((pa: any) => pa.author) || []

    return {
      ...paper,
      authors
    }
  })
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

  const authors = data.authors
    ?.sort((a: any, b: any) => a.ordinal - b.ordinal)
    ?.map((pa: any) => pa.author) || []

  return {
    ...data,
    authors
  }
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

  return (data || []).map((paper: any) => {
    const authors = paper.authors
      ?.sort((a: any, b: any) => a.ordinal - b.ordinal)
      ?.map((pa: any) => pa.author) || []

    return {
      ...paper,
      authors
    }
  })
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

  return (data || []).map((paper: any) => {
    const authors = paper.authors
      ?.sort((a: any, b: any) => a.ordinal - b.ordinal)
      ?.map((pa: any) => pa.author) || []

    return {
      ...paper,
      authors
    }
  })
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

    return (data || []).map((paper: any) => {
      const authors = paper.authors
        ?.sort((a: any, b: any) => a.ordinal - b.ordinal)
        ?.map((pa: any) => pa.author) || []

      return {
        ...paper,
        authors
      }
    })
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

    const authors = data.authors
      ?.sort((a: any, b: any) => a.ordinal - b.ordinal)
      ?.map((pa: any) => pa.author) || []

    return {
      ...data,
      authors
    }
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

    return (data || []).map((paper: any) => {
      const authors = paper.authors
        ?.sort((a: any, b: any) => a.ordinal - b.ordinal)
        ?.map((pa: any) => pa.author) || []

      return {
        ...paper,
        authors
      }
    })
  }
}

// Task 1: Ingest & vectorise papers
interface PaperDTO {
  title: string
  abstract?: string
  publication_date?: string
  venue?: string
  doi?: string
  url?: string
  pdf_url?: string
  metadata?: any
  source?: string
  citation_count?: number
  impact_score?: number
  authors?: string[]
}

export async function ingestPaper(paperMeta: PaperDTO): Promise<string> {
  const supabase = await createClient()
  
  // Create text for embedding (title + abstract)
  const text = `${paperMeta.title}\n${paperMeta.abstract || ''}`
  
  // Generate embedding using OpenAI
  const { data: embeddingData } = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text
  })
  
  const embedding = embeddingData[0].embedding
  
  // Create deterministic ID from DOI or content hash
  const paperId = paperMeta.doi 
    ? createHash('md5').update(paperMeta.doi).digest('hex')
    : createHash('md5').update(text).digest('hex')
  
  // Upsert paper with embedding
  const { data: paper, error } = await supabase
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
    .select()
    .single()
  
  if (error) throw error
  
  // Handle authors if provided
  if (paperMeta.authors && paperMeta.authors.length > 0) {
    // Remove existing author relationships for this paper
    await supabase
      .from('paper_authors')
      .delete()
      .eq('paper_id', paperId)
    
    // Add new author relationships
    for (let i = 0; i < paperMeta.authors.length; i++) {
      const author = await createOrGetAuthor(paperMeta.authors[i])
      
      await supabase
        .from('paper_authors')
        .upsert({
          paper_id: paperId,
          author_id: author.id,
          ordinal: i + 1
        })
    }
  }
  
  return paperId
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
    
    // Generate embeddings in batch
    const { data: embeddingData } = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts
    })
    
    // Process each paper in the batch
    for (let j = 0; j < batch.length; j++) {
      const paper = batch[j]
      const embedding = embeddingData[j].embedding
      
      const paperId = await ingestPaperWithEmbedding(paper, embedding)
      paperIds.push(paperId)
    }
  }
  
  return paperIds
}

// Helper function to ingest paper with pre-generated embedding
async function ingestPaperWithEmbedding(paperMeta: PaperDTO, embedding: number[]): Promise<string> {
  const supabase = await createClient()
  
  const text = `${paperMeta.title}\n${paperMeta.abstract || ''}`
  const paperId = paperMeta.doi 
    ? createHash('md5').update(paperMeta.doi).digest('hex')
    : createHash('md5').update(text).digest('hex')
  
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
  
  // Handle authors if provided
  if (paperMeta.authors && paperMeta.authors.length > 0) {
    await supabase
      .from('paper_authors')
      .delete()
      .eq('paper_id', paperId)
    
    for (let i = 0; i < paperMeta.authors.length; i++) {
      const author = await createOrGetAuthor(paperMeta.authors[i])
      
      await supabase
        .from('paper_authors')
        .upsert({
          paper_id: paperId,
          author_id: author.id,
          ordinal: i + 1
        })
    }
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
  
  // Generate embedding for the query
  const { data: embeddingData } = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query
  })
  
  const queryEmbedding = embeddingData[0].embedding
  
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
      
      const authors = paper.authors
        ?.sort((a: any, b: any) => a.ordinal - b.ordinal)
        ?.map((pa: any) => pa.author) || []
      
      return {
        ...paper,
        authors,
        author_names: authors.map((a: Author) => a.name),
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
  } = {}
): Promise<PaperWithAuthors[]> {
  const supabase = await createClient()
  
  // Generate embedding for the query
  const { data: embeddingData } = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query
  })
  
  const queryEmbedding = embeddingData[0].embedding
  
  // Call the hybrid_search_papers RPC function
  const { data: matches, error } = await supabase
    .rpc('hybrid_search_papers', {
      query_embedding: queryEmbedding,
      query_text: query,
      match_count: options.limit || 8,
      min_year: options.minYear || 2018,
      semantic_weight: options.semanticWeight || 0.7
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
    .in('id', (matches as HybridSearchResult[]).map(m => m.paper_id))
  
  // Apply source filter if provided
  if (options.sources && options.sources.length > 0) {
    papersQuery = papersQuery.in('source', options.sources)
  }
  
  const { data: papers, error: papersError } = await papersQuery
  
  if (papersError) throw papersError
  
  // Transform and sort by combined score
  const paperMap = new Map(papers?.map(p => [p.id, p]) || [])
  
  return (matches as HybridSearchResult[])
    .map(match => {
      const paper = paperMap.get(match.paper_id)
      if (!paper) return null
      
      const authors = paper.authors
        ?.sort((a: any, b: any) => a.ordinal - b.ordinal)
        ?.map((pa: any) => pa.author) || []
      
      return {
        ...paper,
        authors,
        author_names: authors.map((a: Author) => a.name),
        relevance_score: match.combined_score,
        semantic_score: match.semantic_score,
        keyword_score: match.keyword_score
      }
    })
    .filter(Boolean) as PaperWithAuthors[]
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
      
      const authors = paper.authors
        ?.sort((a: any, b: any) => a.ordinal - b.ordinal)
        ?.map((pa: any) => pa.author) || []
      
      return {
        ...paper,
        authors,
        author_names: authors.map((a: Author) => a.name),
        relevance_score: match.score
      }
    })
    .filter(Boolean) as PaperWithAuthors[]
} 