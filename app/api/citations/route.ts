import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import z from 'zod'

import { CitationService } from '@/lib/citations/immediate-bibliography'

// Schema for citation creation/updates
const CitationCreateSchema = z.object({
  projectId: z.string().uuid(),
  paperId: z.string().uuid(),
  reason: z.string().optional(),
  quote: z.string().optional()
})

const CitationUpdateSchema = z.object({
  reason: z.string().optional(),
  quote: z.string().optional()
})

// Schema for batch citation resolution (placeholder-based)
const BatchResolveSchema = z.object({
  projectId: z.string().uuid(),
  refs: z.array(z.object({
    type: z.enum(['doi', 'paperId', 'title', 'url']),
    value: z.string().min(1),
    context: z.string().optional(),
    fallbackText: z.string().optional()
  })).min(1),
  style: z.enum(['apa', 'mla', 'chicago', 'ieee']).optional().default('apa')
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
    const paperId = url.searchParams.get('paperId')

    // Get citations for a specific project
    if (projectId) {
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

      let query = supabase
        .from('project_citations')
        .select(`
          id,
          paper_id,
          citation_number,
          reason,
          quote,
          csl_json,
          cite_key,
          first_seen_order,
          created_at,
          updated_at,
          papers (
            id,
            title,
            authors,
            publication_date,
            venue,
            doi
          )
        `)
        .eq('project_id', projectId)

      if (paperId) {
        query = query.eq('paper_id', paperId)
      }

      const { data: citations, error } = await query.order('first_seen_order', { ascending: true })

      if (error) throw error

      if (paperId && citations.length === 0) {
        return NextResponse.json({ error: 'Citation not found' }, { status: 404 })
      }

      return NextResponse.json({
        citations: citations.map((citation) => ({
          id: citation.id,
          projectId,
          paperId: citation.paper_id,
          citeKey: citation.cite_key,
          citationNumber: citation.first_seen_order || citation.citation_number,
          csl_json: citation.csl_json,
          reason: citation.reason,
          quote: citation.quote,
          paper: citation.papers,
          createdAt: citation.created_at,
          updatedAt: citation.updated_at
        })),
        count: citations.length
      })
    }

    // Get all user's citations across projects
    const { data: projects, error: projectsError } = await supabase
      .from('research_projects')
      .select('id')
      .eq('user_id', user.id)

    if (projectsError) throw projectsError

    const projectIds = projects.map((p) => p.id)

    if (projectIds.length === 0) {
      return NextResponse.json({ citations: [], count: 0 })
    }

    const { data: citations, error } = await supabase
      .from('project_citations')
      .select(`
        id,
        project_id,
        paper_id,
        citation_number,
        reason,
        quote,
        csl_json,
        cite_key,
        first_seen_order,
        created_at,
        updated_at,
        papers (
          id,
          title,
          authors,
          publication_date,
          venue,
          doi
        ),
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
      citations: citations.map((citation) => ({
        id: citation.id,
        projectId: citation.project_id,
        projectTopic: (citation.research_projects as { topic?: string })?.topic,
        paperId: citation.paper_id,
        citeKey: citation.cite_key,
        citationNumber: citation.first_seen_order || citation.citation_number,
        csl_json: citation.csl_json,
        reason: citation.reason,
        quote: citation.quote,
        paper: citation.papers,
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

    // Handle batch resolution (placeholder-based citations)
    if (body.refs && Array.isArray(body.refs)) {
      const validationResult = BatchResolveSchema.safeParse(body)
      
      if (!validationResult.success) {
        return NextResponse.json(
          { 
            error: 'Invalid batch resolve data',
            details: validationResult.error.errors.map((e) => ({
              path: e.path.join('.'),
              message: e.message
            }))
          },
          { status: 400 }
        )
      }

      const { projectId, refs, style } = validationResult.data

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

      // Process batch citations via CitationService with DOI/title resolution
      const citeKeyMap: Record<string, string> = {}
      const results: Array<{ ref: typeof refs[0]; success: boolean; citation?: unknown; error?: string }> = []

      for (const ref of refs) {
        try {
          let resolvedPaperId: string | null = null

          if (ref.type === 'paperId') {
            resolvedPaperId = ref.value
          } else if (ref.type === 'doi') {
            resolvedPaperId = await CitationService.resolveSourceRef({ doi: ref.value }, projectId)
          } else if (ref.type === 'title') {
            resolvedPaperId = await CitationService.resolveSourceRef({ title: ref.value }, projectId)
          } else if (ref.type === 'url') {
            const doiMatch = ref.value.match(/doi\.org\/([^\s?#]+)/i)
            if (doiMatch?.[1]) {
              resolvedPaperId = await CitationService.resolveSourceRef({ doi: doiMatch[1] }, projectId)
            }
          }

          if (resolvedPaperId) {
            const result = await CitationService.add({
              projectId,
              sourceRef: { paperId: resolvedPaperId },
              reason: ref.context || 'batch citation',
              quote: null
            })

            const citeKey = `${ref.type}:${ref.value}`
            const inlineText = await CitationService.renderInline(
              result.cslJson as Parameters<typeof CitationService.renderInline>[0],
              style,
              1
            )

            citeKeyMap[citeKey] = inlineText
            results.push({ 
              ref, 
              success: true, 
              citation: {
                citeKey: result.citeKey,
                isNew: result.isNew,
                formatted: inlineText
              }
            })
          } else {
            const fallback = ref.fallbackText || `(${ref.value})`
            const citeKey = `${ref.type}:${ref.value}`
            citeKeyMap[citeKey] = fallback
            results.push({ ref, success: true, citation: { formatted: fallback } })
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error'
          results.push({ ref, success: false, error: errorMsg })
          const citeKey = `${ref.type}:${ref.value}`
          const fallback = ref.fallbackText || `[ERROR: ${ref.value}]`
          citeKeyMap[citeKey] = fallback
        }
      }

      return NextResponse.json({
        success: true,
        citeKeyMap,
        results,
        processed: refs.length,
        successful: results.filter(r => r.success).length
      })
    }

    // Handle single citation creation via CitationService
    const validationResult = CitationCreateSchema.safeParse(body)
    
    if (!validationResult.success) {
      return NextResponse.json(
        { 
          error: 'Invalid citation data',
          details: validationResult.error.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message
          }))
        },
        { status: 400 }
      )
    }

    const { projectId, paperId, reason, quote } = validationResult.data

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

    // Use CitationService for consistent citation handling
    try {
      const result = await CitationService.add({
        projectId,
        sourceRef: { paperId },
        reason: reason || 'manual',
        quote: quote || null
      })
      
      // Fetch the full citation record
      const { data: citation } = await supabase
        .from('project_citations')
        .select(`
          id,
          paper_id,
          first_seen_order,
          csl_json,
          cite_key,
          created_at,
          papers (
            id,
            title,
            authors,
            publication_date,
            venue,
            doi
          )
        `)
        .eq('id', result.projectCitationId)
        .single()

      return NextResponse.json({ 
        success: true, 
        citation: {
          id: citation?.id || result.projectCitationId,
          projectId,
          paperId,
          citeKey: result.citeKey,
          citationNumber: citation?.first_seen_order || 1,
          csl_json: result.cslJson,
          reason,
          quote,
          paper: citation?.papers,
          isNew: result.isNew,
          createdAt: citation?.created_at || new Date().toISOString()
        }
      }, { status: 201 })
    } catch (error) {
      console.error('CitationService.add failed:', error)
      return NextResponse.json({ 
        error: error instanceof Error ? error.message : 'Citation service error' 
      }, { status: 400 })
    }

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
          details: validationResult.error.errors.map((e) => ({
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
      .from('project_citations')
      .select(`
        id,
        project_id,
        research_projects!inner (
          user_id
        )
      `)
      .eq('id', citationId)
      .single()

    if (citationError || !citation || (citation.research_projects as { user_id?: string })?.user_id !== user.id) {
      return NextResponse.json({ error: 'Citation not found or access denied' }, { status: 404 })
    }

    // Update citation
    const { data, error } = await supabase
      .from('project_citations')
      .update({
        reason: updates.reason,
        quote: updates.quote,
        updated_at: new Date().toISOString()
      })
      .eq('id', citationId)
      .select(`
        id,
        project_id,
        paper_id,
        citation_number,
        reason,
        quote,
        csl_json,
        cite_key,
        first_seen_order,
        created_at,
        updated_at
      `)
      .single()

    if (error) throw error

    return NextResponse.json({
      success: true,
      citation: {
        id: data.id,
        projectId: data.project_id,
        paperId: data.paper_id,
        citeKey: data.cite_key,
        citationNumber: data.first_seen_order || data.citation_number,
        csl_json: data.csl_json,
        reason: data.reason,
        quote: data.quote,
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
        .from('project_citations')
        .select(`
          id,
          research_projects!inner (
            user_id
          )
        `)
        .eq('id', citationId)
        .single()

      if (citationError || !citation || (citation.research_projects as { user_id?: string })?.user_id !== user.id) {
        return NextResponse.json({ error: 'Citation not found or access denied' }, { status: 404 })
      }

      const { error } = await supabase
        .from('project_citations')
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
        .from('project_citations')
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
