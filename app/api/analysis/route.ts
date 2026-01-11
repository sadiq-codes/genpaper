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
  getGapsForProject,
  analyzeGapAddressing
} from '@/lib/analysis'
import { 
  extractUserClaims, 
  analyzeClaimRelationships,
  generateResearchPositioning 
} from '@/lib/analysis/user-claim-extractor'
import type { ExtractedClaim, ResearchPositioning } from '@/components/editor/types'

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
    const { 
      projectId, 
      paperIds, 
      topic, 
      analysisType,
      // Original research fields
      hasOriginalResearch,
      researchQuestion,
      keyFindings 
    } = body

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

    // Original research analysis (when user has original research)
    if (hasOriginalResearch && researchQuestion) {
      try {
        // 1. Extract user's claims from their research inputs
        const userClaimsResult = await extractUserClaims(
          researchQuestion,
          keyFindings || '',
          topic
        )
        results.userClaims = userClaimsResult.claims

        // 2. Get all literature claims for comparison (parallel fetch)
        const claimResults = await Promise.all(
          paperIds.slice(0, 10).map(async (paperId: string) => {
            const paperClaims = await getClaimsForPaper(paperId)
            return paperClaims.map(c => ({
              id: c.id || `claim-${paperId}-${Math.random().toString(36).slice(2)}`,
              paper_id: c.paper_id,
              claim_text: c.claim_text,
              evidence_quote: c.evidence_quote,
              section: c.section,
              claim_type: c.claim_type,
              confidence: c.confidence,
              source: 'literature' as const,
              relationship_to_user: 'not_analyzed' as const
            }))
          })
        )
        const allLitClaims: ExtractedClaim[] = claimResults.flat()

        // 3. Analyze relationships between user claims and literature (reused for positioning)
        let claimRelationships: Awaited<ReturnType<typeof analyzeClaimRelationships>> | null = null
        
        if (userClaimsResult.claims.length > 0 && allLitClaims.length > 0) {
          claimRelationships = await analyzeClaimRelationships(
            userClaimsResult.claims,
            allLitClaims
          )
          
          // Apply relationships to literature claims
          for (const claim of allLitClaims) {
            const rel = claimRelationships.get(claim.id)
            if (rel) {
              claim.relationship_to_user = rel.relationship as ExtractedClaim['relationship_to_user']
              claim.relationship_explanation = rel.explanation
            }
          }
          
          results.claimRelationships = Object.fromEntries(claimRelationships)
        }

        // 4. Analyze how user's research addresses gaps
        if (userClaimsResult.claims.length > 0) {
          const gaps = await getGapsForProject(projectId)
          if (gaps.length > 0) {
            const gapAddressing = await analyzeGapAddressing(
              gaps,
              userClaimsResult.claims.map(c => ({
                id: c.id,
                claim_text: c.claim_text,
                claim_type: c.claim_type
              }))
            )
            results.gapAddressing = gapAddressing
          }
        }

        // 5. Generate research positioning (reuse relationships from step 3)
        if (userClaimsResult.claims.length > 0 && allLitClaims.length > 0 && claimRelationships) {
          const positioning = await generateResearchPositioning(
            userClaimsResult.claims,
            allLitClaims,
            claimRelationships
          )
          results.positioning = positioning
        }

        results.hasOriginalResearch = true
      } catch (error) {
        console.error('Original research analysis failed:', error)
        results.originalResearchError = error instanceof Error ? error.message : 'Unknown error'
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

    // Verify project ownership and get original research data
    const { data: project, error: projectError } = await supabase
      .from('research_projects')
      .select('id, user_id, topic, generation_config, has_original_research, research_question, key_findings')
      .eq('id', projectId)
      .single()

    if (projectError || !project || project.user_id !== user.id) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Check if project has original research (from DB or generation_config)
    const genConfig = project.generation_config as Record<string, unknown> | null
    const originalResearchConfig = genConfig?.original_research as Record<string, unknown> | null
    const hasOriginalResearch = project.has_original_research || 
      originalResearchConfig?.has_original_research || false
    const researchQuestion = project.research_question || 
      (originalResearchConfig?.research_question as string) || ''
    const keyFindings = project.key_findings || 
      (originalResearchConfig?.key_findings as string) || ''

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

    // Get claims for those papers (parallel fetch)
    const claimEntries = await Promise.all(
      paperIds.slice(0, 10).map(async (paperId: string) => {
        const paperClaims = await getClaimsForPaper(paperId)
        return [paperId, paperClaims] as const
      })
    )
    const claims: Record<string, unknown[]> = Object.fromEntries(claimEntries)

    // Include original research data if available
    // NOTE: This runs LLM calls on every GET request. Consider caching results
    // in the database during POST to avoid repeated expensive operations.
    let userClaims: ExtractedClaim[] = []
    let positioning: ResearchPositioning | null = null

    if (hasOriginalResearch && researchQuestion) {
      try {
        // Extract user claims (not cached - runs on each request)
        const userClaimsResult = await extractUserClaims(
          researchQuestion,
          keyFindings,
          project.topic
        )
        userClaims = userClaimsResult.claims

        // Get all literature claims for positioning (parallel fetch)
        const litClaimResults = await Promise.all(
          paperIds.slice(0, 10).map(async (paperId: string) => {
            const paperClaims = await getClaimsForPaper(paperId)
            return paperClaims.map(c => ({
              id: c.id || `claim-${paperId}-${Math.random().toString(36).slice(2)}`,
              paper_id: c.paper_id,
              claim_text: c.claim_text,
              evidence_quote: c.evidence_quote,
              section: c.section,
              claim_type: c.claim_type,
              confidence: c.confidence,
              source: 'literature' as const,
              relationship_to_user: 'not_analyzed' as const
            }))
          })
        )
        const allLitClaims: ExtractedClaim[] = litClaimResults.flat()

        // Generate positioning if we have both user claims and literature
        if (userClaims.length > 0 && allLitClaims.length > 0) {
          const relationships = await analyzeClaimRelationships(userClaims, allLitClaims)
          positioning = await generateResearchPositioning(userClaims, allLitClaims, relationships)
        }
      } catch (error) {
        console.error('Failed to generate original research analysis:', error)
      }
    }

    return NextResponse.json({
      projectId,
      topic: project.topic,
      analyses,
      gaps,
      claims,
      paper_count: paperIds.length,
      // Original research data
      hasOriginalResearch,
      userClaims,
      positioning
    })
  } catch (error) {
    console.error('Get analysis error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get analysis' },
      { status: 500 }
    )
  }
}
