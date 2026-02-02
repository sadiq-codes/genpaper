import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isGenerationLocked } from '@/lib/locks/generation-lock'

/**
 * GET /api/generate/status?projectId=xxx
 * 
 * Check the status of paper generation for a project.
 * Used by the client to check if generation is still running after reconnection.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const projectId = request.nextUrl.searchParams.get('projectId')
    if (!projectId) {
      return NextResponse.json({ error: 'Missing projectId parameter' }, { status: 400 })
    }

    // Verify user owns the project
    const { data: project, error: projectError } = await supabase
      .from('research_projects')
      .select('id, content, updated_at')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Check if generation is still running
    const isRunning = await isGenerationLocked(projectId)

    // Get content info
    const hasContent = !!project.content && project.content.trim().length > 0
    const contentLength = project.content?.length || 0

    return NextResponse.json({
      projectId,
      isGenerating: isRunning,
      hasContent,
      contentLength,
      updatedAt: project.updated_at,
    })
  } catch (error) {
    console.error('Error checking generation status:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
