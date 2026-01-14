import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { CitationService } from '@/lib/citations/immediate-bibliography'

/**
 * POST /api/citations/backfill
 * Backfill CSL JSON for papers in a project that are missing it.
 * 
 * This is useful for existing projects where papers were added before
 * the CSL JSON generation was integrated into the add-paper flow.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { projectId } = await request.json()

    if (!projectId) {
      return NextResponse.json(
        { error: 'Missing projectId' },
        { status: 400 }
      )
    }

    // Verify user owns the project
    const { data: project, error: projectError } = await supabase
      .from('research_projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Run backfill
    const result = await CitationService.backfillProjectCitations(projectId)

    return NextResponse.json({
      success: true,
      processed: result.processed,
      errors: result.errors,
      message: `Backfilled ${result.processed} citations${result.errors.length > 0 ? ` with ${result.errors.length} errors` : ''}`
    })

  } catch (error) {
    console.error('Citation backfill error:', error)
    return NextResponse.json(
      { error: 'Failed to backfill citations' },
      { status: 500 }
    )
  }
}
