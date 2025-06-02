import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { 
  addPaperToLibrary, 
  removePaperFromLibrary, 
  getUserLibraryPapers,
  updateLibraryPaperNotes,
  isInLibrary
} from '@/lib/db/library'
import { getPaper } from '@/lib/db/papers'
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

    const url = new URL(request.url)
    const search = url.searchParams.get('search')
    const collectionId = url.searchParams.get('collection')
    const source = url.searchParams.get('source')
    const sortBy = url.searchParams.get('sortBy') as 'added_at' | 'title' | 'publication_date' | 'citation_count'
    const sortOrder = url.searchParams.get('sortOrder') as 'asc' | 'desc'
    const limitParam = url.searchParams.get('limit')
    const offsetParam = url.searchParams.get('offset')

    const filters: LibraryFilters = {
      search: search || undefined,
      collectionId: collectionId || undefined,
      source: source || undefined,
      sortBy: sortBy || 'added_at',
      sortOrder: sortOrder || 'desc'
    }

    const limit = limitParam ? parseInt(limitParam) : 20
    const offset = offsetParam ? parseInt(offsetParam) : 0

    const libraryPapers = await getUserLibraryPapers(user.id, filters, limit, offset)

    return NextResponse.json({
      papers: libraryPapers,
      total: libraryPapers.length,
      limit,
      offset
    })

  } catch (error) {
    console.error('Error in library GET API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
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

    const body: AddToLibraryRequest = await request.json()
    const { paperId, notes } = body

    if (!paperId) {
      return NextResponse.json({ error: 'Paper ID is required' }, { status: 400 })
    }

    // Check if paper exists
    const paper = await getPaper(paperId)
    if (!paper) {
      return NextResponse.json({ error: 'Paper not found' }, { status: 404 })
    }

    // Check if already in library
    const inLibrary = await isInLibrary(user.id, paperId)
    if (inLibrary) {
      return NextResponse.json({ error: 'Paper already in library' }, { status: 409 })
    }

    // Add to library
    const libraryPaper = await addPaperToLibrary(user.id, paperId, notes)

    const response: AddToLibraryResponse = {
      success: true,
      libraryPaper
    }

    return NextResponse.json(response, { status: 201 })

  } catch (error) {
    console.error('Error in library POST API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
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

    await removePaperFromLibrary(user.id, paperId)

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error in library DELETE API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
} 