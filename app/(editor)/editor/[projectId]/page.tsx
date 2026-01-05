import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { ResearchEditor } from '@/components/editor/ResearchEditor'
import type { ProjectPaper, ExtractedClaim, ResearchGap, AnalysisOutput } from '@/components/editor/types'

interface EditorPageProps {
  params: Promise<{ projectId: string }>
}

export default async function EditorPage({ params }: EditorPageProps) {
  const { projectId } = await params
  const supabase = await createClient()
  
  // Get user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    redirect('/login')
  }

  // Get project from research_projects table
  const { data: project, error: projectError } = await supabase
    .from('research_projects')
    .select('*')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single()

  if (projectError || !project) {
    notFound()
  }

  // Get project papers from research_project_papers junction table
  const { data: projectPapers } = await supabase
    .from('research_project_papers')
    .select(`
      paper_id,
      papers (
        id,
        title,
        authors,
        publication_date,
        abstract,
        venue,
        doi
      )
    `)
    .eq('research_project_id', projectId)

  // Transform papers to the expected format
  interface PaperData {
    id: string
    title: string
    authors: string[]
    publication_date: string | null
    abstract: string | null
    venue: string | null
    doi: string | null
  }
  
  const papers: ProjectPaper[] = (projectPapers || [])
    .filter(pp => pp.papers)
    .map(pp => {
      const paperData = Array.isArray(pp.papers) ? pp.papers[0] : pp.papers
      const paper = paperData as unknown as PaperData
      return {
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
    })

  // Fetch existing analysis data
  let claims: ExtractedClaim[] = []
  let gaps: ResearchGap[] = []
  let synthesis: AnalysisOutput | null = null

  // Get claims for papers
  if (papers.length > 0) {
    const { data: claimsData } = await supabase
      .from('paper_claims')
      .select('*')
      .in('paper_id', papers.map(p => p.id))
      .order('confidence', { ascending: false })
      .limit(100)

    if (claimsData) {
      claims = claimsData.map(claim => {
        const paper = papers.find(p => p.id === claim.paper_id)
        return {
          id: claim.id,
          paper_id: claim.paper_id,
          claim_text: claim.claim_text,
          evidence_quote: claim.evidence_quote,
          section: claim.section,
          claim_type: claim.claim_type,
          confidence: claim.confidence,
          paper_title: paper?.title,
          paper_authors: paper?.authors,
          paper_year: paper?.year,
        }
      })
    }
  }

  // Get research gaps
  const { data: gapsData } = await supabase
    .from('research_gaps')
    .select('*')
    .eq('project_id', projectId)
    .order('confidence', { ascending: false })

  if (gapsData) {
    gaps = gapsData.map(gap => ({
      id: gap.id,
      project_id: gap.project_id,
      gap_type: gap.gap_type,
      description: gap.description,
      confidence: gap.confidence,
      supporting_paper_ids: gap.supporting_paper_ids || [],
      research_opportunity: gap.research_opportunity,
      evidence: gap.evidence,
    }))
  }

  // Get synthesis analysis
  const { data: analysisData } = await supabase
    .from('project_analysis')
    .select('*')
    .eq('project_id', projectId)
    .eq('analysis_type', 'synthesis')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (analysisData) {
    synthesis = {
      id: analysisData.id,
      project_id: analysisData.project_id,
      analysis_type: analysisData.analysis_type,
      status: analysisData.status,
      structured_output: analysisData.structured_output,
      markdown_output: analysisData.markdown_output,
      created_at: analysisData.created_at,
      completed_at: analysisData.completed_at,
    }
  }

  // Build initial analysis state
  const initialAnalysis = claims.length > 0 || gaps.length > 0 || synthesis
    ? { claims, gaps, synthesis }
    : undefined

  return (
    <div className="h-screen w-full p-2 md:p-4">
      <ResearchEditor
        projectId={projectId}
        projectTitle={project.topic || 'Untitled Document'}
        initialContent={project.content || undefined}
        initialPapers={papers}
        initialAnalysis={initialAnalysis}
        onSave={undefined}
      />
    </div>
  )
}
