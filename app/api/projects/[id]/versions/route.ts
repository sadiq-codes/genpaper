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

    // Since versioning was simplified, just return the project content
    const { data: project, error } = await supabase
      .from('research_projects')
      .select('id, content, created_at, status')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (error) {
      console.error('Error fetching project:', error)
      return NextResponse.json({ error: 'Failed to fetch project' }, { status: 500 })
    }

    // Return single version (simplified system)
    const versions = project ? [{
      id: project.id,
      project_id: project.id,
      version: 1,
      content: project.content,
      created_at: project.created_at
    }] : []

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