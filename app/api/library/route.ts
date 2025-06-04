import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { 
  addPaperToLibrary, 
  removePaperFromLibrary, 
  getUserLibraryPapers,
  updateLibraryPaperNotes,
  isInLibrary
} from '@/lib/db/library'
import { getPaper, checkPaperExists } from '@/lib/db/papers'
import type { AddToLibraryRequest, AddToLibraryResponse, LibraryFilters } from '@/types/simplified'

// GET - Retrieve user's library papers
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search')
    const collection = searchParams.get('collection')
    const source = searchParams.get('source')
    const sortBy = searchParams.get('sortBy') || 'added_at'
    const sortOrder = searchParams.get('sortOrder') || 'desc'

    let query = supabase
      .from('library_papers')
      .select(`
        id,
        paper_id,
        notes,
        added_at,
        papers:paper_id (
          id,
          title,
          abstract,
          publication_date,
          venue,
          doi,
          url,
          pdf_url,
          metadata,
          source,
          citation_count,
          impact_score,
          created_at,
          paper_authors (
            ordinal,
            authors (
              id,
              name
            )
          )
        )
      `)
      .eq('user_id', user.id)

    if (search) {
      // Simplified search approach to avoid parsing errors
      // Search in local notes OR in paper title/abstract
      query = query.or(`notes.ilike.%${search}%,papers.title.ilike.%${search}%`)
    }

    if (collection) {
      // Filter by collection if specified
      query = query.eq('collection_id', collection)
    }

    if (source) {
      query = query.eq('papers.source', source)
    }

    // Sort
    if (sortBy === 'title') {
      query = query.order('title', { foreignTable: 'papers', ascending: sortOrder === 'asc' })
    } else if (sortBy === 'publication_date') {
      query = query.order('publication_date', { foreignTable: 'papers', ascending: sortOrder === 'asc' })
    } else if (sortBy === 'citation_count') {
      query = query.order('citation_count', { foreignTable: 'papers', ascending: sortOrder === 'asc' })
    } else {
      query = query.order(sortBy as any, { ascending: sortOrder === 'asc' })
    }

    const { data: papers, error } = await query

    if (error) throw error

    // Transform the data to include author names
    const transformedPapers = (papers || []).map((item: any) => ({
      ...item,
      paper: {
        ...item.papers,
        authors: item.papers.paper_authors?.sort((a: any, b: any) => a.ordinal - b.ordinal).map((pa: any) => pa.authors) || [],
        author_names: item.papers.paper_authors?.sort((a: any, b: any) => a.ordinal - b.ordinal).map((pa: any) => pa.authors.name) || []
      }
    }))

    return NextResponse.json({ papers: transformedPapers }, {
      headers: {
        'Cache-Control': 'no-store, max-age=0, must-revalidate',
        'Pragma': 'no-cache'
      }
    })

  } catch (error) {
    console.error('Library fetch error:', error)
    return NextResponse.json({ error: 'Failed to load library' }, { status: 500 })
  }
}

// POST - Add paper to library
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { paperId, notes } = await request.json()

    if (!paperId) {
      return NextResponse.json({ error: 'Paper ID is required' }, { status: 400 })
    }

    // Check if paper is already in user's library
    const { data: existingEntry, error: checkError } = await supabase
      .from('library_papers')
      .select('id')
      .eq('user_id', user.id)
      .eq('paper_id', paperId)
      .single()

    if (checkError && checkError.code !== 'PGRST116') {
      throw checkError
    }

    if (existingEntry) {
      return NextResponse.json({ 
        error: 'Paper is already in your library',
        code: 'DUPLICATE_ENTRY'
      }, { status: 409 })
    }

    // Add paper to user's library
    const { data, error } = await supabase
      .from('library_papers')
      .insert({
        user_id: user.id,
        paper_id: paperId,
        notes: notes || null
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, entry: data })

  } catch (error) {
    console.error('Library add error:', error)
    return NextResponse.json({ error: 'Failed to add paper to library' }, { status: 500 })
  }
}

// PUT - Update library paper notes
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const libraryPaperId = url.searchParams.get('id')
    
    if (!libraryPaperId) {
      return NextResponse.json({ error: 'Library paper ID is required' }, { status: 400 })
    }

    const { notes } = await request.json()

    // Verify ownership
    const { data: libraryPaper, error } = await supabase
      .from('library_papers')
      .select('id')
      .eq('id', libraryPaperId)
      .eq('user_id', user.id)
      .single()

    if (error || !libraryPaper) {
      return NextResponse.json({ error: 'Library paper not found' }, { status: 404 })
    }

    await updateLibraryPaperNotes(libraryPaperId, notes || '')

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error in library PUT API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

// DELETE - Remove paper from library
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const paperId = url.searchParams.get('paperId')
    
    if (!paperId) {
      return NextResponse.json({ error: 'Paper ID is required' }, { status: 400 })
    }

    // First check if paper exists in user's library
    const { data: existingPaper, error: checkError } = await supabase
      .from('library_papers')
      .select('id')
      .eq('user_id', user.id)
      .eq('paper_id', paperId)
      .single()

    if (checkError && checkError.code !== 'PGRST116') { // PGRST116 is "not found"
      console.error('Error checking paper existence:', checkError)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    if (!existingPaper) {
      return NextResponse.json({ error: 'Paper not found in library' }, { status: 404 })
    }

    await removePaperFromLibrary(user.id, paperId)

    return NextResponse.json({ success: true }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    })

  } catch (error) {
    console.error('Error in library DELETE API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
} 