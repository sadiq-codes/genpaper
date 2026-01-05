import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  extractAndStoreClaimsForPapers,
  findResearchGaps,
  storeResearchGaps,
  generateSynthesis,
  generateLiteratureReview,
  storeAnalysis,
  getAnalysisForProject,
  getClaimsForPaper,
  getGapsForProject
} from '@/lib/analysis'

export const runtime = 'nodejs'

/**
 * POST /api/analysis
 * 
 * Run analysis on a project's papers
 * 
 * Body:
 * - projectId: string
 * - paperIds: string[]
 * - topic: string
 * - analysisType: 'claims' | 'gaps' | 'synthesis' | 'literature_review' | 'full'
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { projectId, paperIds, topic, analysisType } = body

    if (!projectId || !paperIds || !topic) {
      return NextResponse.json(
        { error: 'Missing required fields: projectId, paperIds, topic' },
        { status: 400 }
      )
    }

    // Verify project ownership
    const { data: project, error: projectError } = await supabase
      .from('research_projects')
      .select('id, user_id')
      .eq('id', projectId)
      .single()

    if (projectError || !project || project.user_id !== user.id) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const results: Record<string, unknown> = {}
    const startTime = Date.now()

    // Run requested analysis
    if (analysisType === 'claims' || analysisType === 'full') {
      const claimResult = await extractAndStoreClaimsForPapers(paperIds)
      results.claims = {
        success: claimResult.success,
        failed: claimResult.failed,
        total_claims: claimResult.results.reduce((sum, r) => sum + r.claims.length, 0)
      }
    }

    if (analysisType === 'gaps' || analysisType === 'full') {
      const gapResult = await findResearchGaps(projectId, paperIds, topic)
      if (!gapResult.error) {
        await storeResearchGaps(projectId, gapResult.gaps)
      }
      results.gaps = {
        count: gapResult.gaps.length,
        types: {
          unstudied: gapResult.gaps.filter(g => g.gap_type === 'unstudied').length,
          contradiction: gapResult.gaps.filter(g => g.gap_type === 'contradiction').length,
          limitation: gapResult.gaps.filter(g => g.gap_type === 'limitation').length
        },
        error: gapResult.error
      }
    }

    if (analysisType === 'synthesis' || analysisType === 'full') {
      const synthesisResult = await generateSynthesis(projectId, paperIds, topic)
      if (!synthesisResult.error) {
        await storeAnalysis({
          project_id: projectId,
          analysis_type: 'synthesis',
          status: 'completed',
          structured_output: synthesisResult.structured,
          markdown_output: synthesisResult.markdown,
          metadata: { processing_time_ms: synthesisResult.processing_time_ms }
        })
      }
      results.synthesis = {
        success: !synthesisResult.error,
        processing_time_ms: synthesisResult.processing_time_ms,
        error: synthesisResult.error
      }
    }

    if (analysisType === 'literature_review') {
      const reviewResult = await generateLiteratureReview(projectId, paperIds, topic)
      if (!reviewResult.error) {
        await storeAnalysis({
          project_id: projectId,
          analysis_type: 'literature_review',
          status: 'completed',
          structured_output: reviewResult.structured,
          markdown_output: reviewResult.markdown,
          metadata: { processing_time_ms: reviewResult.processing_time_ms }
        })
      }
      results.literature_review = {
        success: !reviewResult.error,
        processing_time_ms: reviewResult.processing_time_ms,
        error: reviewResult.error
      }
    }

    // Update project analysis status
    await supabase
      .from('research_projects')
      .update({ analysis_status: 'completed' })
      .eq('id', projectId)

    return NextResponse.json({
      success: true,
      projectId,
      analysisType,
      results,
      total_time_ms: Date.now() - startTime
    })
  } catch (error) {
    console.error('Analysis error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Analysis failed' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/analysis?projectId=xxx
 * 
 * Get analysis results for a project
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
    const analysisType = searchParams.get('type')

    if (!projectId) {
      return NextResponse.json({ error: 'Missing projectId' }, { status: 400 })
    }

    // Verify project ownership
    const { data: project, error: projectError } = await supabase
      .from('research_projects')
      .select('id, user_id, topic')
      .eq('id', projectId)
      .single()

    if (projectError || !project || project.user_id !== user.id) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Get stored analysis
    const analyses = await getAnalysisForProject(
      projectId,
      analysisType as 'claim_extraction' | 'gap_analysis' | 'synthesis' | 'literature_review' | undefined
    )

    // Get gaps
    const gaps = await getGapsForProject(projectId)

    // Get paper IDs associated with project
    const { data: projectPapers } = await supabase
      .from('project_citations')
      .select('paper_id')
      .eq('project_id', projectId)

    const paperIds = projectPapers?.map(p => p.paper_id) || []

    // Get claims for those papers
    const claims: Record<string, unknown[]> = {}
    for (const paperId of paperIds.slice(0, 10)) { // Limit to avoid timeout
      claims[paperId] = await getClaimsForPaper(paperId)
    }

    return NextResponse.json({
      projectId,
      topic: project.topic,
      analyses,
      gaps,
      claims,
      paper_count: paperIds.length
    })
  } catch (error) {
    console.error('Get analysis error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get analysis' },
      { status: 500 }
    )
  }
}
