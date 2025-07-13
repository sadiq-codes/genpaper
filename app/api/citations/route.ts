import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'


// Schema for citation creation/updates
const CitationCreateSchema = z.object({
  projectId: z.string().uuid(),
  key: z.string().min(1),
  paperId: z.string().optional(),
  csl_json: z.object({}).passthrough(), // CSL-JSON object
  citation_text: z.string().optional(),
  context: z.string().optional()
})

const CitationUpdateSchema = z.object({
  csl_json: z.object({}).passthrough().optional(),
  citation_text: z.string().optional(),
  context: z.string().optional()
})

const BatchCreateSchema = z.object({
  projectId: z.string().uuid(),
  citations: z.array(z.object({
    key: z.string().min(1),
    paperId: z.string().optional(),
    csl_json: z.object({}).passthrough(),
    citation_text: z.string().optional(),
    context: z.string().optional()
  }))
})

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const projectId = url.searchParams.get('projectId')
    const key = url.searchParams.get('key')
    const style = url.searchParams.get('style') || 'apa'

    // Get citations for a specific project
    if (projectId) {
      let query = supabase
        .from('citations')
        .select('*')
        .eq('project_id', projectId)

      if (key) {
        query = query.eq('key', key)
      }

      const { data: citations, error } = await query.order('created_at')

      if (error) throw error

      if (key && citations.length === 0) {
        return NextResponse.json({ error: 'Citation not found' }, { status: 404 })
      }

      return NextResponse.json({
        citations: citations.map(citation => ({
          id: citation.id,
          key: citation.key,
          projectId: citation.project_id,
          paperId: citation.paper_id,
          csl_json: citation.csl_json,
          citation_text: citation.citation_text,
          context: citation.context,
          createdAt: citation.created_at,
          updatedAt: citation.updated_at
        })),
        count: citations.length,
        style
      })
    }

    // Get all user's citations across projects
    const { data: projects, error: projectsError } = await supabase
      .from('research_projects')
      .select('id')
      .eq('user_id', user.id)

    if (projectsError) throw projectsError

    const projectIds = projects.map(p => p.id)

    if (projectIds.length === 0) {
      return NextResponse.json({ citations: [], count: 0 })
    }

    const { data: citations, error } = await supabase
      .from('citations')
      .select(`
        *,
        research_projects!inner (
          id,
          topic,
          user_id
        )
      `)
      .in('project_id', projectIds)
      .order('created_at', { ascending: false })

    if (error) throw error

    return NextResponse.json({
      citations: citations.map(citation => ({
        id: citation.id,
        key: citation.key,
        projectId: citation.project_id,
        projectTopic: citation.research_projects?.topic,
        paperId: citation.paper_id,
        csl_json: citation.csl_json,
        citation_text: citation.citation_text,
        context: citation.context,
        createdAt: citation.created_at,
        updatedAt: citation.updated_at
      })),
      count: citations.length
    })

  } catch (error) {
    console.error('Error in citations GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    // Handle batch creation
    if (body.citations && Array.isArray(body.citations)) {
      const validationResult = BatchCreateSchema.safeParse(body)
      
      if (!validationResult.success) {
        return NextResponse.json(
          { 
            error: 'Invalid batch citation data',
            details: validationResult.error.errors.map(e => ({
              path: e.path.join('.'),
              message: e.message
            }))
          },
          { status: 400 }
        )
      }

      const { projectId, citations } = validationResult.data

      // Verify project ownership
      const { data: project, error: projectError } = await supabase
        .from('research_projects')
        .select('id')
        .eq('id', projectId)
        .eq('user_id', user.id)
        .single()

      if (projectError || !project) {
        return NextResponse.json({ error: 'Project not found or access denied' }, { status: 404 })
      }

      // Insert citations in batch
      const citationInserts = citations.map(citation => ({
        project_id: projectId,
        key: citation.key,
        paper_id: citation.paperId,
        csl_json: citation.csl_json,
        citation_text: citation.citation_text,
        context: citation.context
      }))

      const { data, error } = await supabase
        .from('citations')
        .insert(citationInserts)
        .select()

      if (error) throw error

      return NextResponse.json({
        success: true,
        citations: data,
        count: data.length
      }, { status: 201 })
    }

    // Handle single citation creation
    const validationResult = CitationCreateSchema.safeParse(body)
    
    if (!validationResult.success) {
      return NextResponse.json(
        { 
          error: 'Invalid citation data',
          details: validationResult.error.errors.map(e => ({
            path: e.path.join('.'),
            message: e.message
          }))
        },
        { status: 400 }
      )
    }

    const { projectId, key, paperId, csl_json, citation_text, context } = validationResult.data

    // Verify project ownership
    const { data: project, error: projectError } = await supabase
      .from('research_projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found or access denied' }, { status: 404 })
    }

    // Insert citation
    const { data, error } = await supabase
      .from('citations')
      .insert({
        project_id: projectId,
        key,
        paper_id: paperId,
        csl_json,
        citation_text,
        context
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') { // Unique constraint violation
        return NextResponse.json({ 
          error: 'Citation with this key already exists for this project' 
        }, { status: 409 })
      }
      throw error
    }

    return NextResponse.json({
      success: true,
      citation: {
        id: data.id,
        key: data.key,
        projectId: data.project_id,
        paperId: data.paper_id,
        csl_json: data.csl_json,
        citation_text: data.citation_text,
        context: data.context,
        createdAt: data.created_at,
        updatedAt: data.updated_at
      }
    }, { status: 201 })

  } catch (error) {
    console.error('Error in citations POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const citationId = url.searchParams.get('id')

    if (!citationId) {
      return NextResponse.json({ error: 'Citation ID is required' }, { status: 400 })
    }

    const body = await request.json()
    const validationResult = CitationUpdateSchema.safeParse(body)
    
    if (!validationResult.success) {
      return NextResponse.json(
        { 
          error: 'Invalid update data',
          details: validationResult.error.errors.map(e => ({
            path: e.path.join('.'),
            message: e.message
          }))
        },
        { status: 400 }
      )
    }

    const updates = validationResult.data

    // Verify citation ownership through project
    const { data: citation, error: citationError } = await supabase
      .from('citations')
      .select(`
        id,
        research_projects!inner (
          user_id
        )
      `)
      .eq('id', citationId)
      .single()

    if (citationError || !citation || citation.research_projects?.user_id !== user.id) {
      return NextResponse.json({ error: 'Citation not found or access denied' }, { status: 404 })
    }

    // Update citation
    const { data, error } = await supabase
      .from('citations')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', citationId)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({
      success: true,
      citation: {
        id: data.id,
        key: data.key,
        projectId: data.project_id,
        paperId: data.paper_id,
        csl_json: data.csl_json,
        citation_text: data.citation_text,
        context: data.context,
        createdAt: data.created_at,
        updatedAt: data.updated_at
      }
    })

  } catch (error) {
    console.error('Error in citations PUT:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const citationId = url.searchParams.get('id')
    const projectId = url.searchParams.get('projectId')

    if (citationId) {
      // Delete single citation
      const { data: citation, error: citationError } = await supabase
        .from('citations')
        .select(`
          id,
          research_projects!inner (
            user_id
          )
        `)
        .eq('id', citationId)
        .single()

      if (citationError || !citation || (citation.research_projects as any)?.user_id !== user.id) {
        return NextResponse.json({ error: 'Citation not found or access denied' }, { status: 404 })
      }

      const { error } = await supabase
        .from('citations')
        .delete()
        .eq('id', citationId)

      if (error) throw error

      return NextResponse.json({ success: true, message: 'Citation deleted' })

    } else if (projectId) {
      // Delete all citations for a project
      const { data: project, error: projectError } = await supabase
        .from('research_projects')
        .select('id')
        .eq('id', projectId)
        .eq('user_id', user.id)
        .single()

      if (projectError || !project) {
        return NextResponse.json({ error: 'Project not found or access denied' }, { status: 404 })
      }

      const { data, error } = await supabase
        .from('citations')
        .delete()
        .eq('project_id', projectId)
        .select('id')

      if (error) throw error

      return NextResponse.json({ 
        success: true, 
        message: `Deleted ${data.length} citations`,
        deletedCount: data.length
      })

    } else {
      return NextResponse.json({ 
        error: 'Either citation ID or project ID is required' 
      }, { status: 400 })
    }

  } catch (error) {
    console.error('Error in citations DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 