import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPaper } from '@/lib/db/papers'
import { isInLibrary } from '@/lib/db/library'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: paperId } = await params

    if (!paperId) {
      return NextResponse.json({ error: 'Paper ID is required' }, { status: 400 })
    }

    // Get paper details
    const paper = await getPaper(paperId)
    if (!paper) {
      return NextResponse.json({ error: 'Paper not found' }, { status: 404 })
    }

    // Check if paper is in user's library
    const inLibrary = await isInLibrary(user.id, paperId)

    // Get usage statistics (how many times this paper has been cited in generated papers)
    const { data: citationStats, error: statsError } = await supabase
      .from('project_citations')
      .select('id')
      .eq('paper_id', paperId)

    const citationCount = statsError ? 0 : (citationStats?.length || 0)

    return NextResponse.json({
      ...paper,
      inLibrary,
      usageStats: {
        citedInProjects: citationCount
      }
    })

  } catch (error) {
    console.error('Error in papers/[id] GET API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
} 