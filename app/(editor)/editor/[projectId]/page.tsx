import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { ResearchEditor } from '@/components/editor/ResearchEditor'
import type { ProjectPaper } from '@/components/editor/types'
import { getRunningRun } from '@/lib/generation/run-manager'

interface EditorPageProps {
  params: Promise<{ projectId: string }>
  searchParams: Promise<{ created?: string; write?: string }>
}

export default async function EditorPage({ params, searchParams }: EditorPageProps) {
  const { projectId } = await params
  const { created, write } = await searchParams
  const isNewlyCreated = created === '1'
  const isWriteMode = write === '1'
  const supabase = await createClient()
  
  // Get user (layout already checks auth, but we need user.id for the query)
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    redirect('/login')
  }

  // Fetch project, citations, user preferences, and active run in ONE parallel batch
  const [projectResult, citationsResult, prefsResult, activeRunResult] = await Promise.all([
    supabase
      .from('research_projects')
      .select('id, user_id, topic, content, status, citation_style, paper_type, generation_config')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single(),
    
    // Join citations with papers in a single query
    supabase
      .from('project_citations')
      .select('paper_id, csl_json, papers(id, title, authors, publication_date, venue, doi, source, pdf_url, metadata)')
      .eq('project_id', projectId),

    // User preferences for autocomplete settings
    supabase
      .from('user_preferences')
      .select('citation_style, auto_suggestions, include_citations, accept_key, use_external_sources')
      .eq('user_id', user.id)
      .single()
    ,

    // Active generation run for resume support (works even when partial content exists)
    // Uses service-role access via run manager (independent from RLS policies).
    getRunningRun(projectId)
  ])

  const { data: project, error: projectError } = projectResult
  const { data: citations } = citationsResult
  const userPrefs = prefsResult.data
  const activeRun = activeRunResult?.user_id === user.id ? activeRunResult : null

  if (projectError || !project) {
    notFound()
  }

  // Build paper data from the joined query
  type PaperRow = {
    id: string
    title: string
    authors: string[]
    publication_date: string | null
    venue: string | null
    doi: string | null
    source: string | null
    pdf_url: string | null
    metadata: Record<string, unknown> | null
  }

  type JoinedCitation = {
    paper_id: string
    csl_json: Record<string, unknown> | null
    papers: PaperRow | PaperRow[] | null
  }

  const joinedCitations = (citations || []) as unknown as JoinedCitation[]
  
  // Create a map of paper_id -> csl_json for fallback
  const cslJsonById = new Map(
    joinedCitations
      .filter(c => c.csl_json)
      .map(c => [c.paper_id, c.csl_json])
  )

  // Build papers array from joined citation data
  const paperMap = new Map<string, ProjectPaper>()
  
  for (const citation of joinedCitations) {
    // Supabase join returns object for many-to-one, array for one-to-many
    const paper = Array.isArray(citation.papers) ? citation.papers[0] : citation.papers
    
    if (paper) {
      // Paper found in DB via join
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
        metadata: paper.metadata || null,
      })
    } else if (cslJsonById.has(citation.paper_id)) {
      // Fallback to CSL JSON for papers not in DB
      try {
        const csl = cslJsonById.get(citation.paper_id) as Record<string, unknown>
        
        const authors = Array.isArray(csl.author) 
          ? (csl.author as Array<{literal?: string; given?: string; family?: string}>).map((a) => {
              if (a.literal) return a.literal
              if (a.given && a.family) return `${a.given} ${a.family}`
              return a.family || 'Unknown'
            })
          : []

        paperMap.set(citation.paper_id, {
          id: citation.paper_id,
          title: (csl.title as string) || 'Untitled',
          authors,
          year: ((csl.issued as {['date-parts']?: number[][]})?.['date-parts']?.[0]?.[0]) || new Date().getFullYear(),
          journal: csl['container-title'] as string | undefined,
          doi: csl.DOI as string | undefined,
        })
      } catch (e) {
        console.error(`[EditorPage] Failed to parse CSL JSON for paper ${citation.paper_id}:`, e)
      }
    }
  }
  
  const papers: ProjectPaper[] = Array.from(paperMap.values())

  // NOTE: Claims, gaps, and analysis are NOT fetched here anymore.
  // The useAnalysis hook handles this client-side with React Query,
  // which provides caching and avoids duplicate fetches.

  // Get citation style - project setting > user default > 'apa'
  const citationStyle = project.citation_style || userPrefs?.citation_style || 'apa'

  // Build autocomplete preferences from DB (with safe defaults)
  const autocompletePrefs = {
    autoSuggestions: userPrefs?.auto_suggestions ?? true,
    includeCitations: userPrefs?.include_citations ?? false,
    acceptKey: (userPrefs?.accept_key || 'tab') as 'tab' | 'ctrlEnter',
    useExternalSources: userPrefs?.use_external_sources ?? false,
  }

  // Determine if we need to show generation progress.
  // Resume is based on an actual active run, not content emptiness.
  const shouldShowGeneration = !isWriteMode &&
    (isNewlyCreated || Boolean(activeRun))

  // Determine if project failed mid-generation and needs a retry option
  const isFailed = project.status === 'failed' && !project.content

  // Determine paperType
  const resolvedPaperType = (() => {
    if (project.paper_type) {
      return project.paper_type
    }
    const configPaperType = (project.generation_config as Record<string, unknown> | null)?.paper_settings as Record<string, unknown> | undefined
    if (configPaperType?.paperType) {
      return configPaperType.paperType as string
    }
    return 'literatureReview'
  })()

  return (
    <div className="h-screen w-full p-2 md:p-4">
      <ResearchEditor
        projectId={projectId}
        projectTitle={project.topic || 'Untitled Document'}
        projectTopic={project.topic || 'Research Paper'}
        paperType={resolvedPaperType as 'researchArticle' | 'literatureReview' | 'capstoneProject' | 'mastersThesis' | 'phdDissertation'}
        initialContent={project.content || undefined}
        initialPapers={papers}
        citationStyle={citationStyle}
        onSave={undefined}
        isGenerating={shouldShowGeneration}
        isFailed={isFailed}
        isWriteMode={isWriteMode}
        initialAutocompletePrefs={autocompletePrefs}
      />
    </div>
  )
}
