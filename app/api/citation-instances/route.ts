import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Citation Instances API
 * 
 * POST - Create citation instances OR fetch instances by IDs for a project
 */

// Max quote length in words
const MAX_QUOTE_WORDS = 100

type CreateInstanceInput = {
  id: string
  paperId: string
  quote: string
  citationGroupId?: string | null
  citationGroupOrder?: number | null
  groupRequired?: boolean
}

type CitationInstancesRequest = {
  projectId?: string
  instances?: CreateInstanceInput[]
  ids?: string[]
}

function isCitationGroupingSchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: string; message?: string; details?: string; hint?: string }
  const message = `${candidate.message || ''} ${candidate.details || ''} ${candidate.hint || ''}`.toLowerCase()
  return candidate.code === 'PGRST204' &&
    (
      message.includes('citation_group_id') ||
      message.includes('citation_group_order') ||
      message.includes('group_required')
    )
}

/**
 * Truncate quote to max words
 */
function truncateQuote(quote: string, maxWords: number = MAX_QUOTE_WORDS): string {
  const words = quote.split(/\s+/)
  if (words.length <= maxWords) return quote
  return words.slice(0, maxWords).join(' ') + '...'
}

/**
 * POST - Create citation instances or fetch existing instances
 * Body for create:
 *   { projectId: string, instances: Array<{
 *       id: string,
 *       paperId: string,
 *       quote: string,
 *       citationGroupId?: string | null,
 *       citationGroupOrder?: number | null,
 *       groupRequired?: boolean
 *     }> }
 * Body for fetch:
 *   { projectId: string, ids: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json() as CitationInstancesRequest
    const projectId = typeof body.projectId === 'string' ? body.projectId : ''

    if (!projectId) {
      return NextResponse.json({ error: 'Missing projectId' }, { status: 400 })
    }

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

    // Create flow
    if (Array.isArray(body.instances)) {
      // Filter out invalid instances
      const validInstances = body.instances.filter(
        (instance): instance is CreateInstanceInput =>
          typeof instance?.id === 'string' &&
          typeof instance?.paperId === 'string' &&
          typeof instance?.quote === 'string' &&
          instance.id.length > 0 &&
          instance.paperId.length > 0 &&
          instance.quote.length > 0
      )

      if (validInstances.length === 0) {
        return NextResponse.json({ success: true, created: 0 })
      }

      // Prepare inserts with truncated quotes
      const baseInserts = validInstances.map(instance => ({
        id: instance.id,
        project_id: projectId,
        paper_id: instance.paperId,
        quote: truncateQuote(instance.quote)
      }))
      const groupedInserts = validInstances.map(instance => ({
        id: instance.id,
        project_id: projectId,
        paper_id: instance.paperId,
        quote: truncateQuote(instance.quote),
        citation_group_id: instance.citationGroupId ?? null,
        citation_group_order:
          typeof instance.citationGroupOrder === 'number' ? instance.citationGroupOrder : null,
        group_required: instance.groupRequired === true,
      }))

      // Insert instances (ignore duplicates)
      let insertError: unknown = null
      const groupedResult = await supabase
        .from('citation_instances')
        .upsert(groupedInserts, { onConflict: 'id', ignoreDuplicates: true })
      insertError = groupedResult.error

      if (insertError && isCitationGroupingSchemaError(insertError)) {
        console.warn('[citation-instances] grouping columns unavailable; retrying create without grouping metadata')
        const fallbackResult = await supabase
          .from('citation_instances')
          .upsert(baseInserts, { onConflict: 'id', ignoreDuplicates: true })
        insertError = fallbackResult.error
      }

      if (insertError) {
        // If the migration for citation_instances hasn't been applied yet,
        // PostgREST returns PGRST205 (table missing from schema cache). Treat as optional.
        if ((insertError as { code?: string }).code === 'PGRST205') {
          console.warn('[citation-instances] citation_instances not available (migration not applied); skipping')
          return NextResponse.json({ success: true, created: 0 })
        }
        console.error('[citation-instances] Insert error:', insertError)
        return NextResponse.json(
          { error: 'Failed to create citation instances' },
          { status: 500 }
        )
      }

      return NextResponse.json({ success: true, created: validInstances.length })
    }

    // Fetch flow
    if (Array.isArray(body.ids)) {
      const ids = body.ids.filter((id): id is string => typeof id === 'string' && id.length > 0)

      if (ids.length === 0) {
        return NextResponse.json({ instances: [] })
      }

      // Fetch instances
      let instances: Array<{
        id: string
        quote: string
        citation_group_id?: string | null
        citation_group_order?: number | null
        group_required?: boolean | null
      }> | null = null
      let fetchError: unknown = null

      const groupedFetch = await supabase
        .from('citation_instances')
        .select('id, paper_id, quote, citation_group_id, citation_group_order, group_required')
        .eq('project_id', projectId)
        .in('id', ids)
      instances = groupedFetch.data
      fetchError = groupedFetch.error

      if (fetchError && isCitationGroupingSchemaError(fetchError)) {
        console.warn('[citation-instances] grouping columns unavailable; retrying fetch without grouping metadata')
        const fallbackFetch = await supabase
          .from('citation_instances')
          .select('id, paper_id, quote')
          .eq('project_id', projectId)
          .in('id', ids)
        instances = fallbackFetch.data as typeof instances
        fetchError = fallbackFetch.error
      }

      if (fetchError) {
        if ((fetchError as { code?: string }).code === 'PGRST205') {
          console.warn('[citation-instances] citation_instances not available (migration not applied); returning empty')
          return NextResponse.json({ instances: [] })
        }
        console.error('[citation-instances] Fetch error:', fetchError)
        return NextResponse.json(
          { error: 'Failed to fetch citation instances' },
          { status: 500 }
        )
      }

      // Return as array of {id, quote} objects (frontend expects this format)
      const instanceArray = (instances || []).map(instance => ({
        id: instance.id,
        quote: instance.quote,
        citationGroupId: instance.citation_group_id ?? null,
        citationGroupOrder: instance.citation_group_order ?? null,
        groupRequired: instance.group_required ?? false,
      }))

      return NextResponse.json({ instances: instanceArray })
    }

    return NextResponse.json(
      { error: 'Invalid payload. Expected either { projectId, instances } or { projectId, ids }' },
      { status: 400 }
    )

  } catch (error) {
    console.error('[citation-instances] POST error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
