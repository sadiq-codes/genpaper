import { LibraryPaper, LibraryFilters } from '@/types/simplified'
import { getSB } from '@/lib/supabase/server'
// Legacy browser client import removed - use API endpoints for client operations
// CSL utilities no longer needed
// Simplified library utilities - no longer need complex author joins

interface SimplifiedPaper {
  id: string
  title: string
  abstract?: string
  authors?: string[]
  publication_date?: string
  venue?: string
  doi?: string
  url?: string
  pdf_url?: string
  source?: string
  citation_count?: number
  impact_score?: number
  created_at: string
  [key: string]: unknown
}

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
    .select(`
      *,
      paper:papers(*)
    `)
    .single()

  if (error) throw error

  // Transform with simplified schema
  const paper = data.paper as SimplifiedPaper
  const authors = Array.isArray(paper.authors) ? paper.authors : []
  
  return {
    ...data,
    paper: {
      ...paper,
      authors: authors.map((name: string) => ({ id: '', name })),
      author_names: authors
    }
  }
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

  // Transform with simplified schema
  return (data || []).map(item => {
    const paper = item.paper as any
    const authors = Array.isArray(paper.authors) ? paper.authors : []
    
    return {
      ...item,
      paper: {
        ...paper,
        authors: authors.map((name: string) => ({ id: '', name })),
        author_names: authors
      }
    }
  })
}

export async function getLibraryPaper(
  userId: string,
  paperId: string
): Promise<LibraryPaper | null> {
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

  // Transform with simplified schema
  const paper = data.paper as SimplifiedPaper
  const authors = Array.isArray(paper.authors) ? paper.authors : []
  
  return {
    ...data,
    paper: {
      ...paper,
      authors: authors.map((name: string) => ({ id: '', name })),
      author_names: authors
    }
  }
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

// Collection management functions removed - collections are now simple text fields in library_papers

// Tag management functions removed - tags are now stored as text arrays in library_papers.tags

// Legacy clientLibraryOperations removed - use API endpoints instead

export async function getPapersByIds(paperIds: string[]): Promise<LibraryPaper[]> {
  const supabase = await getSB()
  
  if (!paperIds || paperIds.length === 0) {
    return []
  }

  // Separate UUIDs from deterministic IDs
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const uuids = paperIds.filter(id => uuidRegex.test(id));
  const deterministicIds = paperIds.filter(id => !uuidRegex.test(id));

  const promises = [];

  // Query for standard UUIDs directly
  if (uuids.length > 0) {
    const query = supabase
      .from('library_papers')
      .select(`
        *,
        paper:papers(*)
      `)
      .in('paper_id', uuids);
    promises.push(query);
  }

  // For deterministic IDs, first find their UUIDs, then query
  if (deterministicIds.length > 0) {
    const promise = (async () => {
      const { data: mapping, error: mappingError } = await supabase
        .from('papers')
        .select('id')
        .in('deterministic_id', deterministicIds);
      
      if (mappingError) {
        console.error('Error fetching deterministic ID mappings:', mappingError);
        return { data: [], error: mappingError };
      }

      const foundUuids = mapping.map(m => m.id);
      if (foundUuids.length === 0) {
        return { data: [], error: null };
      }

      return supabase
        .from('library_papers')
        .select(`
          *,
          paper:papers(*)
        `)
        .in('paper_id', foundUuids);
    })();
    promises.push(promise);
  }

  const results = await Promise.all(promises);

  const papers: LibraryPaper[] = [];
  const seenIds = new Set<string>();

  for (const result of results) {
    if (result.error) {
      console.error('Error fetching papers by ID:', result.error);
      // Decide if you want to throw or just continue
    }
    if (result.data) {
      for (const item of result.data) {
        // Transform with simplified schema
        const paper = item.paper as any
        const authors = Array.isArray(paper.authors) ? paper.authors : []
        
        const transformed = {
          ...item,
          paper: {
            ...paper,
            authors: authors.map((name: string) => ({ id: '', name })),
            author_names: authors
          }
        }
        
        if (!seenIds.has(transformed.id)) {
          papers.push(transformed);
          seenIds.add(transformed.id);
        }
      }
    }
  }

  return papers;
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