import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { 
  getProjectCitationStyle,
  updateProjectCitationStyle 
} from '@/lib/citations/citation-settings'
import { isValidCitationStyle, type CitationStyle } from '@/lib/citations/unified-service'

/**
 * GET /api/projects/[id]/settings
 * Get project-specific settings
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    
    const { id: projectId } = await params
    
    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      )
    }
    
    // Verify project belongs to user
    const { data: project, error: projectError } = await supabase
      .from('research_projects')
      .select('id, citation_style')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()
    
    if (projectError || !project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      )
    }
    
    // Get effective citation style (project override or user default)
    const effectiveStyle = await getProjectCitationStyle(projectId, user.id)
    
    return NextResponse.json({
      settings: {
        citation_style: project.citation_style, // Project-specific (null = use default)
        effective_citation_style: effectiveStyle // Actual style being used
      }
    })
  } catch (error) {
    console.error('Error getting project settings:', error)
    return NextResponse.json(
      { error: 'Failed to get project settings' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/projects/[id]/settings
 * Update project-specific settings
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    
    const { id: projectId } = await params
    
    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      )
    }
    
    const body = await request.json()
    const { citation_style } = body
    
    // citation_style can be null (use default) or a valid style
    if (citation_style !== null && citation_style !== undefined) {
      if (!isValidCitationStyle(citation_style)) {
        return NextResponse.json(
          { error: 'Invalid citation style. Must be one of: apa, mla, chicago, ieee, harvard, or null to use default' },
          { status: 400 }
        )
      }
    }
    
    const result = await updateProjectCitationStyle(
      projectId,
      user.id,
      citation_style as CitationStyle | null
    )
    
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to update project settings' },
        { status: 500 }
      )
    }
    
    // Get updated effective style
    const effectiveStyle = await getProjectCitationStyle(projectId, user.id)
    
    return NextResponse.json({
      success: true,
      settings: {
        citation_style: citation_style,
        effective_citation_style: effectiveStyle
      }
    })
  } catch (error) {
    console.error('Error updating project settings:', error)
    return NextResponse.json(
      { error: 'Failed to update project settings' },
      { status: 500 }
    )
  }
}
