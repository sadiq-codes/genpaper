import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import z from 'zod'
import { CitationService, BIBLIOGRAPHY_STYLES } from '@/lib/citations/immediate-bibliography'

/**
 * GET /api/citations/render-bibliography - Bibliography endpoint for references panel
 * 
 * Returns sorted bibliography entries for a project
 */

// Schema for bibliography rendering request
const RenderBibliographySchema = z.object({
  projectId: z.string().uuid(),
  style: z.enum(['apa', 'mla', 'chicago', 'ieee']).default('apa')
})

export async function GET(request: NextRequest) {
  try {
    // Authentication check
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse and validate query parameters
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')
    const style = searchParams.get('style')

    const queryData = {
      projectId,
      style: style || 'apa'
    }

    const validationResult = RenderBibliographySchema.safeParse(queryData)
    
    if (!validationResult.success) {
      return NextResponse.json({
        error: 'Validation failed',
        details: validationResult.error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }))
      }, { status: 400 })
    }

    const { projectId: validProjectId, style: validStyle } = validationResult.data

    // Verify project ownership
    const { data: project, error: projectError } = await supabase
      .from('research_projects')
      .select('id')
      .eq('id', validProjectId)
      .eq('user_id', user.id)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ 
        error: 'Project not found or access denied' 
      }, { status: 404 })
    }

    try {
      // Render bibliography using CitationService
      const bibliography = await CitationService.renderBibliography(
        validProjectId, 
        validStyle as keyof typeof BIBLIOGRAPHY_STYLES
      )

      // Success response
      return NextResponse.json({
        success: true,
        data: {
          projectId: validProjectId,
          style: validStyle,
          bibliography: bibliography.bibliography,
          citations: bibliography.citations,
          count: bibliography.count
        }
      })

    } catch (renderError) {
      console.error('Bibliography rendering failed:', renderError)
      return NextResponse.json({
        error: 'Rendering failed',
        message: renderError instanceof Error ? renderError.message : 'Failed to render bibliography'
      }, { status: 500 })
    }

  } catch (error) {
    console.error('Render bibliography API error:', error)
    return NextResponse.json({
      error: 'Internal server error',
      message: 'An unexpected error occurred'
    }, { status: 500 })
  }
}

// Also support POST for complex requests
export async function POST(request: NextRequest) {
  try {
    // Authentication check
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse and validate request body
    const body = await request.json()
    const validationResult = RenderBibliographySchema.safeParse(body)
    
    if (!validationResult.success) {
      return NextResponse.json({
        error: 'Validation failed',
        details: validationResult.error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }))
      }, { status: 400 })
    }

    const { projectId, style } = validationResult.data

    // Verify project ownership
    const { data: project, error: projectError } = await supabase
      .from('research_projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ 
        error: 'Project not found or access denied' 
      }, { status: 404 })
    }

    try {
      // Render bibliography using CitationService
      const bibliography = await CitationService.renderBibliography(
        projectId, 
        style as keyof typeof BIBLIOGRAPHY_STYLES
      )

      // Success response
      return NextResponse.json({
        success: true,
        data: {
          projectId,
          style,
          bibliography: bibliography.bibliography,
          citations: bibliography.citations,
          count: bibliography.count
        }
      })

    } catch (renderError) {
      console.error('Bibliography rendering failed:', renderError)
      return NextResponse.json({
        error: 'Rendering failed',
        message: renderError instanceof Error ? renderError.message : 'Failed to render bibliography'
      }, { status: 500 })
    }

  } catch (error) {
    console.error('Render bibliography POST API error:', error)
    return NextResponse.json({
      error: 'Internal server error',
      message: 'An unexpected error occurred'
    }, { status: 500 })
  }
}

// Method not allowed for other HTTP methods
export async function PUT() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
}

export async function DELETE() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
}