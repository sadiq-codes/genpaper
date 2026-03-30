import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { handleError, requireAuth } from '@/lib/api/helpers'

export async function PUT(request: NextRequest) {
  try {
    const user = await requireAuth()
    const supabase = await createClient()

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
    return handleError(error, 'Error in library/notes PUT API')
  }
}
