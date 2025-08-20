import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { 
  getUserLibraryPapers, 
  addPaperToLibrary, 
  removePaperFromLibrary
} from '@/lib/db/library'

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
    const collection = url.searchParams.get('collection')
    const source = url.searchParams.get('source')
    const sortBy = url.searchParams.get('sortBy') || 'added_at'
    const sortOrder = url.searchParams.get('sortOrder') || 'desc'
    const paperId = url.searchParams.get('paperId')
    const id = url.searchParams.get('id')

    // If querying specific paper
    if (paperId || id) {
      const targetId = paperId || id
      const papers = await getUserLibraryPapers(user.id, {
        search: targetId || undefined,
        sortBy: sortBy as any,
        sortOrder: sortOrder as 'asc' | 'desc'
      })
      
      const paper = papers.find(p => p.paper_id === targetId || p.id === targetId)
      return NextResponse.json({ paper })
    }

    const papers = await getUserLibraryPapers(user.id, {
      search: search || undefined,
      collectionId: collection || undefined,
      source: source || undefined,
      sortBy: sortBy as any,
      sortOrder: sortOrder as 'asc' | 'desc'
    })

    return NextResponse.json({ papers })

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

    const body = await request.json()
    const { paperId, collectionId } = body as { paperId?: string, collectionId?: string }

    if (!paperId) {
      return NextResponse.json({ error: 'Paper ID is required' }, { status: 400 })
    }

    const libraryPaper = await addPaperToLibrary(user.id, paperId, collectionId)

    return NextResponse.json({ 
      success: true,
      libraryPaper 
    })

  } catch (error) {
    console.error('Error in library POST API:', error)
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
    const libraryPaperId = url.searchParams.get('id')

    if (!libraryPaperId) {
      return NextResponse.json({ error: 'Library paper ID is required' }, { status: 400 })
    }

    await removePaperFromLibrary(libraryPaperId, user.id)

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error in library DELETE API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}