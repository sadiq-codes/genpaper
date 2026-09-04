import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { handleError, requireAuth } from '@/lib/api/helpers'
import { CitationService } from '@/lib/citations/immediate-bibliography'
import { schedulePaperContentPreparationById } from '@/lib/services/paper-content-service'

/**
 * GET /api/editor/papers?projectId=xxx
 * Fetch papers for editor citation rendering.
 *
 * Priority:
 * 1) `citation_instances` (authoritative immediately after finalize)
 * 2) `project_citations` fallback (legacy/project-linked list)
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth()
    const supabase = await createClient()

    const projectId = request.nextUrl.searchParams.get('projectId')
    if (!projectId) {
      return NextResponse.json({ error: 'Missing projectId' }, { status: 400 })
    }

    // Verify ownership
    const { data: project, error: projectError } = await supabase
      .from('research_projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Prefer citation_instances so references update immediately on generation complete.
    const { data: instanceRows } = await supabase
      .from('citation_instances')
      .select('paper_id')
      .eq('project_id', projectId)

    const instancePaperIds = Array.from(
      new Set(
        (instanceRows || [])
          .map(row => row.paper_id)
          .filter((id): id is string => Boolean(id))
      )
    )

    // Keep CSL fallback support from project_citations.
    let citations: Array<{ paper_id: string; csl_json: unknown }> = []
    if (instancePaperIds.length > 0) {
      const { data } = await supabase
        .from('project_citations')
        .select('paper_id, csl_json')
        .eq('project_id', projectId)
        .in('paper_id', instancePaperIds)
      citations = (data || []) as Array<{ paper_id: string; csl_json: unknown }>
    } else {
      const { data } = await supabase
        .from('project_citations')
        .select('paper_id, csl_json')
        .eq('project_id', projectId)
      citations = (data || []) as Array<{ paper_id: string; csl_json: unknown }>
    }

    const citationPaperIds = citations.map(c => c.paper_id).filter(Boolean)
    const paperIds = instancePaperIds.length > 0
      ? instancePaperIds
      : citationPaperIds

    if (paperIds.length === 0) {
      return NextResponse.json(
        { papers: [], allResolved: true, unresolvedPaperIds: [], citationCount: 0 },
        { headers: { 'Cache-Control': 'no-store, max-age=0' } }
      )
    }

    // Fetch papers
    const { data: papersData } = await supabase
      .from('papers')
      .select('id, title, authors, publication_date, venue, doi, source, pdf_url')
      .in('id', paperIds)

    const resolvedPaperIds = new Set((papersData || []).map(p => p.id))
    const unresolvedPaperIds = paperIds.filter(id => !resolvedPaperIds.has(id))

    // Build CSL fallback map
    const cslJsonById = new Map(
      citations
        .filter(c => c.csl_json)
        .map(c => [c.paper_id, c.csl_json])
    )

    // Build papers array (same logic as page.tsx)
    const paperMap = new Map()

    for (const paper of (papersData || [])) {
      paperMap.set(paper.id, {
        id: paper.id,
        title: paper.title || 'Untitled',
        authors: paper.authors || [],
        year: paper.publication_date
          ? new Date(paper.publication_date).getFullYear()
          : new Date().getFullYear(),
        journal: paper.venue || undefined,
        doi: paper.doi || undefined,
        pdfUrl: paper.pdf_url || undefined,
        source: paper.source === 'upload' ? 'upload' : 'search',
      })
    }

    // Fallback to CSL JSON for papers not in DB
    for (const paperId of paperIds) {
      if (!paperMap.has(paperId) && cslJsonById.has(paperId)) {
        try {
          const csl = cslJsonById.get(paperId) as Record<string, unknown>
          const authors = Array.isArray(csl.author)
            ? (csl.author as Array<{ literal?: string; given?: string; family?: string }>).map(a => {
                if (a.literal) return a.literal
                if (a.given && a.family) return `${a.given} ${a.family}`
                return a.family || 'Unknown'
              })
            : []
          paperMap.set(paperId, {
            id: paperId,
            title: (csl.title as string) || 'Untitled',
            authors,
            year: ((csl.issued as { ['date-parts']?: number[][] })?.['date-parts']?.[0]?.[0]) || new Date().getFullYear(),
            journal: csl['container-title'] as string | undefined,
            doi: csl.DOI as string | undefined,
          })
        } catch {
          // Skip malformed CSL
        }
      }
    }

    return NextResponse.json(
      {
        papers: Array.from(paperMap.values()),
        allResolved: unresolvedPaperIds.length === 0,
        unresolvedPaperIds,
        citationCount: paperIds.length,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    )
  } catch (error) {
    return handleError(error, 'Fetch papers error')
  }
}

/**
 * POST /api/editor/papers
 * Add a paper to a research project
 * 
 * Papers are linked to projects via the project_citations table.
 * This also generates CSL JSON for proper citation rendering.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth()
    const supabase = await createClient()

    const { projectId, paperId } = await request.json()

    if (!projectId || !paperId) {
      return NextResponse.json(
        { error: 'Missing projectId or paperId' },
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

    // Check if paper exists
    const { data: paper, error: paperError } = await supabase
      .from('papers')
      .select('id, title, authors, publication_date, abstract, venue, doi')
      .eq('id', paperId)
      .single()

    if (paperError || !paper) {
      return NextResponse.json({ error: 'Paper not found' }, { status: 404 })
    }

    // Check if already added to project_citations
    const { data: existing } = await supabase
      .from('project_citations')
      .select('id')
      .eq('project_id', projectId)
      .eq('paper_id', paperId)
      .single()

    if (existing) {
      // Paper already in project - return success with paper data
      const projectPaper = {
        id: paper.id,
        title: paper.title || 'Untitled',
        authors: paper.authors || [],
        year: paper.publication_date 
          ? new Date(paper.publication_date).getFullYear() 
          : new Date().getFullYear(),
        abstract: paper.abstract || undefined,
        journal: paper.venue || undefined,
        doi: paper.doi || undefined,
      }
      return NextResponse.json(
        { error: 'Paper already in project', paper: projectPaper },
        { status: 409 }
      )
    }

    // Add paper to project via CitationService.add
    // This creates the project_citations entry with proper CSL JSON
    try {
      await CitationService.add({
        projectId,
        sourceRef: { paperId },
        reason: 'Added to project library'
      })
      console.log(`[Editor Papers] Added paper ${paperId} to project ${projectId} with CSL JSON`)
    } catch (citationError) {
      console.error('Error adding paper to project:', citationError)
      return NextResponse.json(
        { error: 'Failed to add paper to project' },
        { status: 500 }
      )
    }

    after(() => {
      schedulePaperContentPreparationById(paperId, {
        searchQuery: 'editor_add_paper',
        waitForStructuredExtraction: false,
        reason: 'editor_add_paper',
        userId: user.id,
      })
    })

    // Return the paper data for UI update
    const projectPaper = {
      id: paper.id,
      title: paper.title || 'Untitled',
      authors: paper.authors || [],
      year: paper.publication_date 
        ? new Date(paper.publication_date).getFullYear() 
        : new Date().getFullYear(),
      abstract: paper.abstract || undefined,
      journal: paper.venue || undefined,
      doi: paper.doi || undefined,
    }

    return NextResponse.json({ 
      success: true, 
      paper: projectPaper,
      message: 'Paper added to project'
    })

  } catch (error) {
    return handleError(error, 'Add paper error')
  }
}

/**
 * DELETE /api/editor/papers
 * Remove a paper from a research project
 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await requireAuth()
    const supabase = await createClient()

    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')
    const paperId = searchParams.get('paperId')
    const deleteClaims = searchParams.get('deleteClaims') === 'true'

    if (!projectId || !paperId) {
      return NextResponse.json(
        { error: 'Missing projectId or paperId' },
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

    // Get count of claims that will be affected
    const { count: claimCount } = await supabase
      .from('paper_claims')
      .select('id', { count: 'exact', head: true })
      .eq('paper_id', paperId)

    // Remove paper from project (delete from project_citations)
    const { error: deleteError } = await supabase
      .from('project_citations')
      .delete()
      .eq('project_id', projectId)
      .eq('paper_id', paperId)

    if (deleteError) {
      console.error('Error removing paper from project:', deleteError)
      return NextResponse.json(
        { error: 'Failed to remove paper from project' },
        { status: 500 }
      )
    }

    // Optionally delete associated claims
    let claimsDeleted = 0
    if (deleteClaims && claimCount && claimCount > 0) {
      const { error: claimDeleteError } = await supabase
        .from('paper_claims')
        .delete()
        .eq('paper_id', paperId)

      if (claimDeleteError) {
        console.error('Error deleting paper claims (citation already removed):', claimDeleteError)
      } else {
        claimsDeleted = claimCount
      }
    }

    return NextResponse.json({ 
      success: true,
      claimsDeleted,
      message: 'Paper removed from project'
    })

  } catch (error) {
    return handleError(error, 'Remove paper error')
  }
}
