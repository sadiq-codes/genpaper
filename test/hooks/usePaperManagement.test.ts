import { describe, expect, test, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { usePaperManagement } from '@/components/editor/hooks/usePaperManagement'
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

const newPaper: ProjectPaper = {
  id: 'paper-3',
  title: 'New Paper Title That Is Very Long For Testing Truncation',
  authors: ['Author D'],
  year: 2025,
  abstract: 'New abstract',
}

describe('usePaperManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    // Default mock - always return success
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    })
  })

  afterEach(() => {
    cleanup()
  })

  describe('initialization', () => {
    test('initializes with empty papers by default', () => {
      const { result } = renderHook(() =>
        usePaperManagement({ projectId: 'test-project' })
      )

      expect(result.current.papers).toEqual([])
      expect(result.current.isLoading).toBe(false)
      expect(result.current.removePaperDialog.open).toBe(false)
    })

    test('initializes with provided initial papers', () => {
      const { result } = renderHook(() =>
        usePaperManagement({
          projectId: 'test-project',
          initialPapers: mockPapers,
        })
      )

      expect(result.current.papers).toEqual(mockPapers)
    })
  })

  describe('addPaper', () => {
    test('successfully adds a paper', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ paper: newPaper }),
      })

      const onPaperAdded = vi.fn()
      const { result } = renderHook(() =>
        usePaperManagement({
          projectId: 'test-project',
          initialPapers: mockPapers,
          onPaperAdded,
        })
      )

      await act(async () => {
        await result.current.addPaper('paper-3', 'New Paper Title')
      })

      expect(mockFetch).toHaveBeenCalledWith('/api/editor/papers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'test-project',
          paperId: 'paper-3',
        }),
      })

      expect(result.current.papers).toHaveLength(3)
      expect(result.current.papers[2]).toEqual(newPaper)
      expect(toast.success).toHaveBeenCalledWith('Paper added to project', {
        description: 'New Paper Title',
        action: expect.objectContaining({
          label: 'Re-analyze',
        }),
      })
    })

    test('truncates long titles in toast', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ paper: newPaper }),
      })

      const { result } = renderHook(() =>
        usePaperManagement({
          projectId: 'test-project',
        })
      )

      const longTitle = 'A'.repeat(100)
      await act(async () => {
        await result.current.addPaper('paper-3', longTitle)
      })

      expect(toast.success).toHaveBeenCalledWith('Paper added to project', {
        description: 'A'.repeat(50) + '...',
        action: undefined,
      })
    })

    test('handles 409 conflict (paper already exists)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ error: 'Paper already in project' }),
      })

      const { result } = renderHook(() =>
        usePaperManagement({
          projectId: 'test-project',
          initialPapers: mockPapers,
        })
      )

      await act(async () => {
        await result.current.addPaper('paper-1', 'Test Paper 1')
      })

      expect(toast.info).toHaveBeenCalledWith('Paper already in project')
      expect(result.current.papers).toHaveLength(2) // No change
    })

    test('handles other errors', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Server error' }),
      })

      const { result } = renderHook(() =>
        usePaperManagement({
          projectId: 'test-project',
        })
      )

      await act(async () => {
        await result.current.addPaper('paper-3', 'New Paper')
      })

      expect(toast.error).toHaveBeenCalledWith('Failed to add paper')
      consoleSpy.mockRestore()
    })

    test('does nothing without projectId', async () => {
      const { result } = renderHook(() =>
        usePaperManagement({ projectId: undefined })
      )

      await act(async () => {
        await result.current.addPaper('paper-3', 'New Paper')
      })

      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('removePaper', () => {
    test('opens confirmation dialog with paper details', () => {
      const { result } = renderHook(() =>
        usePaperManagement({
          projectId: 'test-project',
          initialPapers: mockPapers,
        })
      )

      act(() => {
        result.current.removePaper('paper-1', 5)
      })

      expect(result.current.removePaperDialog).toEqual({
        open: true,
        paperId: 'paper-1',
        paperTitle: 'Test Paper 1',
        claimCount: 5,
      })
    })

    test('does nothing for non-existent paper', () => {
      const { result } = renderHook(() =>
        usePaperManagement({
          projectId: 'test-project',
          initialPapers: mockPapers,
        })
      )

      act(() => {
        result.current.removePaper('non-existent', 0)
      })

      expect(result.current.removePaperDialog.open).toBe(false)
    })
  })

  describe('confirmRemovePaper', () => {
    test('removes paper and calls onPaperRemoved when deleting claims', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ claimsDeleted: 5 }),
      })

      const onPaperRemoved = vi.fn()
      const { result } = renderHook(() =>
        usePaperManagement({
          projectId: 'test-project',
          initialPapers: mockPapers,
          onPaperRemoved,
        })
      )

      // Open dialog first
      act(() => {
        result.current.removePaper('paper-1', 5)
      })

      // Confirm removal
      await act(async () => {
        await result.current.confirmRemovePaper(true)
      })

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/editor/papers?projectId=test-project&paperId=paper-1&deleteClaims=true',
        { method: 'DELETE' }
      )

      expect(result.current.papers).toHaveLength(1)
      expect(result.current.papers[0].id).toBe('paper-2')
      expect(onPaperRemoved).toHaveBeenCalledWith('paper-1')
      expect(toast.success).toHaveBeenCalledWith('Paper removed', {
        description: '5 claims also removed',
      })
      expect(result.current.removePaperDialog.open).toBe(false)
    })

    test('removes paper without calling onPaperRemoved when keeping claims', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ claimsDeleted: 0 }),
      })

      const onPaperRemoved = vi.fn()
      const { result } = renderHook(() =>
        usePaperManagement({
          projectId: 'test-project',
          initialPapers: mockPapers,
          onPaperRemoved,
        })
      )

      act(() => {
        result.current.removePaper('paper-1', 0)
      })

      await act(async () => {
        await result.current.confirmRemovePaper(false)
      })

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/editor/papers?projectId=test-project&paperId=paper-1&deleteClaims=false',
        { method: 'DELETE' }
      )

      expect(onPaperRemoved).not.toHaveBeenCalled()
      expect(toast.success).toHaveBeenCalledWith('Paper removed', {
        description: undefined,
      })
    })

    test('handles removal failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Failed' }),
      })

      const { result } = renderHook(() =>
        usePaperManagement({
          projectId: 'test-project',
          initialPapers: mockPapers,
        })
      )

      act(() => {
        result.current.removePaper('paper-1', 0)
      })

      await act(async () => {
        await result.current.confirmRemovePaper(false)
      })

      expect(toast.error).toHaveBeenCalledWith('Failed to remove paper')
      expect(result.current.papers).toHaveLength(2) // No change
      expect(result.current.removePaperDialog.open).toBe(false)
      consoleSpy.mockRestore()
    })

    test('does nothing without projectId', async () => {
      const { result } = renderHook(() =>
        usePaperManagement({
          projectId: undefined,
          initialPapers: mockPapers,
        })
      )

      // Force dialog open state (though removePaper won't work without papers lookup)
      // Instead, test that confirmRemovePaper returns early without projectId
      act(() => {
        // Manually trigger dialog open state for this edge case test
        result.current.removePaper('paper-1', 0)
      })

      // Since removePaper found the paper, dialog is open
      // Now try to confirm without projectId
      await act(async () => {
        await result.current.confirmRemovePaper(true)
      })

      // Since projectId is undefined, it should return early
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('closeRemovePaperDialog', () => {
    test('closes the dialog', () => {
      const { result } = renderHook(() =>
        usePaperManagement({
          projectId: 'test-project',
          initialPapers: mockPapers,
        })
      )

      // Open dialog
      act(() => {
        result.current.removePaper('paper-1', 5)
      })

      expect(result.current.removePaperDialog.open).toBe(true)

      // Close dialog
      act(() => {
        result.current.closeRemovePaperDialog()
      })

      expect(result.current.removePaperDialog.open).toBe(false)
    })
  })

  describe('setPapers', () => {
    test('allows direct papers state updates', () => {
      const { result } = renderHook(() =>
        usePaperManagement({
          projectId: 'test-project',
          initialPapers: mockPapers,
        })
      )

      act(() => {
        result.current.setPapers((prev) => [...prev, newPaper])
      })

      expect(result.current.papers).toHaveLength(3)
      expect(result.current.papers[2]).toEqual(newPaper)
    })

    test('allows replacing papers entirely', () => {
      const { result } = renderHook(() =>
        usePaperManagement({
          projectId: 'test-project',
          initialPapers: mockPapers,
        })
      )

      act(() => {
        result.current.setPapers([newPaper])
      })

      expect(result.current.papers).toHaveLength(1)
      expect(result.current.papers[0]).toEqual(newPaper)
    })
  })
})
