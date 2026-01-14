import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import z from 'zod'
import { CitationService } from '@/lib/citations/immediate-bibliography'
import { citationLogger } from '@/lib/utils/citation-logger'

/**
 * GET /api/citations/render-inline - Inline render service for UI/AI replacement
 * 
 * Renders citations in various styles for display in UI components
 */

// Schema for inline rendering request
// style accepts any CSL style ID string (e.g., 'apa', 'ieee', 'nature', 'chicago-author-date')
const RenderInlineSchema = z.object({
  projectId: z.string().uuid(),
  citeKeys: z.array(z.string().min(1)).min(1).max(100), // Limit to 100 citations per request
  style: z.string().min(1).max(100).default('apa') // Any CSL style ID
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
    const citeKeysParam = searchParams.get('citeKeys') // Comma-separated
    const style = searchParams.get('style')

    // Prepare data for validation
    const citeKeys = citeKeysParam ? citeKeysParam.split(',').map(k => k.trim()).filter(Boolean) : []
    const queryData = {
      projectId,
      citeKeys,
      style: style || 'apa'
    }

    const validationResult = RenderInlineSchema.safeParse(queryData)
    
    if (!validationResult.success) {
      return NextResponse.json({
        error: 'Validation failed',
        details: validationResult.error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }))
      }, { status: 400 })
    }

    const { projectId: validProjectId, citeKeys: validCiteKeys, style: validStyle } = validationResult.data

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
      const timer = citationLogger.startTimer()
      
      // Render citations with paper info using optimized method
      const results = await CitationService.renderInlineWithPaperInfo({
        projectId: validProjectId,
        citeKeys: validCiteKeys,
        style: validStyle
      })

      // Log successful rendering
      const metrics = timer.end()
      citationLogger.logRenderPerformance({
        operation: 'render_inline',
        projectId: validProjectId,
        metrics,
        style: validStyle,
        citationCount: validCiteKeys.length,
        renderType: 'inline'
      })

      // Success response with paper info included
      return NextResponse.json({
        success: true,
        data: {
          projectId: validProjectId,
          style: validStyle,
          citations: results.map(r => ({
            citeKey: r.citeKey,
            rendered: r.rendered,
            found: !!r.rendered,
            paper: r.paper  // Include paper info to eliminate separate API calls
          })),
          total: validCiteKeys.length,
          rendered: results.filter(r => r.rendered.length > 0).length
        }
      })

    } catch (renderError) {
      citationLogger.logRenderFailed({
        operation: 'render_inline',
        projectId: validProjectId,
        error: renderError instanceof Error ? renderError : new Error('Unknown error'),
        style: validStyle,
        citationCount: validCiteKeys.length,
        renderType: 'inline'
      })
      
      return NextResponse.json({
        error: 'Rendering failed',
        message: renderError instanceof Error ? renderError.message : 'Failed to render citations'
      }, { status: 500 })
    }

  } catch (error) {
    console.error('Render inline API error:', error)
    return NextResponse.json({
      error: 'Internal server error',
      message: 'An unexpected error occurred'
    }, { status: 500 })
  }
}

// Also support POST for larger payloads
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
    const validationResult = RenderInlineSchema.safeParse(body)
    
    if (!validationResult.success) {
      return NextResponse.json({
        error: 'Validation failed',
        details: validationResult.error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }))
      }, { status: 400 })
    }

    const { projectId, citeKeys, style } = validationResult.data

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
      // Render citations with paper info using optimized method
      const results = await CitationService.renderInlineWithPaperInfo({
        projectId,
        citeKeys,
        style
      })

      // Success response with paper info included
      return NextResponse.json({
        success: true,
        data: {
          projectId,
          style,
          citations: results.map(r => ({
            citeKey: r.citeKey,
            rendered: r.rendered,
            found: !!r.rendered,
            paper: r.paper  // Include paper info to eliminate separate API calls
          })),
          total: citeKeys.length,
          rendered: results.filter(r => r.rendered.length > 0).length
        }
      })

    } catch (renderError) {
      console.error('Citation rendering failed:', renderError)
      return NextResponse.json({
        error: 'Rendering failed',
        message: renderError instanceof Error ? renderError.message : 'Failed to render citations'
      }, { status: 500 })
    }

  } catch (error) {
    console.error('Render inline POST API error:', error)
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