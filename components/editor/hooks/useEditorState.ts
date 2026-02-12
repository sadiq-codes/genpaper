/**
 * useEditorState - Manages editor content state, auto-save, and persistence
 * 
 * Responsibilities:
 * - Content state management
 * - Auto-save with debounce
 * - Unsaved changes tracking
 * - Page unload handling
 * - Offline detection with localStorage fallback
 * - Auto-sync when connection restores
 */

import { useState, useCallback, useEffect, useRef } from 'react'

const LOCAL_STORAGE_PREFIX = 'genpaper:draft:'

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
  /** Whether the app is currently offline */
  isOffline: boolean
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

  const [isOffline, setIsOffline] = useState(false)

  // Keep content ref in sync for save operations
  const contentRef = useRef(state.content)
  useEffect(() => {
    contentRef.current = state.content
  }, [state.content])

  // Track whether a sync is pending (to avoid double-syncs)
  const syncPendingRef = useRef(false)

  // ---------------------------------------------------------------------------
  // Online / Offline detection
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const goOffline = () => setIsOffline(true)
    const goOnline = () => setIsOffline(false)

    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)

    // Initialise from current state
    setIsOffline(!navigator.onLine)

    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  // ---------------------------------------------------------------------------
  // localStorage helpers
  // ---------------------------------------------------------------------------
  const storageKey = projectId ? `${LOCAL_STORAGE_PREFIX}${projectId}` : null

  const saveToLocal = useCallback((content: string) => {
    if (!storageKey) return
    try {
      localStorage.setItem(storageKey, content)
    } catch {
      // Storage full or unavailable — silently ignore
    }
  }, [storageKey])

  const clearLocal = useCallback(() => {
    if (!storageKey) return
    try {
      localStorage.removeItem(storageKey)
    } catch {
      // ignore
    }
  }, [storageKey])

  const getLocal = useCallback((): string | null => {
    if (!storageKey) return null
    try {
      return localStorage.getItem(storageKey)
    } catch {
      return null
    }
  }, [storageKey])

  // ---------------------------------------------------------------------------
  // Save function (with localStorage fallback)
  // ---------------------------------------------------------------------------
  const saveContent = useCallback(async () => {
    if (!projectId || !contentRef.current) return

    // If offline, save locally and bail
    if (!navigator.onLine) {
      saveToLocal(contentRef.current)
      setState(prev => ({ ...prev, hasUnsavedChanges: true }))
      return
    }

    try {
      const res = await fetch('/api/editor/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, content: contentRef.current }),
      })

      if (!res.ok) throw new Error('Save failed')

      setState(prev => ({ ...prev, hasUnsavedChanges: false }))
      clearLocal() // Remote save succeeded — discard local draft
      onSave?.(contentRef.current)
    } catch {
      // Network error — fall back to localStorage
      saveToLocal(contentRef.current)
      setIsOffline(true)
    }
  }, [projectId, onSave, saveToLocal, clearLocal])

  // ---------------------------------------------------------------------------
  // Auto-sync when coming back online
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (isOffline || !projectId || syncPendingRef.current) return

    const localDraft = getLocal()
    if (!localDraft) return

    // There's a local draft and we're back online — sync it
    syncPendingRef.current = true
    ;(async () => {
      try {
        const res = await fetch('/api/editor/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, content: localDraft }),
        })
        if (res.ok) {
          clearLocal()
          setState(prev => ({ ...prev, hasUnsavedChanges: false }))
          onSave?.(localDraft)
        }
      } catch {
        // Still offline — will retry on next online event
      } finally {
        syncPendingRef.current = false
      }
    })()
  }, [isOffline, projectId, getLocal, clearLocal, onSave])

  // ---------------------------------------------------------------------------
  // Auto-save effect with debounce
  // ---------------------------------------------------------------------------
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
        // Always save to localStorage on unload (fast, sync-safe)
        saveToLocal(contentRef.current)
        saveContent()
        e.preventDefault()
        e.returnValue = ''
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [state.hasUnsavedChanges, saveContent, saveToLocal])

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
    isOffline,
    setContent,
    markAsEdited,
    saveContent,
    setContentSilent,
  }
}
