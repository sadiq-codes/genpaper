import { LibraryPaper, LibraryFilters, PaperWithAuthors } from '@/types/simplified'
import { getSB } from '@/lib/supabase/server'
import { 
  PaperRow,
  LibraryPaperRow, 
  extractAuthors 
} from '@/lib/supabase/types'

// ============================================================================
// Types
// ============================================================================

/** Raw result from library_papers with joined paper */
interface LibraryPaperWithJoinedPaper extends LibraryPaperRow {
  paper: PaperRow
}

/** Extended LibraryPaper with author_names for display */
interface LibraryPaperWithAuthors extends Omit<LibraryPaper, 'paper'> {
  paper: PaperWithAuthors
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert null to undefined for optional fields.
 * Database uses null, but application types use undefined for optional fields.
 */
function nullToUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value
}

/**
 * Transform a library paper with joined paper data to the application format.
 * Handles author array extraction and adds author_names for backward compatibility.
 * 
 * Note: Generated Supabase types show some required fields as nullable (user_id, paper_id)
 * because the types file is outdated. We assert these are non-null as they are NOT NULL in the schema.
 */
function transformLibraryPaper(item: LibraryPaperWithJoinedPaper): LibraryPaperWithAuthors {
  const paper = item.paper
  const authors = extractAuthors(paper)
  
  return {
    id: item.id,
    user_id: item.user_id!, // NOT NULL in schema
    paper_id: item.paper_id!, // NOT NULL in schema
    notes: nullToUndefined(item.notes),
    added_at: item.added_at,
    paper: {
      id: paper.id,
      title: paper.title,
      abstract: nullToUndefined(paper.abstract),
      publication_date: nullToUndefined(paper.publication_date),
      venue: nullToUndefined(paper.venue),
      doi: nullToUndefined(paper.doi),
      url: nullToUndefined(paper.url),
      pdf_url: nullToUndefined(paper.pdf_url),
      source: nullToUndefined(paper.source),
      citation_count: nullToUndefined(paper.citation_count),
      created_at: paper.created_at,
      authors: authors.map((name: string) => ({ id: '', name })),
      author_names: authors,
    }
  }
}

// ============================================================================
// CRUD Operations
// ============================================================================

export async function addPaperToLibrary(
  userId: string,
  paperId: string,
  notes?: string
): Promise<LibraryPaperWithAuthors> {
  const supabase = await getSB()
  const { data, error } = await supabase
    .from('library_papers')
    .insert({
      user_id: userId,
      paper_id: paperId,
      notes
    })
    .select(`
      *,
      paper:papers(*)
    `)
    .single()

  if (error) throw error

  return transformLibraryPaper(data as LibraryPaperWithJoinedPaper)
}

export async function removePaperFromLibrary(
  libraryPaperId: string
): Promise<void> {
  const supabase = await getSB()
  // RLS policy ensures user can only delete their own library entries
  const { error } = await supabase
    .from('library_papers')
    .delete()
    .eq('id', libraryPaperId)

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

// ============================================================================
// Query Operations
// ============================================================================

export async function getUserLibraryPapers(
  userId: string,
  filters: LibraryFilters = {},
  limit = 20,
  offset = 0
): Promise<LibraryPaperWithAuthors[]> {
  const supabase = await getSB()
  let query = supabase
    .from('library_papers')
    .select(`
      *,
      paper:papers(*)
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
    query = query.order('paper.publication_date', { ascending: sortOrder === 'asc', nullsFirst: false })
  } else if (sortBy === 'citation_count') {
    query = query.order('paper.citation_count', { ascending: sortOrder === 'asc', nullsFirst: false })
  }

  const { data, error } = await query.range(offset, offset + limit - 1)

  if (error) throw error

  return (data || []).map(item => 
    transformLibraryPaper(item as LibraryPaperWithJoinedPaper)
  )
}

export async function getLibraryPaper(
  userId: string,
  paperId: string
): Promise<LibraryPaperWithAuthors | null> {
  const supabase = await getSB()
  const { data, error } = await supabase
    .from('library_papers')
    .select(`
      *,
      paper:papers(*)
    `)
    .eq('user_id', userId)
    .eq('paper_id', paperId)
    .single()

  if (error && error.code !== 'PGRST116') throw error
  if (!data) return null

  return transformLibraryPaper(data as LibraryPaperWithJoinedPaper)
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

// ============================================================================
// Batch Operations
// ============================================================================

export async function getPapersByIds(paperIds: string[]): Promise<LibraryPaperWithAuthors[]> {
  const supabase = await getSB()
  
  if (!paperIds || paperIds.length === 0) {
    return []
  }

  // Separate UUIDs from deterministic IDs
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const uuids = paperIds.filter(id => uuidRegex.test(id))
  const deterministicIds = paperIds.filter(id => !uuidRegex.test(id))

  const promises = []

  // Query for standard UUIDs directly
  if (uuids.length > 0) {
    const query = supabase
      .from('library_papers')
      .select(`
        *,
        paper:papers(*)
      `)
      .in('paper_id', uuids)
    promises.push(query)
  }

  // For deterministic IDs, first find their UUIDs, then query
  if (deterministicIds.length > 0) {
    const promise = (async () => {
      const { data: mapping, error: mappingError } = await supabase
        .from('papers')
        .select('id')
        .in('deterministic_id', deterministicIds)
      
      if (mappingError) {
        console.error('Error fetching deterministic ID mappings:', mappingError)
        return { data: [], error: mappingError }
      }

      const foundUuids = mapping.map(m => m.id)
      if (foundUuids.length === 0) {
        return { data: [], error: null }
      }

      return supabase
        .from('library_papers')
        .select(`
          *,
          paper:papers(*)
        `)
        .in('paper_id', foundUuids)
    })()
    promises.push(promise)
  }

  const results = await Promise.all(promises)

  const papers: LibraryPaperWithAuthors[] = []
  const seenIds = new Set<string>()

  for (const result of results) {
    if (result.error) {
      console.error('Error fetching papers by ID:', result.error)
    }
    if (result.data) {
      for (const item of result.data) {
        const transformed = transformLibraryPaper(item as LibraryPaperWithJoinedPaper)
        
        if (!seenIds.has(transformed.id)) {
          papers.push(transformed)
          seenIds.add(transformed.id)
        }
      }
    }
  }

  return papers
}

// ============================================================================
// Stats & Activity
// ============================================================================

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
