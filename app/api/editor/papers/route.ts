import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { CitationService } from '@/lib/citations/immediate-bibliography'

/**
 * POST /api/editor/papers
 * Add a paper to a research project
 * 
 * Papers are linked to projects via the project_citations table.
 * This also generates CSL JSON for proper citation rendering.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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
    console.error('Add paper error:', error)
    return NextResponse.json(
      { error: 'Failed to add paper' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/editor/papers
 * Remove a paper from a research project
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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

      if (!claimDeleteError) {
        claimsDeleted = claimCount
      }
    }

    return NextResponse.json({ 
      success: true,
      claimsDeleted,
      message: 'Paper removed from project'
    })

  } catch (error) {
    console.error('Remove paper error:', error)
    return NextResponse.json(
      { error: 'Failed to remove paper' },
      { status: 500 }
    )
  }
}
