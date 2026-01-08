'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import type { ProjectPaper } from '../types'
import { hasGhostText, type GhostTextCitation } from '../extensions/GhostText'

// Suggestion types based on context
export type SuggestionType =
  | 'opening_sentence'   // Start of section paragraph
  | 'complete_sentence'  // Finish incomplete sentence
  | 'next_sentence'      // Continue after complete sentence
  | 'provide_examples'   // After "such as", "for example"
  | 'contrast_point'     // After "however", "although"
  | 'contextual'         // Manual trigger - AI decides

interface UseSmartCompletionOptions {
  editor: Editor | null
  enabled: boolean
  papers: ProjectPaper[]
  projectId: string
  projectTopic: string
}

interface UseSmartCompletionReturn {
  isGenerating: boolean
  triggerCompletion: () => void
}

interface EditorContext {
  precedingText: string
  currentParagraph: string
  currentSection: string
  documentOutline: string[]
  isInParagraph: boolean
  isEmptyParagraph: boolean
  hasHeadingAbove: boolean
}

// Pattern matchers for smart detection
const EXAMPLE_PATTERNS = /(?:such as|for example|for instance|e\.g\.|including)\s*$/i
const CONTRAST_PATTERNS = /(?:however|although|but|yet|nevertheless|on the other hand)\s*$/i
const SENTENCE_END_PATTERN = /[.!?]\s*$/

// Get debounce delay based on suggestion type
function getDebounceDelay(suggestionType: SuggestionType): number {
  switch (suggestionType) {
    case 'opening_sentence':
      return 1000  // Fast for empty paragraphs
    case 'provide_examples':
    case 'contrast_point':
      return 800   // Pattern detected - quick
    case 'complete_sentence':
    case 'next_sentence':
      return 1500  // User might still be thinking
    case 'contextual':
      return 1200
    default:
      return 1500
  }
}

// Extract context from editor - single pass document traversal
function extractEditorContext(editor: Editor): EditorContext | null {
  if (!editor) return null

  const { state } = editor
  const { selection, doc } = state
  const { $from } = selection

  // Check if in paragraph
  const paragraphNode = $from.parent
  const isInParagraph = paragraphNode.type.name === 'paragraph'
  
  if (!isInParagraph) {
    return null
  }

  const currentParagraph = paragraphNode.textContent
  const cursorOffset = $from.parentOffset
  const precedingText = currentParagraph.slice(0, cursorOffset)
  const isEmptyParagraph = currentParagraph.trim().length === 0
  const cursorPos = $from.pos

  // Single pass: find heading above cursor AND build outline
  let currentSection = ''
  let hasHeadingAbove = false
  const documentOutline: string[] = []

  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const headingText = node.textContent
      documentOutline.push(headingText)
      
      if (pos < cursorPos) {
        currentSection = headingText
        hasHeadingAbove = true
      }
    }
    return true
  })

  return {
    precedingText,
    currentParagraph,
    currentSection: currentSection || 'Untitled Section',
    documentOutline,
    isInParagraph,
    isEmptyParagraph,
    hasHeadingAbove
  }
}

// Determine what type of suggestion to generate
function detectSuggestionType(context: EditorContext): SuggestionType | null {
  const { precedingText, isEmptyParagraph, hasHeadingAbove, currentSection } = context

  // Empty paragraph after a real heading -> opening sentence
  if (isEmptyParagraph && hasHeadingAbove && currentSection !== 'Untitled Section') {
    return 'opening_sentence'
  }

  // No text to analyze
  if (!precedingText.trim()) {
    return null
  }

  // Check for example patterns
  if (EXAMPLE_PATTERNS.test(precedingText)) {
    return 'provide_examples'
  }

  // Check for contrast patterns
  if (CONTRAST_PATTERNS.test(precedingText)) {
    return 'contrast_point'
  }

  // End of sentence -> next sentence
  if (SENTENCE_END_PATTERN.test(precedingText)) {
    return 'next_sentence'
  }

  // Has some text but not a complete sentence -> complete it
  const trimmedText = precedingText.trim()
  const wordCount = trimmedText.split(/\s+/).length
  
  if (wordCount >= 3 && !SENTENCE_END_PATTERN.test(precedingText)) {
    return 'complete_sentence'
  }

  // Fallback: if there's any meaningful text (2+ words), use contextual completion
  if (wordCount >= 2) {
    return 'contextual'
  }

  return null
}

export function useSmartCompletion({
  editor,
  enabled,
  papers,
  projectId,
  projectTopic
}: UseSmartCompletionOptions): UseSmartCompletionReturn {
  const [isGenerating, setIsGenerating] = useState(false)
  
  // Use refs for values that shouldn't trigger re-renders or recreate callbacks
  const abortControllerRef = useRef<AbortController | null>(null)
  const lastContextKeyRef = useRef<string>('')
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const selectionTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const mountedRef = useRef(true)
  
  // Track mounted state
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  
  // Stable ref for papers to avoid recreating callbacks
  const papersRef = useRef(papers)
  
  useEffect(() => {
    papersRef.current = papers
  }, [papers])

  // Cancel any pending API request (not the debounce timer)
  const cancelPendingRequest = useCallback(() => {
    const controller = abortControllerRef.current
    if (controller) {
      abortControllerRef.current = null
      // Only abort if not already aborted
      if (!controller.signal.aborted) {
        // Use a reason to identify cleanup aborts
        controller.abort('cleanup')
      }
    }
  }, [])
  
  // Cancel everything (used on unmount)
  const cancelAll = useCallback(() => {
    cancelPendingRequest()
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
      debounceTimeoutRef.current = null
    }
  }, [cancelPendingRequest])

  // Generate completion from API
  const generateCompletion = useCallback(async (
    context: EditorContext,
    suggestionType: SuggestionType
  ) => {
    console.log('[Autocomplete] generateCompletion called', { 
      hasEditor: !!editor, 
      projectId,
      suggestionType 
    })
    
    if (!editor || !projectId) {
      console.log('[Autocomplete] generateCompletion: no editor or projectId')
      return
    }

    // Don't generate if already showing ghost text
    if (hasGhostText(editor)) {
      console.log('[Autocomplete] generateCompletion: ghost text already showing')
      return
    }

    // Create context key to avoid duplicate requests
    const contextKey = `${context.currentSection}:${context.precedingText}:${suggestionType}`
    if (contextKey === lastContextKeyRef.current) {
      console.log('[Autocomplete] generateCompletion: duplicate context key')
      return
    }
    lastContextKeyRef.current = contextKey

    // Cancel any existing request silently
    try {
      if (abortControllerRef.current && !abortControllerRef.current.signal.aborted) {
        abortControllerRef.current.abort()
      }
    } catch {
      // Ignore abort errors
    }
    
    console.log('[Autocomplete] Starting API request...')
    setIsGenerating(true)
    const controller = new AbortController()
    abortControllerRef.current = controller
    const signal = controller.signal

    try {
      // Early exit if already aborted or unmounted (race condition protection)
      if (signal.aborted || !mountedRef.current) {
        if (mountedRef.current) setIsGenerating(false)
        return
      }
      const currentPapers = papersRef.current
      
      // Send only paper IDs - the API will retrieve chunks/claims via RAG
      const response = await fetch('/api/editor/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          context: {
            precedingText: context.precedingText,
            currentParagraph: context.currentParagraph,
            currentSection: context.currentSection,
            documentOutline: context.documentOutline
          },
          paperIds: currentPapers.map(p => p.id),
          topic: projectTopic,
          suggestionType
        }),
        signal
      })

      // Check if aborted
      if (signal.aborted) return

      if (!response.ok) {
        throw new Error('Failed to generate completion')
      }

      const data = await response.json()

      // Final check before updating editor
      if (signal.aborted || !editor || editor.isDestroyed) return

      if (data.suggestion) {
        // Convert API citations to ghost text citations
        // The API now returns paper metadata with each citation
        const ghostCitations: GhostTextCitation[] = (data.citations || []).map((c: {
          paperId: string
          marker: string
          startOffset: number
          endOffset: number
          paper?: {
            id: string
            title: string
            authors: string[]
            year: number
            doi?: string
            venue?: string
          }
        }) => {
          return {
            paperId: c.paperId,
            marker: c.marker,
            startOffset: c.startOffset,
            endOffset: c.endOffset,
            attrs: {
              id: c.paperId,
              authors: c.paper?.authors || [],
              title: c.paper?.title || '',
              year: c.paper?.year || 0,
              journal: c.paper?.venue,
              doi: c.paper?.doi
            }
          }
        })

        // Set ghost text with papers for content processing on accept
        editor.commands.setGhostText(data.suggestion, ghostCitations, currentPapers)
      }
    } catch (error: unknown) {
      // Ignore all abort errors (including cleanup aborts)
      if (signal.aborted) return
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (error instanceof Error && error.name === 'AbortError') return
      
      // Only log non-abort errors
      console.error('Completion error:', error)
    } finally {
      // Only update state if component is still mounted
      if (mountedRef.current) {
        setIsGenerating(false)
      }
    }
  }, [editor, projectId, projectTopic])

  // Use a ref to track generating state to avoid stale closure in setTimeout
  const isGeneratingRef = useRef(isGenerating)
  useEffect(() => {
    isGeneratingRef.current = isGenerating
  }, [isGenerating])

  // Debounced check for auto-trigger - replaces polling
  const scheduleAutoTrigger = useCallback(() => {
    console.log('[Autocomplete] scheduleAutoTrigger called', { 
      hasEditor: !!editor, 
      enabled, 
      isGenerating,
      isFocused: editor?.isFocused 
    })
    
    if (!editor || !enabled || isGenerating) {
      console.log('[Autocomplete] Early return: basic checks failed')
      return
    }
    if (hasGhostText(editor)) {
      console.log('[Autocomplete] Early return: ghost text already showing')
      return
    }
    if (!editor.isFocused) {
      console.log('[Autocomplete] Early return: editor not focused')
      return
    }

    const context = extractEditorContext(editor)
    if (!context) {
      console.log('[Autocomplete] Early return: no context extracted')
      return
    }
    
    console.log('[Autocomplete] Context:', {
      precedingText: context.precedingText.slice(-50),
      isEmptyParagraph: context.isEmptyParagraph,
      hasHeadingAbove: context.hasHeadingAbove,
      currentSection: context.currentSection
    })

    const suggestionType = detectSuggestionType(context)
    console.log('[Autocomplete] Suggestion type:', suggestionType)
    
    if (!suggestionType) {
      console.log('[Autocomplete] Early return: no suggestion type detected')
      return
    }

    // Clear any existing debounce timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
    }

    // Schedule the completion with appropriate delay
    const delay = getDebounceDelay(suggestionType)
    console.log('[Autocomplete] Scheduling with delay:', delay)
    
    debounceTimeoutRef.current = setTimeout(() => {
      console.log('[Autocomplete] Timeout fired, checking conditions...')
      
      // Re-check conditions before firing (use ref for isGenerating to avoid stale closure)
      if (!editor || !enabled || isGeneratingRef.current || editor.isDestroyed) {
        console.log('[Autocomplete] Timeout: basic checks failed', { isGenerating: isGeneratingRef.current })
        return
      }
      if (hasGhostText(editor)) {
        console.log('[Autocomplete] Timeout: ghost text already showing')
        return
      }
      if (!editor.isFocused) {
        console.log('[Autocomplete] Timeout: editor not focused')
        return
      }
      
      // Re-extract context to ensure it's still valid
      const freshContext = extractEditorContext(editor)
      if (!freshContext) {
        console.log('[Autocomplete] Timeout: no fresh context')
        return
      }
      
      const freshType = detectSuggestionType(freshContext)
      console.log('[Autocomplete] Timeout: fresh context', {
        precedingText: freshContext.precedingText.slice(-50),
        freshType
      })
      if (!freshType) {
        console.log('[Autocomplete] Timeout: no fresh suggestion type')
        return
      }
      
      console.log('[Autocomplete] Calling generateCompletion with type:', freshType)
      generateCompletion(freshContext, freshType)
    }, delay)
  }, [editor, enabled, isGenerating, generateCompletion])

  // Manual trigger - always generates
  const triggerCompletion = useCallback(() => {
    if (!editor || !enabled) return

    const context = extractEditorContext(editor)
    if (!context) return

    // For manual trigger, determine type or use contextual
    const suggestionType = detectSuggestionType(context) || 'contextual'
    generateCompletion(context, suggestionType)
  }, [editor, enabled, generateCompletion])

  // Track edits with debounced auto-trigger
  useEffect(() => {
    if (!editor || !enabled) return

    // On content change, schedule auto-trigger check
    const handleUpdate = () => {
      lastContextKeyRef.current = '' // Reset to allow new suggestions
      cancelPendingRequest() // Cancel any in-flight request when user types
      scheduleAutoTrigger() // Schedule new check (this resets the debounce timer internally)
    }

    // Clear ghost text on selection change
    const handleSelectionUpdate = () => {
      if (hasGhostText(editor)) {
        // Clear any existing timeout
        if (selectionTimeoutRef.current) {
          clearTimeout(selectionTimeoutRef.current)
        }
        // Small delay to check if this is just cursor repositioning
        selectionTimeoutRef.current = setTimeout(() => {
          if (editor && !editor.isDestroyed && hasGhostText(editor)) {
            editor.commands.clearGhostText()
          }
        }, 50)
      }
    }

    editor.on('update', handleUpdate)
    editor.on('selectionUpdate', handleSelectionUpdate)

    return () => {
      editor.off('update', handleUpdate)
      editor.off('selectionUpdate', handleSelectionUpdate)
      
      // Clean up all timeouts
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }
      if (selectionTimeoutRef.current) {
        clearTimeout(selectionTimeoutRef.current)
      }
      cancelAll()
    }
  }, [editor, enabled, scheduleAutoTrigger, cancelAll])

  // Handle Ctrl+Space for manual trigger - only when editor is focused
  useEffect(() => {
    if (!editor || !enabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle if editor is focused
      if (!editor.isFocused) return
      
      // Ctrl+Space or Cmd+Space
      if (event.code === 'Space' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        triggerCompletion()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [editor, enabled, triggerCompletion])

  return {
    isGenerating,
    triggerCompletion
  }
}
