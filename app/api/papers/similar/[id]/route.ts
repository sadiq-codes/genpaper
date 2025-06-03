import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { findSimilarPapers } from '@/lib/db/papers'

// GET - Find papers similar to a given paper
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paperId = params.id
    const url = new URL(request.url)
    const limit = parseInt(url.searchParams.get('limit') || '5')

    if (!paperId) {
      return NextResponse.json({ error: 'Paper ID is required' }, { status: 400 })
    }

    const similarPapers = await findSimilarPapers(paperId, limit)

    return NextResponse.json({
      papers: similarPapers,
      total: similarPapers.length,
      sourcePaperId: paperId
    })

  } catch (error) {
    console.error('Error in similar papers API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
} 