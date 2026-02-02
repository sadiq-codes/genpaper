import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { paperId, notes } = body

    if (!paperId) {
      return NextResponse.json({ error: 'Paper ID is required' }, { status: 400 })
    }

    // Update notes in library_papers
    const { error: updateError } = await supabase
      .from('library_papers')
      .update({ notes: notes || null })
      .eq('user_id', user.id)
      .eq('paper_id', paperId)

    if (updateError) {
      console.error('Failed to update notes:', updateError)
      return NextResponse.json({ error: 'Failed to update notes' }, { status: 500 })
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error in library/notes PUT API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}
