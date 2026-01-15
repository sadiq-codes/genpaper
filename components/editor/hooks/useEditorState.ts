/**
 * useEditorState - Manages editor content state, auto-save, and persistence
 * 
 * Responsibilities:
 * - Content state management
 * - Auto-save with debounce
 * - Unsaved changes tracking
 * - Page unload handling
 */

import { useState, useCallback, useEffect, useRef } from 'react'

interface UseEditorStateOptions {
  projectId?: string
  initialContent?: string
  onSave?: (content: string) => void
  /** Debounce delay for auto-save in ms */
  autoSaveDelay?: number
}

interface EditorState {
  content: string
  hasUnsavedChanges: boolean
  hasUserEdited: boolean
}

interface UseEditorStateReturn {
  /** Current content */
  content: string
  /** Whether there are unsaved changes */
  hasUnsavedChanges: boolean
  /** Whether the user has made any edits */
  hasUserEdited: boolean
  /** Update content (triggers auto-save) */
  setContent: (content: string) => void
  /** Mark content as edited by user */
  markAsEdited: () => void
  /** Manually trigger save */
  saveContent: () => Promise<void>
  /** Set content without triggering user edit flag (for programmatic updates) */
  setContentSilent: (content: string) => void
}

export function useEditorState({
  projectId,
  initialContent = '',
  onSave,
  autoSaveDelay = 2000,
}: UseEditorStateOptions): UseEditorStateReturn {
  const [state, setState] = useState<EditorState>({
    content: initialContent,
    hasUnsavedChanges: false,
    hasUserEdited: false,
  })

  // Keep content ref in sync for save operations
  const contentRef = useRef(state.content)
  useEffect(() => {
    contentRef.current = state.content
  }, [state.content])

  // Save function
  const saveContent = useCallback(async () => {
    if (!projectId || !contentRef.current) return

    try {
      await fetch('/api/editor/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, content: contentRef.current }),
      })
      setState(prev => ({ ...prev, hasUnsavedChanges: false }))
      onSave?.(contentRef.current)
    } catch (error) {
      console.error('Auto-save failed:', error)
    }
  }, [projectId, onSave])

  // Auto-save effect with debounce
  useEffect(() => {
    if (!projectId || !state.content || !state.hasUserEdited) return

    setState(prev => ({ ...prev, hasUnsavedChanges: true }))
    const timer = setTimeout(() => {
      saveContent()
    }, autoSaveDelay)

    return () => clearTimeout(timer)
  }, [state.content, projectId, saveContent, state.hasUserEdited, autoSaveDelay])

  // Save on page unload
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (state.hasUnsavedChanges) {
        saveContent()
        e.preventDefault()
        e.returnValue = ''
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [state.hasUnsavedChanges, saveContent])

  // Public setters
  const setContent = useCallback((content: string) => {
    setState(prev => ({
      ...prev,
      content,
      hasUserEdited: true,
    }))
  }, [])

  const setContentSilent = useCallback((content: string) => {
    setState(prev => ({
      ...prev,
      content,
    }))
  }, [])

  const markAsEdited = useCallback(() => {
    setState(prev => ({ ...prev, hasUserEdited: true }))
  }, [])

  return {
    content: state.content,
    hasUnsavedChanges: state.hasUnsavedChanges,
    hasUserEdited: state.hasUserEdited,
    setContent,
    markAsEdited,
    saveContent,
    setContentSilent,
  }
}
