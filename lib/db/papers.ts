import { createClient } from '@/lib/supabase/server'
import { createBrowserClient } from '@supabase/ssr'
import type { Paper, Author, PaperWithAuthors, SearchPapersRequest } from '@/types/simplified'

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

  if (useSemanticSearch) {
    // For semantic search, we would need to implement vector search
    // For now, fall back to text search
    supabaseQuery = supabaseQuery.textSearch('search_vector', query)
  } else {
    // Full-text search on title and abstract
    supabaseQuery = supabaseQuery.textSearch('search_vector', query)
  }

  if (sources && sources.length > 0) {
    supabaseQuery = supabaseQuery.in('source', sources)
  }

  const { data, error } = await supabaseQuery
    .order('citation_count', { ascending: false, nullsLast: true })
    .order('publication_date', { ascending: false, nullsLast: true })
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
    .order('citation_count', { ascending: false, nullsLast: true })
    .order('impact_score', { ascending: false, nullsLast: true })
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
    .order('publication_date', { ascending: false, nullsLast: true })
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
      .order('citation_count', { ascending: false, nullsLast: true })
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
      .order('citation_count', { ascending: false, nullsLast: true })
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