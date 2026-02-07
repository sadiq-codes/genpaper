import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/projects/paper-counts?ids=xxx&ids=yyy
 * Returns paper counts for the given project IDs.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const ids = request.nextUrl.searchParams.getAll('ids')
    if (ids.length === 0) {
      return NextResponse.json({ counts: {} })
    }

    const { data: citations, error } = await supabase
      .from('project_citations')
      .select('project_id, paper_id')
      .in('project_id', ids)

    if (error) {
      console.error('Failed to fetch citation counts:', error)
      return NextResponse.json({ error: 'Failed to fetch counts' }, { status: 500 })
    }

    const counts: Record<string, number> = {}
    const seen = new Map<string, Set<string>>()

    for (const row of citations || []) {
      if (!row.project_id || !row.paper_id) continue
      if (!seen.has(row.project_id)) seen.set(row.project_id, new Set())
      seen.get(row.project_id)!.add(row.paper_id)
    }

    for (const [projectId, papers] of seen) {
      counts[projectId] = papers.size
    }

    return NextResponse.json({ counts })
  } catch (error) {
    console.error('Error in paper-counts API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
