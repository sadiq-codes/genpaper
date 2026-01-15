/**
 * useAnalysis - Manages paper analysis state and operations
 * 
 * Responsibilities:
 * - Analysis state (claims, gaps, synthesis)
 * - Running analysis
 * - Auto-run on paper changes
 */

import { useState, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import type {
  AnalysisState,
  ExtractedClaim,
  AnalysisOutput,
  ProjectPaper,
} from '../types'

interface UseAnalysisOptions {
  projectId?: string
  projectTitle?: string
  papers: ProjectPaper[]
  initialAnalysis?: {
    claims: ExtractedClaim[]
    gaps: AnalysisState['gaps']
    synthesis: AnalysisOutput | null
  }
  /** Auto-run analysis when papers change */
  autoRun?: boolean
}

interface UseAnalysisReturn {
  /** Current analysis state */
  analysisState: AnalysisState
  /** Run or re-run analysis */
  runAnalysis: () => Promise<void>
  /** Whether analysis is in progress */
  isAnalyzing: boolean
  /** Update analysis state (for external updates) */
  setAnalysisState: React.Dispatch<React.SetStateAction<AnalysisState>>
}

export function useAnalysis({
  projectId,
  projectTitle,
  papers,
  initialAnalysis,
  autoRun = true,
}: UseAnalysisOptions): UseAnalysisReturn {
  const [analysisState, setAnalysisState] = useState<AnalysisState>({
    status: initialAnalysis ? 'complete' : 'idle',
    claims: initialAnalysis?.claims || [],
    userClaims: [],
    gaps: initialAnalysis?.gaps || [],
    synthesis: initialAnalysis?.synthesis || null,
    positioning: null,
    hasOriginalResearch: false,
  })

  const runAnalysis = useCallback(async () => {
    if (!projectId || papers.length === 0) return

    setAnalysisState(prev => ({ ...prev, status: 'analyzing' }))

    try {
      const response = await fetch('/api/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          paperIds: papers.map(p => p.id),
          topic: projectTitle,
          analysisType: 'full',
        }),
      })

      if (!response.ok) throw new Error('Analysis failed')

      // Refetch analysis data
      const analysisResponse = await fetch(`/api/analysis?projectId=${projectId}`)
      if (analysisResponse.ok) {
        const data = await analysisResponse.json()

        // Flatten claims and add paper info
        const allClaims: ExtractedClaim[] = []
        for (const paperId of Object.keys(data.claims || {})) {
          const paper = papers.find(p => p.id === paperId)
          const paperClaims = (data.claims[paperId] || []).map((claim: ExtractedClaim) => ({
            ...claim,
            paper_title: paper?.title,
            paper_authors: paper?.authors,
            paper_year: paper?.year,
          }))
          allClaims.push(...paperClaims)
        }

        setAnalysisState(prev => ({
          ...prev,
          status: 'complete',
          claims: allClaims,
          gaps: data.gaps || [],
          synthesis: data.analyses?.find((a: AnalysisOutput) => a.analysis_type === 'synthesis') || null,
          lastAnalyzedAt: new Date().toISOString(),
          userClaims: data.userClaims || prev.userClaims || [],
          positioning: data.positioning || prev.positioning || null,
          hasOriginalResearch: data.hasOriginalResearch || prev.hasOriginalResearch || false,
        }))

        toast.success('Analysis complete', {
          description: `${allClaims.length} claims extracted, ${(data.gaps || []).length} gaps found`,
        })
      }
    } catch (error) {
      console.error('Analysis failed:', error)
      setAnalysisState(prev => ({
        ...prev,
        status: 'error',
        error: error instanceof Error ? error.message : 'Analysis failed',
      }))
      toast.error('Analysis failed', {
        description: 'Please try again',
      })
    }
  }, [projectId, papers, projectTitle])

  // Auto-run analysis on mount if papers exist but no analysis
  useEffect(() => {
    if (
      autoRun &&
      projectId &&
      papers.length > 0 &&
      analysisState.status === 'idle' &&
      analysisState.claims.length === 0
    ) {
      runAnalysis()
    }
  }, [projectId, papers.length, autoRun]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    analysisState,
    runAnalysis,
    isAnalyzing: analysisState.status === 'analyzing',
    setAnalysisState,
  }
}
