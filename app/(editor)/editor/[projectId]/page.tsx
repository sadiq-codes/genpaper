import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { ResearchEditor } from '@/components/editor/ResearchEditor'
import type { ProjectPaper } from '@/components/editor/types'

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
  
  // Get user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    redirect('/login')
  }

  // Fetch project and citation paper IDs first
  const [projectResult, citationsResult] = await Promise.all([
    // Get project - only select needed columns
    supabase
      .from('research_projects')
      .select('id, user_id, topic, content, status, citation_style, paper_type, generation_config')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single(),
    
    // Get citation records (paper_ids and csl_json) - no join, just the citation data
    supabase
      .from('project_citations')
      .select('paper_id, csl_json')
      .eq('project_id', projectId)
  ])

  const { data: project, error: projectError } = projectResult
  const { data: citations, error: citationsError } = citationsResult

  // Now fetch the actual papers using the paper_ids from citations
  const paperIds = citations?.map(c => c.paper_id).filter(Boolean) || []
  let papersData: Array<{
    id: string
    title: string
    authors: string[]
    publication_date: string | null
    venue: string | null
    doi: string | null
  }> = []

  if (paperIds.length > 0) {
    const { data: fetchedPapers, error: papersError } = await supabase
      .from('papers')
      .select('id, title, authors, publication_date, venue, doi')
      .in('id', paperIds)
    
    if (papersError) {
      console.error('[EditorPage] Error fetching papers:', papersError.message)
    } else {
      papersData = (fetchedPapers || []) as typeof papersData
    }
  }

  // Create a map of paper_id -> paper data for quick lookup
  const papersById = new Map(papersData.map(p => [p.id, p]))
  
  // Create a map of paper_id -> csl_json for fallback
  const cslJsonById = new Map(
    (citations || [])
      .filter(c => c.csl_json)
      .map(c => [c.paper_id, c.csl_json])
  )

  // Debug logging for paper fetching issues
  if (process.env.NODE_ENV === 'development') {
    console.log('[EditorPage] Paper fetch results:', {
      citationsCount: citations?.length || 0,
      citationsError: citationsError?.message,
      paperIdsFromCitations: paperIds,
      papersFoundInDb: papersData.length,
      papersWithCslJson: cslJsonById.size,
      missingPapers: paperIds.filter(id => !papersById.has(id)),
    })
  }

  if (projectError || !project) {
    notFound()
  }

  // Build papers array by combining:
  // 1. Papers found in the papers table (via paper_id from citations)
  // 2. Fallback to csl_json from citations for papers not in DB
  const paperMap = new Map<string, ProjectPaper>()
  
  // First, add papers found in the database
  for (const paper of papersData) {
    paperMap.set(paper.id, {
      id: paper.id,
      title: paper.title || 'Untitled',
      authors: paper.authors || [],
      year: paper.publication_date 
        ? new Date(paper.publication_date).getFullYear() 
        : new Date().getFullYear(),
      journal: paper.venue || undefined,
      doi: paper.doi || undefined,
    })
  }
  
  // Then, for any paper_ids not found in DB, try to use csl_json as fallback
  for (const paperId of paperIds) {
    if (!paperMap.has(paperId) && cslJsonById.has(paperId)) {
      try {
        const csl = cslJsonById.get(paperId) as Record<string, unknown>
        
        // Format authors from CSL JSON
        const authors = Array.isArray(csl.author) 
          ? (csl.author as Array<{literal?: string; given?: string; family?: string}>).map((a) => {
              if (a.literal) return a.literal
              if (a.given && a.family) return `${a.given} ${a.family}`
              return a.family || 'Unknown'
            })
          : []

        paperMap.set(paperId, {
          id: paperId,
          title: (csl.title as string) || 'Untitled',
          authors,
          year: ((csl.issued as {['date-parts']?: number[][]})?.['date-parts']?.[0]?.[0]) || new Date().getFullYear(),
          journal: csl['container-title'] as string | undefined,
          doi: csl.DOI as string | undefined,
        })
        
        if (process.env.NODE_ENV === 'development') {
          console.log(`[EditorPage] Used CSL JSON fallback for paper ${paperId}`)
        }
      } catch (e) {
        console.error(`[EditorPage] Failed to parse CSL JSON for paper ${paperId}:`, e)
      }
    }
  }
  
  const papers: ProjectPaper[] = Array.from(paperMap.values())

  // NOTE: Claims, gaps, and analysis are NOT fetched here anymore.
  // The useAnalysis hook handles this client-side with React Query,
  // which provides caching and avoids duplicate fetches.

  // Get citation style - project setting > user default > 'apa'
  const citationStyle = project.citation_style || 'apa'

  // Determine if we need to show generation progress
  const shouldShowGeneration = !isWriteMode && 
    isNewlyCreated && 
    project.status === 'generating' && 
    !project.content

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
        isWriteMode={isWriteMode}
      />
    </div>
  )
}
