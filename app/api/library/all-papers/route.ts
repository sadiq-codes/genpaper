import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type SortKey = 'added_at' | 'title' | 'year'
type SourceFilter = 'all' | 'upload' | 'search'
type BookmarkedFilter = 'all' | 'bookmarked' | 'not-bookmarked'

interface UnifiedPaper {
  id: string
  title: string
  authors: string[]
  publication_date: string | null
  venue: string | null
  doi: string | null
  pdf_url: string | null
  source: string | null
  citation_count: number | null
  processing_status: string | null
  owner_id: string | null
  metadata: Record<string, unknown> | null
  isBookmarked: boolean
  libraryNotes: string | null
  libraryAddedAt: string | null
  projects: Array<{ id: string; topic: string }>
  firstAddedAt: string
}

function getSortComparator(sortBy: SortKey) {
  return (a: UnifiedPaper, b: UnifiedPaper) => {
    switch (sortBy) {
      case 'title':
        return a.title.localeCompare(b.title)
      case 'year': {
        const yearA = a.publication_date ? new Date(a.publication_date).getTime() : 0
        const yearB = b.publication_date ? new Date(b.publication_date).getTime() : 0
        return yearB - yearA
      }
      case 'added_at':
      default:
        return new Date(b.firstAddedAt).getTime() - new Date(a.firstAddedAt).getTime()
    }
  }
}

/**
 * GET /api/library/all-papers
 * 
 * Returns all papers the user has access to:
 * - Papers explicitly saved to library (library_papers)
 * - Papers used in any of the user's projects (project_citations)
 * 
 * Each paper includes:
 * - isBookmarked: whether it's in library_papers
 * - projects: list of projects using this paper
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const searchQuery = (url.searchParams.get('q') || '').trim().toLowerCase()
    const sortBy = ((url.searchParams.get('sort') as SortKey | null) || 'added_at')
    const sourceFilter = ((url.searchParams.get('source') as SourceFilter | null) || 'all')
    const projectFilter = url.searchParams.get('project') || url.searchParams.get('projectId') || 'all'
    const bookmarkedFilter = ((url.searchParams.get('bookmarked') as BookmarkedFilter | null) || 'all')
    const offset = Math.max(0, Number(url.searchParams.get('offset') || '0') || 0)
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || '30') || 30))

    // Shared select fields — exclude abstract for list view (server-serialization)
    const paperFields = `
      id,
      title,
      authors,
      publication_date,
      venue,
      doi,
      pdf_url,
      source,
      citation_count,
      processing_status,
      owner_id,
      metadata
    `

    // Start ALL queries in parallel (async-parallel) — no sequential dependencies.
    // Library papers don't depend on projects; citations use project_id filter
    // but we can fetch projects in parallel and merge after.
    const [projectsResult, libraryResult, citationsResult] = await Promise.all([
      // Projects query
      supabase
        .from('research_projects')
        .select('id, topic')
        .eq('user_id', user.id),

      // Library papers query
      supabase
        .from('library_papers')
        .select(`
          paper_id,
          added_at,
          notes,
          papers:paper_id (${paperFields})
        `)
        .eq('user_id', user.id),

      // Citations query — use inner join on research_projects to scope to user's projects
      // This avoids needing project IDs upfront (no sequential dependency)
      projectFilter !== 'all'
        ? supabase
            .from('project_citations')
            .select(`
              paper_id,
              project_id,
              created_at,
              papers:paper_id (${paperFields})
            `)
            .eq('project_id', projectFilter)
        : supabase
            .from('project_citations')
            .select(`
              paper_id,
              project_id,
              created_at,
              papers:paper_id (${paperFields}),
              research_projects!inner(user_id)
            `)
            .eq('research_projects.user_id', user.id),
    ])

    if (projectsResult.error) {
      console.error('Failed to fetch projects:', projectsResult.error)
      return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 })
    }
    if (libraryResult.error) {
      console.error('Failed to fetch library papers:', libraryResult.error)
      return NextResponse.json({ error: 'Failed to fetch library papers' }, { status: 500 })
    }
    if (citationsResult.error) {
      console.error('Failed to fetch project citations:', citationsResult.error)
      return NextResponse.json({ error: 'Failed to fetch project papers' }, { status: 500 })
    }

    const userProjects = projectsResult.data || []
    const projectMap = new Map(userProjects.map(p => [p.id, p.topic]))
    const libraryPapers = libraryResult.data || []
    const projectCitations = citationsResult.data || []

    // Step 4: Build unified paper map
    const paperMap = new Map<string, UnifiedPaper>()

    // Add library papers
    for (const lp of libraryPapers || []) {
      const paper = lp.papers as any
      if (!paper) continue

      paperMap.set(paper.id, {
        id: paper.id,
        title: paper.title,
        authors: paper.authors || [],
        publication_date: paper.publication_date,
        venue: paper.venue,
        doi: paper.doi,
        pdf_url: paper.pdf_url,
        source: paper.source,
        citation_count: paper.citation_count,
        processing_status: paper.processing_status,
        owner_id: paper.owner_id,
        metadata: paper.metadata || null,
        isBookmarked: true,
        libraryNotes: lp.notes,
        libraryAddedAt: lp.added_at,
        projects: [],
        firstAddedAt: lp.added_at,
      })
    }

    // Add/merge project papers
    for (const pc of projectCitations || []) {
      const paper = pc.papers as any
      if (!paper) continue

      const existing = paperMap.get(paper.id)
      const projectTopic = projectMap.get(pc.project_id) || 'Unknown Project'

      if (existing) {
        // Paper already in map - add project reference
        if (!existing.projects.some(p => p.id === pc.project_id)) {
          existing.projects.push({ id: pc.project_id, topic: projectTopic })
        }
        // Update firstAddedAt if this is earlier
        if (pc.created_at < existing.firstAddedAt) {
          existing.firstAddedAt = pc.created_at
        }
      } else {
        // New paper from project
        paperMap.set(paper.id, {
          id: paper.id,
          title: paper.title,
          authors: paper.authors || [],
          publication_date: paper.publication_date,
          venue: paper.venue,
          doi: paper.doi,
          pdf_url: paper.pdf_url,
          source: paper.source,
          citation_count: paper.citation_count,
          processing_status: paper.processing_status,
          owner_id: paper.owner_id,
          metadata: paper.metadata || null,
          isBookmarked: false,
          libraryNotes: null,
          libraryAddedAt: null,
          projects: [{ id: pc.project_id, topic: projectTopic }],
          firstAddedAt: pc.created_at,
        })
      }
    }

    const allPapers = Array.from(paperMap.values())

    const stats = {
      total: allPapers.length,
      uploaded: allPapers.filter((paper) => paper.source === 'upload').length,
      searched: allPapers.filter((paper) => paper.source !== 'upload').length,
      bookmarked: allPapers.filter((paper) => paper.isBookmarked).length,
      projects: userProjects.length,
    }

    let filteredPapers = allPapers

    if (searchQuery) {
      filteredPapers = filteredPapers.filter((paper) =>
        paper.title.toLowerCase().includes(searchQuery) ||
        paper.authors.some((author) => author.toLowerCase().includes(searchQuery)) ||
        paper.venue?.toLowerCase().includes(searchQuery) ||
        paper.libraryNotes?.toLowerCase().includes(searchQuery)
      )
    }

    if (sourceFilter !== 'all') {
      filteredPapers = filteredPapers.filter((paper) => paper.source === sourceFilter)
    }

    if (projectFilter !== 'all') {
      if (projectFilter === 'none') {
        filteredPapers = filteredPapers.filter((paper) => paper.projects.length === 0)
      } else {
        filteredPapers = filteredPapers.filter((paper) => paper.projects.some((project) => project.id === projectFilter))
      }
    }

    if (bookmarkedFilter === 'bookmarked') {
      filteredPapers = filteredPapers.filter((paper) => paper.isBookmarked)
    } else if (bookmarkedFilter === 'not-bookmarked') {
      filteredPapers = filteredPapers.filter((paper) => !paper.isBookmarked)
    }

    filteredPapers = filteredPapers.toSorted(getSortComparator(sortBy))

    const totalCount = filteredPapers.length
    const papers = filteredPapers.slice(offset, offset + limit)

    return NextResponse.json({
      papers,
      count: totalCount,
      offset,
      limit,
      hasMore: offset + papers.length < totalCount,
      projects: userProjects || [],
      stats,
    })

  } catch (error) {
    console.error('Error in library/all-papers GET API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}
