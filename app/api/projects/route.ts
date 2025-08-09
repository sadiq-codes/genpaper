import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserResearchProjects, deleteResearchProject, createResearchProject } from '@/lib/db/research'

// GET - Retrieve user's research projects
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const limitParam = url.searchParams.get('limit')
    const offsetParam = url.searchParams.get('offset')

    const limit = limitParam ? parseInt(limitParam) : 20
    const offset = offsetParam ? parseInt(offsetParam) : 0

    const projects = await getUserResearchProjects(user.id, limit, offset)

    return NextResponse.json({
      projects,
      total: projects.length,
      limit,
      offset
    })

  } catch (error) {
    console.error('Error in projects GET API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

// POST - Create a new research project
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { topic, paperType, selectedPapers } = body

    if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 })
    }

    // Create generation config
    const generationConfig: Record<string, unknown> = {
      paper_settings: {
        paperType: paperType || 'researchArticle'
      }
    }

    // Add selected papers if provided
    if (selectedPapers && Array.isArray(selectedPapers) && selectedPapers.length > 0) {
      generationConfig.library_papers_used = selectedPapers
    }

    const project = await createResearchProject(
      user.id,
      topic.trim(),
      generationConfig
    )

    return NextResponse.json({
      project,
      message: 'Project created successfully'
    })

  } catch (error) {
    console.error('Error in projects POST API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

// DELETE - Delete a research project
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const projectId = url.searchParams.get('projectId')
    
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID is required' }, { status: 400 })
    }

    // Verify ownership
    const { data: project, error } = await supabase
      .from('research_projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (error || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    await deleteResearchProject(projectId)

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error in projects DELETE API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
} 