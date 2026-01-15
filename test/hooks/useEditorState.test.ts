import { describe, expect, test, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useEditorState } from '@/components/editor/hooks/useEditorState'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('useEditorState', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockFetch.mockReset()
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('initialization', () => {
    test('initializes with default values', () => {
      const { result } = renderHook(() => useEditorState({}))

      expect(result.current.content).toBe('')
      expect(result.current.hasUnsavedChanges).toBe(false)
      expect(result.current.hasUserEdited).toBe(false)
    })

    test('initializes with provided content', () => {
      const { result } = renderHook(() =>
        useEditorState({ initialContent: '# Hello World' })
      )

      expect(result.current.content).toBe('# Hello World')
      expect(result.current.hasUnsavedChanges).toBe(false)
    })
  })

  describe('content updates', () => {
    test('setContent updates content and marks as edited', () => {
      const { result } = renderHook(() => useEditorState({}))

      act(() => {
        result.current.setContent('New content')
      })

      expect(result.current.content).toBe('New content')
      expect(result.current.hasUserEdited).toBe(true)
    })

    test('setContentSilent updates content without marking as edited', () => {
      const { result } = renderHook(() => useEditorState({}))

      act(() => {
        result.current.setContentSilent('Programmatic content')
      })

      expect(result.current.content).toBe('Programmatic content')
      expect(result.current.hasUserEdited).toBe(false)
    })

    test('markAsEdited sets hasUserEdited flag', () => {
      const { result } = renderHook(() => useEditorState({}))

      expect(result.current.hasUserEdited).toBe(false)

      act(() => {
        result.current.markAsEdited()
      })

      expect(result.current.hasUserEdited).toBe(true)
    })
  })

  describe('auto-save', () => {
    test('triggers auto-save after delay when content changes', async () => {
      const { result } = renderHook(() =>
        useEditorState({
          projectId: 'test-project',
          autoSaveDelay: 1000,
        })
      )

      act(() => {
        result.current.setContent('New content to save')
      })

      // Auto-save shouldn't have been called yet
      expect(mockFetch).not.toHaveBeenCalled()

      // Advance past the debounce delay
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })

      expect(mockFetch).toHaveBeenCalledWith('/api/editor/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'test-project',
          content: 'New content to save',
        }),
      })
    })

    test('does not auto-save without projectId', async () => {
      const { result } = renderHook(() =>
        useEditorState({ autoSaveDelay: 1000 })
      )

      act(() => {
        result.current.setContent('Content without project')
      })

      await act(async () => {
        vi.advanceTimersByTime(1000)
      })

      expect(mockFetch).not.toHaveBeenCalled()
    })

    test('does not auto-save if content was not user-edited', async () => {
      const { result } = renderHook(() =>
        useEditorState({
          projectId: 'test-project',
          autoSaveDelay: 1000,
        })
      )

      act(() => {
        result.current.setContentSilent('Programmatic content')
      })

      await act(async () => {
        vi.advanceTimersByTime(1000)
      })

      expect(mockFetch).not.toHaveBeenCalled()
    })

    test('debounces multiple rapid changes', async () => {
      const { result } = renderHook(() =>
        useEditorState({
          projectId: 'test-project',
          autoSaveDelay: 1000,
        })
      )

      // Make multiple rapid changes
      act(() => {
        result.current.setContent('First change')
      })

      await act(async () => {
        vi.advanceTimersByTime(500)
      })

      act(() => {
        result.current.setContent('Second change')
      })

      await act(async () => {
        vi.advanceTimersByTime(500)
      })

      act(() => {
        result.current.setContent('Third change')
      })

      // Only wait for the debounce after the last change
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })

      // Should only save once with the final content
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith('/api/editor/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'test-project',
          content: 'Third change',
        }),
      })
    })

    test('clears hasUnsavedChanges after successful save', async () => {
      const { result } = renderHook(() =>
        useEditorState({
          projectId: 'test-project',
          autoSaveDelay: 1000,
        })
      )

      act(() => {
        result.current.setContent('Content to save')
      })

      // hasUnsavedChanges should become true after setting content
      await act(async () => {
        vi.advanceTimersByTime(100)
      })

      expect(result.current.hasUnsavedChanges).toBe(true)

      // Complete the auto-save
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })

      expect(result.current.hasUnsavedChanges).toBe(false)
    })
  })

  describe('manual save', () => {
    test('saveContent triggers immediate save', async () => {
      const { result } = renderHook(() =>
        useEditorState({
          projectId: 'test-project',
          initialContent: 'Initial content',
        })
      )

      await act(async () => {
        await result.current.saveContent()
      })

      expect(mockFetch).toHaveBeenCalledWith('/api/editor/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'test-project',
          content: 'Initial content',
        }),
      })
    })

    test('saveContent does nothing without projectId', async () => {
      const { result } = renderHook(() =>
        useEditorState({ initialContent: 'Some content' })
      )

      await act(async () => {
        await result.current.saveContent()
      })

      expect(mockFetch).not.toHaveBeenCalled()
    })

    test('saveContent does nothing without content', async () => {
      const { result } = renderHook(() =>
        useEditorState({ projectId: 'test-project' })
      )

      await act(async () => {
        await result.current.saveContent()
      })

      expect(mockFetch).not.toHaveBeenCalled()
    })

    test('calls onSave callback after successful save', async () => {
      const onSave = vi.fn()
      const { result } = renderHook(() =>
        useEditorState({
          projectId: 'test-project',
          initialContent: 'Content to save',
          onSave,
        })
      )

      await act(async () => {
        await result.current.saveContent()
      })

      expect(onSave).toHaveBeenCalledWith('Content to save')
    })
  })

  describe('error handling', () => {
    test('handles save failure gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() =>
        useEditorState({
          projectId: 'test-project',
          initialContent: 'Content',
        })
      )

      await act(async () => {
        await result.current.saveContent()
      })

      expect(consoleSpy).toHaveBeenCalledWith('Auto-save failed:', expect.any(Error))
      consoleSpy.mockRestore()
    })
  })

  describe('beforeunload handler', () => {
    test('registers beforeunload handler', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener')

      renderHook(() =>
        useEditorState({
          projectId: 'test-project',
        })
      )

      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'beforeunload',
        expect.any(Function)
      )

      addEventListenerSpy.mockRestore()
    })

    test('removes beforeunload handler on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

      const { unmount } = renderHook(() =>
        useEditorState({
          projectId: 'test-project',
        })
      )

      unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'beforeunload',
        expect.any(Function)
      )

      removeEventListenerSpy.mockRestore()
    })
  })
})
