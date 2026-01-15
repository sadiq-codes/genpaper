import { describe, expect, test, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAnalysis } from '@/components/editor/hooks/useAnalysis'
import type { ProjectPaper, ExtractedClaim } from '@/components/editor/types'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import { toast } from 'sonner'

const mockPapers: ProjectPaper[] = [
  {
    id: 'paper-1',
    title: 'Test Paper 1',
    authors: ['Author A'],
    year: 2023,
    abstract: 'Abstract for paper 1',
  },
  {
    id: 'paper-2',
    title: 'Test Paper 2',
    authors: ['Author B', 'Author C'],
    year: 2024,
    abstract: 'Abstract for paper 2',
  },
]

const mockAnalysisResponse = {
  claims: {
    'paper-1': [
      {
        id: 'claim-1',
        paper_id: 'paper-1',
        claim_text: 'Finding from paper 1',
        claim_type: 'finding',
        confidence: 0.9,
        source: 'literature',
      },
    ],
    'paper-2': [
      {
        id: 'claim-2',
        paper_id: 'paper-2',
        claim_text: 'Method from paper 2',
        claim_type: 'method',
        confidence: 0.85,
        source: 'literature',
      },
    ],
  },
  gaps: [
    {
      id: 'gap-1',
      project_id: 'test-project',
      gap_type: 'unstudied',
      description: 'Gap in research',
      confidence: 0.8,
      supporting_paper_ids: ['paper-1'],
      addressed_status: 'not_analyzed',
    },
  ],
  analyses: [
    {
      id: 'analysis-1',
      project_id: 'test-project',
      analysis_type: 'synthesis',
      status: 'completed',
    },
  ],
}

describe('useAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    // Default mock for all tests - successful but empty analysis
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
  })

  describe('initialization', () => {
    test('initializes with idle status when no initial analysis', () => {
      const { result } = renderHook(() =>
        useAnalysis({
          projectId: 'test-project',
          papers: mockPapers,
          autoRun: false, // Disable auto-run for this test
        })
      )

      expect(result.current.analysisState.status).toBe('idle')
      expect(result.current.analysisState.claims).toEqual([])
      expect(result.current.analysisState.gaps).toEqual([])
      expect(result.current.analysisState.synthesis).toBeNull()
      expect(result.current.isAnalyzing).toBe(false)
    })

    test('initializes with complete status when initial analysis provided', () => {
      const initialClaims: ExtractedClaim[] = [
        {
          id: 'existing-claim',
          paper_id: 'paper-1',
          claim_text: 'Existing claim',
          claim_type: 'finding',
          confidence: 0.9,
          source: 'literature',
        },
      ]

      const { result } = renderHook(() =>
        useAnalysis({
          projectId: 'test-project',
          papers: mockPapers,
          autoRun: false,
          initialAnalysis: {
            claims: initialClaims,
            gaps: [],
            synthesis: null,
          },
        })
      )

      expect(result.current.analysisState.status).toBe('complete')
      expect(result.current.analysisState.claims).toEqual(initialClaims)
    })
  })

  describe('runAnalysis', () => {
    test('successfully runs analysis and updates state', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) }) // POST /api/analysis
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockAnalysisResponse) }) // GET /api/analysis

      const { result } = renderHook(() =>
        useAnalysis({
          projectId: 'test-project',
          projectTitle: 'Test Project',
          papers: mockPapers,
          autoRun: false,
        })
      )

      await act(async () => {
        await result.current.runAnalysis()
      })

      // Check API calls
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(mockFetch).toHaveBeenNthCalledWith(1, '/api/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'test-project',
          paperIds: ['paper-1', 'paper-2'],
          topic: 'Test Project',
          analysisType: 'full',
        }),
      })

      // Check state update
      expect(result.current.analysisState.status).toBe('complete')
      expect(result.current.analysisState.claims).toHaveLength(2)
      expect(result.current.analysisState.gaps).toHaveLength(1)
      expect(toast.success).toHaveBeenCalledWith('Analysis complete', {
        description: '2 claims extracted, 1 gaps found',
      })
    })

    test('does not run analysis without projectId', async () => {
      const { result } = renderHook(() =>
        useAnalysis({
          projectId: undefined,
          papers: mockPapers,
          autoRun: false,
        })
      )

      await act(async () => {
        await result.current.runAnalysis()
      })

      expect(mockFetch).not.toHaveBeenCalled()
      expect(result.current.analysisState.status).toBe('idle')
    })

    test('does not run analysis without papers', async () => {
      const { result } = renderHook(() =>
        useAnalysis({
          projectId: 'test-project',
          papers: [],
          autoRun: false,
        })
      )

      await act(async () => {
        await result.current.runAnalysis()
      })

      expect(mockFetch).not.toHaveBeenCalled()
      expect(result.current.analysisState.status).toBe('idle')
    })

    test('handles analysis POST failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockFetch.mockResolvedValueOnce({ ok: false })

      const { result } = renderHook(() =>
        useAnalysis({
          projectId: 'test-project',
          papers: mockPapers,
          autoRun: false,
        })
      )

      await act(async () => {
        await result.current.runAnalysis()
      })

      expect(result.current.analysisState.status).toBe('error')
      expect(result.current.analysisState.error).toBe('Analysis failed')
      expect(toast.error).toHaveBeenCalledWith('Analysis failed', {
        description: 'Please try again',
      })

      consoleSpy.mockRestore()
    })

    test('handles network error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() =>
        useAnalysis({
          projectId: 'test-project',
          papers: mockPapers,
          autoRun: false,
        })
      )

      await act(async () => {
        await result.current.runAnalysis()
      })

      expect(result.current.analysisState.status).toBe('error')
      expect(result.current.analysisState.error).toBe('Network error')

      consoleSpy.mockRestore()
    })

    test('enriches claims with paper metadata', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockAnalysisResponse) })

      const { result } = renderHook(() =>
        useAnalysis({
          projectId: 'test-project',
          papers: mockPapers,
          autoRun: false,
        })
      )

      await act(async () => {
        await result.current.runAnalysis()
      })

      // Check that claims have paper metadata
      const paper1Claim = result.current.analysisState.claims.find(
        (c) => c.paper_id === 'paper-1'
      )
      expect(paper1Claim?.paper_title).toBe('Test Paper 1')
      expect(paper1Claim?.paper_authors).toEqual(['Author A'])
      expect(paper1Claim?.paper_year).toBe(2023)
    })
  })

  describe('auto-run', () => {
    test('auto-runs analysis when enabled and papers exist', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockAnalysisResponse) })

      const { result } = renderHook(() =>
        useAnalysis({
          projectId: 'test-project',
          papers: mockPapers,
          autoRun: true,
        })
      )

      // Wait for the effect to fire
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled()
      })

      // Also wait for completion
      await waitFor(() => {
        expect(result.current.analysisState.status).toBe('complete')
      })
    })

    test('does not auto-run when disabled', async () => {
      const { result } = renderHook(() =>
        useAnalysis({
          projectId: 'test-project',
          papers: mockPapers,
          autoRun: false,
        })
      )

      // Give it some time to potentially run
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(mockFetch).not.toHaveBeenCalled()
      expect(result.current.analysisState.status).toBe('idle')
    })

    test('does not auto-run if claims already exist', async () => {
      const initialClaims: ExtractedClaim[] = [
        {
          id: 'existing-claim',
          claim_text: 'Existing claim',
          claim_type: 'finding',
          confidence: 0.9,
          source: 'literature',
        },
      ]

      const { result } = renderHook(() =>
        useAnalysis({
          projectId: 'test-project',
          papers: mockPapers,
          autoRun: true,
          initialAnalysis: {
            claims: initialClaims,
            gaps: [],
            synthesis: null,
          },
        })
      )

      // Give it some time to potentially run
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Should not have called fetch because there's already claims
      // and status is 'complete' (not 'idle')
      expect(mockFetch).not.toHaveBeenCalled()
      expect(result.current.analysisState.status).toBe('complete')
    })

    test('does not auto-run without papers', async () => {
      const { result } = renderHook(() =>
        useAnalysis({
          projectId: 'test-project',
          papers: [],
          autoRun: true,
        })
      )

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(mockFetch).not.toHaveBeenCalled()
      expect(result.current.analysisState.status).toBe('idle')
    })
  })

  describe('setAnalysisState', () => {
    test('allows external state updates', async () => {
      const { result } = renderHook(() =>
        useAnalysis({
          projectId: 'test-project',
          papers: mockPapers,
          autoRun: false,
        })
      )

      act(() => {
        result.current.setAnalysisState((prev) => ({
          ...prev,
          hasOriginalResearch: true,
        }))
      })

      expect(result.current.analysisState.hasOriginalResearch).toBe(true)
    })

    test('can update claims from external source', () => {
      const { result } = renderHook(() =>
        useAnalysis({
          projectId: 'test-project',
          papers: mockPapers,
          autoRun: false,
        })
      )

      const newClaim: ExtractedClaim = {
        id: 'user-claim-1',
        claim_text: 'User hypothesis',
        claim_type: 'hypothesis',
        confidence: 1.0,
        source: 'original_research',
      }

      act(() => {
        result.current.setAnalysisState((prev) => ({
          ...prev,
          userClaims: [...prev.userClaims, newClaim],
        }))
      })

      expect(result.current.analysisState.userClaims).toHaveLength(1)
      expect(result.current.analysisState.userClaims[0].claim_text).toBe('User hypothesis')
    })
  })

  describe('isAnalyzing computed property', () => {
    test('returns true only when status is analyzing', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockAnalysisResponse) })

      const { result } = renderHook(() =>
        useAnalysis({
          projectId: 'test-project',
          papers: mockPapers,
          autoRun: false,
        })
      )

      expect(result.current.isAnalyzing).toBe(false)

      // Start analysis and check during
      const analysisPromise = act(async () => {
        await result.current.runAnalysis()
      })

      await analysisPromise

      // After completion
      expect(result.current.isAnalyzing).toBe(false)
      expect(result.current.analysisState.status).toBe('complete')
    })
  })
})
