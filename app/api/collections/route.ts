import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
// Collection functions removed - collections are now simple text fields

// GET - Retrieve user's collections
export async function GET() {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // In the new schema, get distinct collection names from library_papers
    const { data: collections, error } = await supabase
      .from('library_papers')
      .select('collection')
      .eq('user_id', user.id)
      .not('collection', 'is', null)

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch collections' }, { status: 500 })
    }

    // Get unique collection names with counts
    const collectionCounts = new Map<string, number>()
    collections?.forEach(item => {
      if (item.collection) {
        collectionCounts.set(item.collection, (collectionCounts.get(item.collection) || 0) + 1)
      }
    })

    const collectionsWithCounts = Array.from(collectionCounts.entries()).map(([name, count]) => ({
      id: name, // Use name as ID in new schema
      name,
      paper_count: count,
      user_id: user.id,
      created_at: new Date().toISOString() // Placeholder since we don't track creation time anymore
    }))

    return NextResponse.json({
      collections: collectionsWithCounts
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

    // In the new schema, collections are just text values
    // We'll create a placeholder response that mimics the old structure
    const collection = {
      id: name.trim(), // Use name as ID in new schema
      name: name.trim(),
      description: description || null,
      user_id: user.id,
      paper_count: 0,
      created_at: new Date().toISOString()
    }

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

    // In the new schema, collections are just text values, not separate entities
    // Instead, we update any library papers that have this collection name
    const { error } = await supabase
      .from('library_papers')
      .update({ collection: null })
      .eq('user_id', user.id)
      .eq('collection', collectionId) // collectionId is now the collection name
    
    if (error) {
      return NextResponse.json({ error: 'Failed to clear collection' }, { status: 500 })
    }

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

    // In the new schema, collection operations are just updating the text field
    if (action === 'add') {
      // Set the collection field to the collection name
      const { error } = await supabase
        .from('library_papers')
        .update({ collection: collectionId }) // collectionId is now the collection name
        .eq('user_id', user.id)
        .eq('paper_id', paperId)
      
      if (error) {
        return NextResponse.json({ error: 'Failed to add paper to collection' }, { status: 500 })
      }
    } else if (action === 'remove') {
      // Clear the collection field
      const { error } = await supabase
        .from('library_papers')
        .update({ collection: null })
        .eq('user_id', user.id)
        .eq('paper_id', paperId)
        .eq('collection', collectionId)
      
      if (error) {
        return NextResponse.json({ error: 'Failed to remove paper from collection' }, { status: 500 })
      }
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