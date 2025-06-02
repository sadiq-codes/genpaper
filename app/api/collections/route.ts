import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { 
  createCollection, 
  getUserCollections, 
  deleteCollection,
  addPaperToCollection,
  removePaperFromCollection
} from '@/lib/db/library'

// GET - Retrieve user's collections
export async function GET() {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const collections = await getUserCollections(user.id)

    return NextResponse.json({
      collections
    })

  } catch (error) {
    console.error('Error in collections GET API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

// POST - Create a new collection
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { name, description } = await request.json()

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Collection name is required' }, { status: 400 })
    }

    const collection = await createCollection(user.id, name.trim(), description)

    return NextResponse.json(collection, { status: 201 })

  } catch (error) {
    console.error('Error in collections POST API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

// DELETE - Delete a collection
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const collectionId = url.searchParams.get('id')
    
    if (!collectionId) {
      return NextResponse.json({ error: 'Collection ID is required' }, { status: 400 })
    }

    // Verify ownership
    const { data: collection, error } = await supabase
      .from('library_collections')
      .select('id')
      .eq('id', collectionId)
      .eq('user_id', user.id)
      .single()

    if (error || !collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    }

    await deleteCollection(collectionId)

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error in collections DELETE API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

// PUT - Add/remove paper from collection
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { collectionId, paperId, action } = await request.json()

    if (!collectionId || !paperId || !action) {
      return NextResponse.json({ 
        error: 'Collection ID, paper ID, and action (add/remove) are required' 
      }, { status: 400 })
    }

    // Verify collection ownership
    const { data: collection, error } = await supabase
      .from('library_collections')
      .select('id')
      .eq('id', collectionId)
      .eq('user_id', user.id)
      .single()

    if (error || !collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    }

    if (action === 'add') {
      await addPaperToCollection(collectionId, paperId)
    } else if (action === 'remove') {
      await removePaperFromCollection(collectionId, paperId)
    } else {
      return NextResponse.json({ error: 'Invalid action. Use "add" or "remove"' }, { status: 400 })
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error in collections PUT API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
} 