import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Citation Instances API
 * 
 * POST - Create citation instances (batch)
 * GET - Fetch instances by IDs for a project
 */

// Max quote length in words
const MAX_QUOTE_WORDS = 100

/**
 * Truncate quote to max words
 */
function truncateQuote(quote: string, maxWords: number = MAX_QUOTE_WORDS): string {
  const words = quote.split(/\s+/)
  if (words.length <= maxWords) return quote
  return words.slice(0, maxWords).join(' ') + '...'
}

/**
 * POST - Create citation instances
 * Body: { projectId: string, instances: Array<{ id: string, paperId: string, quote: string }> }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { projectId, instances } = body as {
      projectId: string
      instances: Array<{ id: string; paperId: string; quote: string }>
    }

    if (!projectId || !instances || !Array.isArray(instances)) {
      return NextResponse.json(
        { error: 'Missing projectId or instances array' },
        { status: 400 }
      )
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

    // Filter out instances without quotes
    const validInstances = instances.filter(i => i.id && i.paperId && i.quote)
    
    if (validInstances.length === 0) {
      return NextResponse.json({ success: true, created: 0 })
    }

    // Prepare inserts with truncated quotes
    const inserts = validInstances.map(instance => ({
      id: instance.id,
      project_id: projectId,
      paper_id: instance.paperId,
      quote: truncateQuote(instance.quote)
    }))

    // Insert instances (ignore duplicates)
    const { error: insertError } = await supabase
      .from('citation_instances')
      .upsert(inserts, { onConflict: 'id', ignoreDuplicates: true })

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

  } catch (error) {
    console.error('[citation-instances] POST error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * GET - Fetch citation instances by IDs
 * Query params: projectId, ids (comma-separated)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')
    // Support both 'ids' and 'instanceIds' for backward compatibility
    const idsParam = searchParams.get('ids') || searchParams.get('instanceIds')

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

    // Parse IDs
    const ids = idsParam ? idsParam.split(',').filter(Boolean) : []

    if (ids.length === 0) {
      return NextResponse.json({ instances: {} })
    }

    // Fetch instances
    const { data: instances, error: fetchError } = await supabase
      .from('citation_instances')
      .select('id, paper_id, quote')
      .eq('project_id', projectId)
      .in('id', ids)

    if (fetchError) {
      if ((fetchError as { code?: string }).code === 'PGRST205') {
        console.warn('[citation-instances] citation_instances not available (migration not applied); returning empty')
        return NextResponse.json({ instances: {} })
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
      quote: instance.quote
    }))

    return NextResponse.json({ instances: instanceArray })

  } catch (error) {
    console.error('[citation-instances] GET error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
