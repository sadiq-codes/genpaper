import { createBrowserClient } from '@supabase/ssr'
import { createClient } from '@/lib/supabase/server'
import type { 
  LibraryPaper, 
  LibraryCollection, 
  Paper, 
  LibraryFilters,
  Tag 
} from '@/types/simplified'

// Browser-side client
export const createBrowserSupabaseClient = () => {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export async function addPaperToLibrary(
  userId: string,
  paperId: string,
  notes?: string
): Promise<LibraryPaper> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('library_papers')
    .insert({
      user_id: userId,
      paper_id: paperId,
      notes
    })
    .select(`
      *,
      paper:papers(
        *,
        authors:paper_authors(
          ordinal,
          author:authors(*)
        )
      )
    `)
    .single()

  if (error) throw error

  // Transform the data to include author names
  const paper = data.paper as any
  const authors = paper.authors
    ?.sort((a: any, b: any) => a.ordinal - b.ordinal)
    ?.map((pa: any) => pa.author) || []

  return {
    ...data,
    paper: {
      ...paper,
      authors
    }
  }
}

export async function removePaperFromLibrary(
  userId: string,
  paperId: string
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('library_papers')
    .delete()
    .eq('user_id', userId)
    .eq('paper_id', paperId)

  if (error) throw error
}

export async function updateLibraryPaperNotes(
  libraryPaperId: string,
  notes: string
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('library_papers')
    .update({ notes })
    .eq('id', libraryPaperId)

  if (error) throw error
}

export async function getUserLibraryPapers(
  userId: string,
  filters: LibraryFilters = {},
  limit = 20,
  offset = 0
): Promise<LibraryPaper[]> {
  const supabase = await createClient()
  let query = supabase
    .from('library_papers')
    .select(`
      *,
      paper:papers(
        *,
        authors:paper_authors(
          ordinal,
          author:authors(*)
        )
      )
    `)
    .eq('user_id', userId)

  // Apply filters
  if (filters.search) {
    query = query.or(
      `paper.title.ilike.%${filters.search}%,paper.abstract.ilike.%${filters.search}%,notes.ilike.%${filters.search}%`
    )
  }

  if (filters.source) {
    query = query.eq('paper.source', filters.source)
  }

  // Apply sorting
  const sortBy = filters.sortBy || 'added_at'
  const sortOrder = filters.sortOrder || 'desc'
  
  if (sortBy === 'added_at') {
    query = query.order('added_at', { ascending: sortOrder === 'asc' })
  } else if (sortBy === 'title') {
    query = query.order('paper.title', { ascending: sortOrder === 'asc' })
  } else if (sortBy === 'publication_date') {
    query = query.order('paper.publication_date', { ascending: sortOrder === 'asc', nullsLast: true })
  } else if (sortBy === 'citation_count') {
    query = query.order('paper.citation_count', { ascending: sortOrder === 'asc', nullsLast: true })
  }

  const { data, error } = await query
    .range(offset, offset + limit - 1)

  if (error) throw error

  // Transform the data to include author names
  return (data || []).map((libraryPaper: any) => {
    const paper = libraryPaper.paper
    const authors = paper.authors
      ?.sort((a: any, b: any) => a.ordinal - b.ordinal)
      ?.map((pa: any) => pa.author) || []

    return {
      ...libraryPaper,
      paper: {
        ...paper,
        authors
      }
    }
  })
}

export async function getLibraryPaper(
  userId: string,
  paperId: string
): Promise<LibraryPaper | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('library_papers')
    .select(`
      *,
      paper:papers(
        *,
        authors:paper_authors(
          ordinal,
          author:authors(*)
        )
      )
    `)
    .eq('user_id', userId)
    .eq('paper_id', paperId)
    .single()

  if (error && error.code !== 'PGRST116') throw error
  if (!data) return null

  const paper = data.paper as any
  const authors = paper.authors
    ?.sort((a: any, b: any) => a.ordinal - b.ordinal)
    ?.map((pa: any) => pa.author) || []

  return {
    ...data,
    paper: {
      ...paper,
      authors
    }
  }
}

export async function isInLibrary(
  userId: string,
  paperId: string
): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('library_papers')
    .select('id')
    .eq('user_id', userId)
    .eq('paper_id', paperId)
    .single()

  if (error && error.code !== 'PGRST116') throw error
  return !!data
}

// Collection management
export async function createCollection(
  userId: string,
  name: string,
  description?: string
): Promise<LibraryCollection> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('library_collections')
    .insert({
      user_id: userId,
      name,
      description
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getUserCollections(userId: string): Promise<LibraryCollection[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('library_collections')
    .select(`
      *,
      paper_count:collection_papers(count)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error

  // Transform the count data
  return (data || []).map((collection: any) => ({
    ...collection,
    paper_count: collection.paper_count[0]?.count || 0
  }))
}

export async function addPaperToCollection(
  collectionId: string,
  paperId: string
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('collection_papers')
    .insert({
      collection_id: collectionId,
      paper_id: paperId
    })

  if (error) throw error
}

export async function removePaperFromCollection(
  collectionId: string,
  paperId: string
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('collection_papers')
    .delete()
    .eq('collection_id', collectionId)
    .eq('paper_id', paperId)

  if (error) throw error
}

export async function getCollectionPapers(
  collectionId: string,
  limit = 20,
  offset = 0
): Promise<Paper[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('collection_papers')
    .select(`
      paper:papers(
        *,
        authors:paper_authors(
          ordinal,
          author:authors(*)
        )
      )
    `)
    .eq('collection_id', collectionId)
    .range(offset, offset + limit - 1)

  if (error) throw error

  return (data || []).map((item: any) => {
    const paper = item.paper
    const authors = paper.authors
      ?.sort((a: any, b: any) => a.ordinal - b.ordinal)
      ?.map((pa: any) => pa.author) || []

    return {
      ...paper,
      authors
    }
  })
}

export async function deleteCollection(collectionId: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('library_collections')
    .delete()
    .eq('id', collectionId)

  if (error) throw error
}

// Tag management
export async function createOrGetTag(userId: string, name: string): Promise<Tag> {
  // First try to get existing tag
  const supabase = await createClient()
  const { data: existingTag } = await supabase
    .from('tags')
    .select('*')
    .eq('user_id', userId)
    .eq('name', name)
    .single()

  if (existingTag) return existingTag

  // Create new tag
  const { data, error } = await supabase
    .from('tags')
    .insert({
      user_id: userId,
      name
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getUserTags(userId: string): Promise<Tag[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tags')
    .select('*')
    .eq('user_id', userId)
    .order('name')

  if (error) throw error
  return data || []
}

export async function addTagToLibraryPaper(
  libraryPaperId: string,
  tagId: string
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('library_paper_tags')
    .insert({
      paper_id: libraryPaperId,
      tag_id: tagId
    })

  if (error) throw error
}

export async function removeTagFromLibraryPaper(
  libraryPaperId: string,
  tagId: string
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('library_paper_tags')
    .delete()
    .eq('paper_id', libraryPaperId)
    .eq('tag_id', tagId)

  if (error) throw error
}

// Browser client functions for client components
export const clientLibraryOperations = {
  async getUserLibrary(filters: LibraryFilters = {}, limit = 20, offset = 0) {
    const supabase = createBrowserSupabaseClient()
    
    let query = supabase
      .from('library_papers')
      .select(`
        *,
        paper:papers(
          *,
          authors:paper_authors(
            ordinal,
            author:authors(*)
          )
        )
      `)

    // Apply filters
    if (filters.search) {
      query = query.or(
        `paper.title.ilike.%${filters.search}%,paper.abstract.ilike.%${filters.search}%,notes.ilike.%${filters.search}%`
      )
    }

    if (filters.source) {
      query = query.eq('paper.source', filters.source)
    }

    // Apply sorting
    const sortBy = filters.sortBy || 'added_at'
    const sortOrder = filters.sortOrder || 'desc'
    
    if (sortBy === 'added_at') {
      query = query.order('added_at', { ascending: sortOrder === 'asc' })
    } else if (sortBy === 'title') {
      query = query.order('paper.title', { ascending: sortOrder === 'asc' })
    } else if (sortBy === 'publication_date') {
      query = query.order('paper.publication_date', { ascending: sortOrder === 'asc', nullsLast: true })
    } else if (sortBy === 'citation_count') {
      query = query.order('paper.citation_count', { ascending: sortOrder === 'asc', nullsLast: true })
    }

    const { data, error } = await query.range(offset, offset + limit - 1)

    if (error) throw error

    // Transform the data to include author names
    return (data || []).map((libraryPaper: any) => {
      const paper = libraryPaper.paper
      const authors = paper.authors
        ?.sort((a: any, b: any) => a.ordinal - b.ordinal)
        ?.map((pa: any) => pa.author) || []

      return {
        ...libraryPaper,
        paper: {
          ...paper,
          authors
        }
      }
    })
  },

  async addToLibrary(paperId: string, notes?: string) {
    const supabase = createBrowserSupabaseClient()
    
    const { data, error } = await supabase
      .from('library_papers')
      .insert({
        paper_id: paperId,
        notes
      })
      .select()
      .single()

    if (error) throw error
    return data
  },

  async removeFromLibrary(paperId: string) {
    const supabase = createBrowserSupabaseClient()
    
    const { error } = await supabase
      .from('library_papers')
      .delete()
      .eq('paper_id', paperId)

    if (error) throw error
  },

  async isInLibrary(paperId: string) {
    const supabase = createBrowserSupabaseClient()
    
    const { data, error } = await supabase
      .from('library_papers')
      .select('id')
      .eq('paper_id', paperId)
      .single()

    if (error && error.code !== 'PGRST116') throw error
    return !!data
  },

  async getCollections() {
    const supabase = createBrowserSupabaseClient()
    
    const { data, error } = await supabase
      .from('library_collections')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error
    return data || []
  }
}

export async function getPapersByIds(paperIds: string[]): Promise<LibraryPaper[]> {
  if (paperIds.length === 0) return []
  
  const supabase = await createClient()
  
  // First try to get from library_papers table (in case these are library paper IDs)
  const { data: libraryData, error: libraryError } = await supabase
    .from('library_papers')
    .select(`
      *,
      paper:papers(
        *,
        authors:paper_authors(
          ordinal,
          author:authors(*)
        )
      )
    `)
    .in('id', paperIds)

  if (!libraryError && libraryData && libraryData.length > 0) {
    // Found library papers with these IDs
    return libraryData.map((libraryPaper: any) => {
      const paper = libraryPaper.paper
      const authors = paper.authors
        ?.sort((a: any, b: any) => a.ordinal - b.ordinal)
        ?.map((pa: any) => pa.author) || []

      return {
        ...libraryPaper,
        paper: {
          ...paper,
          authors,
          author_names: authors.map((a: any) => a.name)
        }
      }
    })
  }

  // If not found in library_papers, try papers table (in case these are paper IDs)
  const { data: paperData, error: paperError } = await supabase
    .from('papers')
    .select(`
      *,
      authors:paper_authors(
        ordinal,
        author:authors(*)
      )
    `)
    .in('id', paperIds)

  if (paperError) throw paperError

  // Transform the data to include author names and create LibraryPaper structure
  return (paperData || []).map((paper: any) => {
    const authors = paper.authors
      ?.sort((a: any, b: any) => a.ordinal - b.ordinal)
      ?.map((pa: any) => pa.author) || []

    return {
      id: `temp-${paper.id}`, // Temporary ID since this isn't a real library entry
      user_id: 'system',
      paper_id: paper.id,
      added_at: new Date().toISOString(),
      notes: null,
      paper: {
        ...paper,
        authors,
        author_names: authors.map((a: any) => a.name)
      }
    }
  })
} 