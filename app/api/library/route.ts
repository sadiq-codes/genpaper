import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { 
  removePaperFromLibrary, 
  updateLibraryPaperNotes,
} from '@/lib/db/library'





// GET - Deprecated: Redirect to unified papers API
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    
    // Build unified API URL
    const params = new URLSearchParams({ library: 'me' })
    
    if (searchParams.get('search')) params.set('search', searchParams.get('search')!)
    if (searchParams.get('collection')) params.set('collection', searchParams.get('collection')!)
    if (searchParams.get('sortBy')) params.set('sortBy', searchParams.get('sortBy')!)
    if (searchParams.get('sortOrder')) params.set('sortOrder', searchParams.get('sortOrder')!)

    const unifiedUrl = `/api/papers?${params.toString()}`
    
    return NextResponse.json({
      message: 'This endpoint has been deprecated. Please use the unified papers API.',
      redirectTo: unifiedUrl,
      migration: {
        old: 'GET /api/library',
        new: `GET ${unifiedUrl}`,
        note: 'Use library=me parameter with unified papers API'
      }
    }, { 
      status: 301,
      headers: {
        'Location': unifiedUrl,
        'X-Deprecated': 'true',
        'X-Migration-Guide': 'Use GET /api/papers?library=me'
      }
         })

  } catch (error) {
    console.error('Error in legacy library endpoint:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
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