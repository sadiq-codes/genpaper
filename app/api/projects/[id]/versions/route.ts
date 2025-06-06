import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

    const resolvedParams = await params
    const projectId = resolvedParams.id

    // Get project versions
    const { data: versions, error } = await supabase
      .from('research_project_versions')
      .select('*')
      .eq('project_id', projectId)
      .order('version', { ascending: false })

    if (error) {
      console.error('Error fetching project versions:', error)
      return NextResponse.json({ error: 'Failed to fetch versions' }, { status: 500 })
    }

    return NextResponse.json({
      versions,
      count: versions.length
    })

  } catch (error) {
    console.error('Error in versions endpoint:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 