import { describe, expect, test, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { useBackgroundPaperSearch } from '@/components/editor/hooks/useBackgroundPaperSearch'
import type { ProjectPaper } from '@/components/editor/types'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

import { toast } from 'sonner'

const mockSearchResults = {
  papers: [
    {
      id: 'paper-1',
      title: 'Test Paper 1',
      authors: ['Author A'],
      year: 2023,
      abstract: 'Abstract 1',
    },
    {
      id: 'paper-2',
      title: 'Test Paper 2',
      authors: ['Author B'],
      year: 2024,
      abstract: 'Abstract 2',
    },
  ],
}

const mockAddedPaper: ProjectPaper = {
  id: 'paper-1',
  title: 'Test Paper 1',
  authors: ['Author A'],
  year: 2023,
  abstract: 'Abstract 1',
}

describe('useBackgroundPaperSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  describe('initialization', () => {
    test('initializes with default state', () => {
      const { result } = renderHook(() =>
        useBackgroundPaperSearch({
          projectId: 'test-project',
          topic: 'test topic',
          enabled: false,
        })
      )

      expect(result.current.isSearching).toBe(false)
      expect(result.current.papersFound).toBe(0)
      expect(result.current.error).toBeNull()
    })
  })

  describe('auto-search', () => {
    test('automatically searches when enabled', async () => {
      // Use real timers for this test since the hook has complex async interactions
      vi.useRealTimers()
      
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockSearchResults),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ paper: mockAddedPaper }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ paper: { ...mockAddedPaper, id: 'paper-2' } }),
        })

      const onPapersFound = vi.fn()

      renderHook(() =>
        useBackgroundPaperSearch({
          projectId: 'test-project',
          topic: 'machine learning',
          enabled: true,
          onPapersFound,
        })
      )

      // Wait for the delayed search to trigger
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/papers?search=machine%20learning&maxResults=10&ingest=true'
        )
      }, { timeout: 3000 })
      
      // Restore fake timers for other tests
      vi.useFakeTimers()
    })

    test('does not search when disabled', async () => {
      renderHook(() =>
        useBackgroundPaperSearch({
          projectId: 'test-project',
          topic: 'test topic',
          enabled: false,
        })
      )

      await act(async () => {
        vi.advanceTimersByTime(2000)
      })

      expect(mockFetch).not.toHaveBeenCalled()
    })

    test('does not search without projectId', async () => {
      renderHook(() =>
        useBackgroundPaperSearch({
          projectId: undefined,
          topic: 'test topic',
          enabled: true,
        })
      )

      await act(async () => {
        vi.advanceTimersByTime(2000)
      })

      expect(mockFetch).not.toHaveBeenCalled()
    })

    test('does not search without topic', async () => {
      renderHook(() =>
        useBackgroundPaperSearch({
          projectId: 'test-project',
          topic: undefined,
          enabled: true,
        })
      )

      await act(async () => {
        vi.advanceTimersByTime(2000)
      })

      expect(mockFetch).not.toHaveBeenCalled()
    })

    test('only searches once', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ papers: [] }),
        })

      const { rerender } = renderHook(
        ({ enabled }) =>
          useBackgroundPaperSearch({
            projectId: 'test-project',
            topic: 'test topic',
            enabled,
          }),
        { initialProps: { enabled: true } }
      )

      await act(async () => {
        vi.advanceTimersByTime(2000)
      })

      // Re-enable should not trigger another search
      rerender({ enabled: false })
      rerender({ enabled: true })

      await act(async () => {
        vi.advanceTimersByTime(2000)
      })

      // Should only have been called once
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('manual search', () => {
    test('triggerSearch can be called manually', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockSearchResults),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ paper: mockAddedPaper }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ paper: { ...mockAddedPaper, id: 'paper-2' } }),
        })

      const onPapersFound = vi.fn()

      const { result } = renderHook(() =>
        useBackgroundPaperSearch({
          projectId: 'test-project',
          topic: 'test topic',
          enabled: false,
          onPapersFound,
        })
      )

      await act(async () => {
        await result.current.triggerSearch()
      })

      expect(mockFetch).toHaveBeenCalled()
      expect(onPapersFound).toHaveBeenCalledWith(expect.any(Array))
    })
  })

  describe('error handling', () => {
    test('handles search API failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockFetch.mockResolvedValueOnce({ ok: false })

      const { result } = renderHook(() =>
        useBackgroundPaperSearch({
          projectId: 'test-project',
          topic: 'test topic',
          enabled: false,
        })
      )

      await act(async () => {
        await result.current.triggerSearch()
      })

      expect(result.current.error).toBe('Failed to search for papers')
      expect(toast.error).toHaveBeenCalledWith('Paper search failed', {
        description: 'You can still add papers manually from the library',
      })

      consoleSpy.mockRestore()
    })

    test('handles network error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() =>
        useBackgroundPaperSearch({
          projectId: 'test-project',
          topic: 'test topic',
          enabled: false,
        })
      )

      await act(async () => {
        await result.current.triggerSearch()
      })

      expect(result.current.error).toBe('Network error')

      consoleSpy.mockRestore()
    })
  })

  describe('empty results', () => {
    test('shows info toast when no papers found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ papers: [] }),
      })

      const { result } = renderHook(() =>
        useBackgroundPaperSearch({
          projectId: 'test-project',
          topic: 'obscure topic',
          enabled: false,
        })
      )

      await act(async () => {
        await result.current.triggerSearch()
      })

      expect(toast.info).toHaveBeenCalledWith('No papers found', {
        description: 'Try adding papers manually from the library',
      })
    })
  })

  describe('paper adding', () => {
    test('handles 409 conflict (paper already in project)', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockSearchResults),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 409,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ paper: { ...mockAddedPaper, id: 'paper-2' } }),
        })

      const onPapersFound = vi.fn()

      const { result } = renderHook(() =>
        useBackgroundPaperSearch({
          projectId: 'test-project',
          topic: 'test topic',
          enabled: false,
          onPapersFound,
        })
      )

      await act(async () => {
        await result.current.triggerSearch()
      })

      // Should still call onPapersFound with the one successful paper
      expect(onPapersFound).toHaveBeenCalled()
      expect(result.current.papersFound).toBe(1)
    })

    test('respects maxPapers limit', async () => {
      const manyPapers = Array.from({ length: 20 }, (_, i) => ({
        id: `paper-${i}`,
        title: `Paper ${i}`,
        authors: ['Author'],
        year: 2023,
      }))

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ papers: manyPapers }),
        })

      // Mock 5 add requests (maxPapers = 5)
      for (let i = 0; i < 5; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ paper: manyPapers[i] }),
        })
      }

      const { result } = renderHook(() =>
        useBackgroundPaperSearch({
          projectId: 'test-project',
          topic: 'test topic',
          enabled: false,
          maxPapers: 5,
        })
      )

      await act(async () => {
        await result.current.triggerSearch()
      })

      // Should have called search once + add 5 times
      expect(mockFetch).toHaveBeenCalledTimes(6)
    })
  })
})
