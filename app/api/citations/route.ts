import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import z from 'zod'

import { CitationService } from '@/lib/citations/immediate-bibliography'
import { validateCSL } from '@/lib/utils/csl'
import { BatchCitationRefSchema, type PlaceholderCitation } from '@/lib/citations/placeholder-schema'


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

// Schema for batch citation resolution (placeholder-based)
const BatchResolveSchema = z.object({
  projectId: z.string().uuid(),
  refs: z.array(z.object({
    type: z.enum(['doi', 'paperId', 'title', 'url']),
    value: z.string().min(1),
    context: z.string().optional(),
    fallbackText: z.string().optional()
  })).min(1)
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
        citations: citations.map((citation: any) => ({
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

    const projectIds = projects.map((p: any) => p.id)

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
      citations: citations.map((citation: any) => ({
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

    // Handle batch resolution (placeholder-based citations)
    if (body.refs && Array.isArray(body.refs)) {
      // Batch resolution is always enabled (unified path)

      const validationResult = BatchResolveSchema.safeParse(body)
      
      if (!validationResult.success) {
        return NextResponse.json(
          { 
            error: 'Invalid batch resolve data',
            details: validationResult.error.errors.map((e: any) => ({
              path: e.path.join('.'),
              message: e.message
            }))
          },
          { status: 400 }
        )
      }

      const { projectId, refs } = validationResult.data

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
      const results: Array<{ ref: any; success: boolean; citation?: any; error?: string }> = []

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
              result.cslJson as any,
              'apa',
              (result as any).citationNumber ?? 1
            )

            citeKeyMap[citeKey] = inlineText
            results.push({ 
              ref, 
              success: true, 
              citation: {
                citeKey: result.citeKey,
                citationNumber: result.citationNumber,
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

    // Handle batch creation (legacy)
    if (body.citations && Array.isArray(body.citations)) {
      const validationResult = BatchCreateSchema.safeParse(body)
      
      if (!validationResult.success) {
        return NextResponse.json(
          { 
            error: 'Invalid batch citation data',
            details: validationResult.error.errors.map((e: any) => ({
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
      const citationInserts = citations.map((citation: any) => ({
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
          details: validationResult.error.errors.map((e: { path: (string|number)[]; message: string }) => ({
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

    // Idempotency: prevent duplicate key within project
    const { data: existing, error: existingErr } = await supabase
      .from('citations')
      .select('id, key')
      .eq('project_id', projectId)
      .eq('key', key)
      .maybeSingle()
    if (!existingErr && existing) {
      return NextResponse.json({ error: 'Citation with this key already exists for this project' }, { status: 409 })
    }

    // Unified path: always use CitationService when paperId provided
    if (paperId) {
      try {
        const result = await CitationService.add({
          projectId,
          sourceRef: { paperId },
          reason: citation_text || 'manual',
          quote: context || null
        })
        
        // Fetch first_seen_order for render numbering
        const { data: citation } = await supabase
          .from('project_citations')
          .select('first_seen_order')
          .eq('id', result.projectCitationId)
          .single()

        return NextResponse.json({ 
          success: true, 
          citation: {
            id: result.citeKey, // Use citeKey as ID for consistency
            key,
            project_id: projectId,
            paper_id: paperId,
            csl_json: result.cslJson,
            citation_text,
            context,
            citation_number: citation?.first_seen_order || 1, // Use first_seen_order
            is_new: result.isNew,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        }, { status: 201 })
      } catch (error) {
        console.error('CitationService.add failed:', error)
        return NextResponse.json({ 
          error: error instanceof Error ? error.message : 'Citation service error' 
        }, { status: 400 })
      }
    }
    // Manual creation without paperId is not supported in the unified path
    return NextResponse.json({ error: 'paperId is required' }, { status: 400 })

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
          details: validationResult.error.errors.map((e: { path: (string|number)[]; message: string }) => ({
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

    if (citationError || !citation || (citation as any).research_projects?.user_id !== user.id) {
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