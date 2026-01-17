import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { CitationService } from '@/lib/citations/immediate-bibliography'

/**
 * POST /api/citations/backfill
 * 
 * Two-step backfill process:
 * 1. Extract citation markers from content and create citation records
 * 2. Backfill CSL JSON for any citations missing it
 * 
 * This is useful for existing projects where:
 * - Content has [CITE: uuid] markers but no citation records
 * - Citation records exist but are missing CSL JSON
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { projectId } = await request.json()

    if (!projectId) {
      return NextResponse.json(
        { error: 'Missing projectId' },
        { status: 400 }
      )
    }

    // Verify user owns the project
    const { data: project, error: projectError } = await supabase
      .from('research_projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Step 1: Extract citations from content and create records
    const extractResult = await CitationService.extractAndCreateCitationsFromContent(projectId)
    
    // Step 2: Backfill CSL JSON for any existing citations missing it
    const backfillResult = await CitationService.backfillProjectCitations(projectId)

    const totalProcessed = extractResult.processed + backfillResult.processed
    const allErrors = [...extractResult.errors, ...backfillResult.errors]

    return NextResponse.json({
      success: true,
      extracted: extractResult.extracted,
      created: extractResult.processed,
      cslBackfilled: backfillResult.processed,
      totalProcessed,
      errors: allErrors,
      message: `Found ${extractResult.extracted} citations in content, created ${extractResult.processed} records, backfilled ${backfillResult.processed} CSL JSON${allErrors.length > 0 ? ` (${allErrors.length} errors)` : ''}`
    })

  } catch (error) {
    console.error('Citation backfill error:', error)
    return NextResponse.json(
      { error: 'Failed to backfill citations' },
      { status: 500 }
    )
  }
}
