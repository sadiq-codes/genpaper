import { Paper, LibraryPaper, LibraryCollection, Tag, LibraryFilters, PaperMetadata, Author } from '@/types/simplified'
import { getSB } from '@/lib/supabase/server'
import { createClient as createBrowserSupabaseClient } from '@/lib/supabase/client'
import type { CSLItem } from '@/lib/utils/csl'
import { 
  transformPaperWithAuthors, 
  PAPER_WITH_AUTHORS_SELECT,
  applySorting,
  applyFilters,
  type PaperAuthorJoin, 
  type PaperWithAuthorJoins 
} from './library-utils'

// Browser-side client now imported from centralized location

export async function addPaperToLibrary(
  userId: string,
  paperId: string,
  notes?: string
): Promise<LibraryPaper> {
  const supabase = await getSB()
  const { data, error } = await supabase
    .from('library_papers')
    .insert({
      user_id: userId,
      paper_id: paperId,
      notes
    })
    .select(PAPER_WITH_AUTHORS_SELECT)
    .single()

  if (error) throw error

  // Use shared transformation utility
  return transformPaperWithAuthors(data)
}

export async function removePaperFromLibrary(
  userId: string,
  paperId: string
): Promise<void> {
  const supabase = await getSB()
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
  const supabase = await getSB()
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
  const supabase = await getSB()
  let query = supabase
    .from('library_papers')
    .select(PAPER_WITH_AUTHORS_SELECT)
    .eq('user_id', userId)

  // Apply filters using shared utility
  query = applyFilters(query, filters)

  // Apply sorting using shared utility  
  const sortBy = filters.sortBy || 'added_at'
  const sortOrder = filters.sortOrder || 'desc'
  query = applySorting(query, sortBy, sortOrder)

  const { data, error } = await query.range(offset, offset + limit - 1)

  if (error) throw error

  // Transform using shared utility
  return (data || []).map(transformPaperWithAuthors)
}

export async function getLibraryPaper(
  userId: string,
  paperId: string
): Promise<LibraryPaper | null> {
  const supabase = await getSB()
  const { data, error } = await supabase
    .from('library_papers')
    .select(PAPER_WITH_AUTHORS_SELECT)
    .eq('user_id', userId)
    .eq('paper_id', paperId)
    .single()

  if (error && error.code !== 'PGRST116') throw error
  if (!data) return null

  return transformPaperWithAuthors(data)
}

export async function isInLibrary(
  userId: string,
  paperId: string
): Promise<boolean> {
  const supabase = await getSB()
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
  const supabase = await getSB()
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
  const supabase = await getSB()
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
  return (data || []).map((collection: LibraryCollection & { paper_count: { count: number }[] }) => ({
    ...collection,
    paper_count: collection.paper_count[0]?.count || 0
  }))
}

export async function addPaperToCollection(
  collectionId: string,
  paperId: string
): Promise<void> {
  const supabase = await getSB()
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
  const supabase = await getSB()
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
  const supabase = await getSB()
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

  // Transform the paper data
  const papers = (data || []).map(item => {
    const dbPaper = item.paper as unknown as PaperWithAuthorJoins
    if (!dbPaper) return null
    
    // Transform authors from DbAuthor to Author type
    const authors = dbPaper.authors
      ?.sort((a: PaperAuthorJoin, b: PaperAuthorJoin) => (a.ordinal ?? 0) - (b.ordinal ?? 0))
      ?.map((pa: PaperAuthorJoin): Author => ({
        id: pa.author.id,
        name: pa.author.name
      })) || []

    // Transform to Paper type
    const paper: Paper = {
      id: dbPaper.id,
      title: dbPaper.title,
      abstract: dbPaper.abstract ?? undefined,
      publication_date: dbPaper.publication_date ?? undefined,
      venue: dbPaper.venue ?? undefined,
      doi: dbPaper.doi ?? undefined,
      url: dbPaper.url ?? undefined,
      pdf_url: dbPaper.pdf_url ?? undefined,
      metadata: dbPaper.metadata as PaperMetadata | undefined,
      source: dbPaper.source ?? undefined,
      citation_count: dbPaper.citation_count ?? undefined,
      impact_score: dbPaper.impact_score ?? undefined,
      created_at: dbPaper.created_at,
      csl_json: (dbPaper.csl_json as unknown) as CSLItem | undefined,
      authors
    }

    return paper
  }).filter((p): p is Paper => p !== null)
  
  return papers
}

export async function deleteCollection(collectionId: string): Promise<void> {
  const supabase = await getSB()
  const { error } = await supabase
    .from('library_collections')
    .delete()
    .eq('id', collectionId)

  if (error) throw error
}

// Tag management
export async function createOrGetTag(userId: string, name: string): Promise<Tag> {
  const supabase = await getSB()
  // First try to get existing tag
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
  const supabase = await getSB()
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
  const supabase = await getSB()
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
  const supabase = await getSB()
  const { error } = await supabase
    .from('library_paper_tags')
    .delete()
    .eq('paper_id', libraryPaperId)
    .eq('tag_id', tagId)

  if (error) throw error
}

// Browser client functions for client components
export const clientLibraryOperations = {
  async getUserLibrary(filters: LibraryFilters = {}, limit = 20, offset = 0): Promise<LibraryPaper[]> {
    const supabase = createBrowserSupabaseClient()
    
    let query = supabase
      .from('library_papers')
      .select(PAPER_WITH_AUTHORS_SELECT)

    // Apply filters and sorting using shared utilities
    query = applyFilters(query, filters)
    query = applySorting(query, filters.sortBy || 'added_at', filters.sortOrder || 'desc')

    const { data, error } = await query.range(offset, offset + limit - 1)

    if (error) throw error

    // Transform using shared utility
    return (data || []).map(transformPaperWithAuthors)
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

  async getCollections(): Promise<LibraryCollection[]> {
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
  const supabase = await getSB()
  
  const { data, error } = await supabase
    .from('library_papers')
    .select(PAPER_WITH_AUTHORS_SELECT)
    .in('paper_id', paperIds)

  if (error) throw error
  if (!data) return []

  return (data || []).map(transformPaperWithAuthors)
}

export async function getRecentActivity(userId: string, limit = 5) {
  const supabase = await getSB()
  const { data, error } = await supabase
    .from('library_papers')
    .select('*, paper:papers(id, title)')
    .eq('user_id', userId)
    .order('added_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data
}

export async function getLibraryStats(userId: string) {
  const supabase = await getSB()
  const { data, error } = await supabase.rpc('get_user_library_stats', { p_user_id: userId }).single()

  if (error) throw error
  return data
} 