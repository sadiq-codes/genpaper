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

// Find the last complete sentence in text
// Returns the sentence text or empty string if no complete sentence found
function findLastCompleteSentence(text: string): string {
  if (!text.trim()) return ''
  
  // Match sentences ending with . ! or ? (followed by space or end of string)
  // This regex finds all complete sentences
  const sentenceEndPattern = /[^.!?]*[.!?](?:\s|$)/g
  const matches = text.match(sentenceEndPattern)
  
  if (!matches || matches.length === 0) {
    return '' // No complete sentence found
  }
  
  // Return the last complete sentence, trimmed
  return matches[matches.length - 1].trim()
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
  const textBeforeCursor = currentParagraph.slice(0, cursorOffset)
  const isEmptyParagraph = currentParagraph.trim().length === 0
  const cursorPos = $from.pos

  // Find the last complete sentence before cursor
  let precedingText = findLastCompleteSentence(textBeforeCursor)
  
  // If no complete sentence in current paragraph, look at previous paragraphs
  if (!precedingText) {
    // Collect all paragraphs before cursor position, then search backwards
    const paragraphsBefore: string[] = []
    
    doc.nodesBetween(0, cursorPos, (node) => {
      // Only collect paragraphs that are before our current paragraph
      if (node.type.name === 'paragraph' && node !== paragraphNode && node.textContent.trim()) {
        paragraphsBefore.push(node.textContent)
      }
      return true
    })
    
    // Search backwards through collected paragraphs
    for (let i = paragraphsBefore.length - 1; i >= 0; i--) {
      const lastSentence = findLastCompleteSentence(paragraphsBefore[i])
      if (lastSentence) {
        precedingText = lastSentence
        break
      }
    }
  }

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
  // Use ReturnType<typeof setTimeout> for cross-env compatibility (Vite, Next edge, etc.)
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  // Track if initial content has been loaded (to avoid cancelling requests during content init)
  // Use a timestamp-based approach: don't cancel requests within first 2 seconds of editor setup
  const editorSetupTimeRef = useRef<number>(0)
  // In-flight request promise cache for deduplication
  // Key: context hash, Value: pending promise
  const inFlightRequestRef = useRef<Map<string, Promise<void>>>(new Map())
  
  // Track mounted state and cleanup on unmount
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      // Cancel any pending requests when component unmounts
      if (abortControllerRef.current) {
        abortControllerRef.current.abort(new DOMException('Component unmounted', 'AbortError'))
        abortControllerRef.current = null
      }
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
        debounceTimeoutRef.current = null
      }
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
      console.log('[Autocomplete] cancelPendingRequest called')
      abortControllerRef.current = null
      // Only abort if not already aborted
      if (!controller.signal.aborted) {
        try {
          // Pass a proper DOMException to avoid "signal is aborted without reason" error
          controller.abort(new DOMException('Request cancelled', 'AbortError'))
        } catch {
          // Ignore abort errors - some environments throw
        }
      }
    }
  }, [])

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

    // Don't start a new request if one is already in flight
    // This prevents rapid successive calls from aborting each other
    if (abortControllerRef.current && !abortControllerRef.current.signal.aborted) {
      console.log('[Autocomplete] generateCompletion: request already in progress, skipping')
      return
    }

    // Create context key to avoid duplicate requests
    // Include cursor position to distinguish same text at different positions
    const cursorPos = editor.state.selection.from
    const contextKey = `${context.currentSection}:${context.precedingText}:${suggestionType}:${cursorPos}`
    
    // Check for duplicate context (same content already requested)
    if (contextKey === lastContextKeyRef.current) {
      console.log('[Autocomplete] generateCompletion: duplicate context key')
      return
    }
    
    // Check for in-flight request with same key (request deduplication)
    const existingRequest = inFlightRequestRef.current.get(contextKey)
    if (existingRequest) {
      console.log('[Autocomplete] generateCompletion: reusing in-flight request')
      return existingRequest
    }
    
    lastContextKeyRef.current = contextKey

    // Create new abort controller for this request
    const controller = new AbortController()
    abortControllerRef.current = controller
    const signal = controller.signal
    
    console.log('[Autocomplete] Starting API request...', { signalAborted: signal.aborted })
    setIsGenerating(true)

    // Create the request promise and store it for deduplication
    const requestPromise = (async () => {
    try {
      // Early exit if already aborted or unmounted (race condition protection)
      if (signal.aborted || !mountedRef.current) {
        console.log('[Autocomplete] Early exit: already aborted or unmounted', { signalAborted: signal.aborted, mounted: mountedRef.current })
        if (mountedRef.current) setIsGenerating(false)
        return
      }
      const currentPapers = papersRef.current
      console.log('[Autocomplete] Making fetch with paperIds:', currentPapers.length)
      
      // Send only paper IDs - the API will retrieve chunks/claims via RAG
      // Simple fetch with proper abort handling
      let response: Response | null = null
      try {
        console.log('[Autocomplete] Initiating fetch...')
        response = await fetch('/api/editor/complete', {
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
        console.log('[Autocomplete] Fetch completed:', response.status, response.ok)
      } catch (fetchError: unknown) {
        // Handle fetch errors (including abort)
        console.log('[Autocomplete] Fetch threw error:', fetchError)
        if (signal.aborted) {
          console.log('[Autocomplete] Signal was aborted, returning')
          return
        }
        // Check if it's an abort error
        if (
          (fetchError instanceof DOMException && fetchError.name === 'AbortError') ||
          (fetchError instanceof Error && fetchError.name === 'AbortError')
        ) {
          console.log('[Autocomplete] AbortError, returning')
          return
        }
        // Re-throw non-abort errors
        throw fetchError
      }

      // Check if aborted or no response (abort resolved to null)
      if (!response || signal.aborted) {
        console.log('[Autocomplete] Request aborted or no response')
        return
      }

      if (!response.ok) {
        // Read the actual error message from the API
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        console.log('[Autocomplete] API error response:', response.status, errorData)
        throw new Error(errorData.message || errorData.error || 'Failed to generate completion')
      }

      // Handle SSE streaming response
      // We use streaming for faster response time, but only show the final formatted result
      // to avoid displaying raw JSON or unformatted citations
      const reader = response.body?.getReader()
      if (!reader) {
        console.log('[Autocomplete] No response body reader')
        return
      }

      const decoder = new TextDecoder()
      let finalData: {
        suggestion?: string
        displaySuggestion?: string
        citations?: Array<{
          paperId: string
          marker: string
          formatted: string
          displayStartOffset: number
          displayEndOffset: number
          rawStartOffset: number
          rawEndOffset: number
          paper?: {
            id: string
            title: string
            authors: string[]
            year: number
            doi?: string
            venue?: string
          }
        }>
      } | null = null

      try {
        let buffer = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (signal.aborted) {
            reader.cancel()
            return
          }

          // Accumulate chunks and parse SSE messages
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          
          // Keep the last incomplete line in buffer
          buffer = lines.pop() || ''
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))
                
                if (data.type === 'text') {
                  // Accumulate text silently - don't update UI during streaming
                  // This avoids showing raw JSON or unformatted citations
                } else if (data.type === 'done') {
                  // Final data with properly formatted citations
                  finalData = data
                  console.log('[Autocomplete] Stream complete:', {
                    hasSuggestion: !!data.suggestion,
                    hasDisplaySuggestion: !!data.displaySuggestion,
                    citationsCount: data.citations?.length || 0,
                    suggestionPreview: data.suggestion?.slice(0, 50)
                  })
                } else if (data.type === 'error') {
                  console.log('[Autocomplete] Stream error:', data.error)
                  throw new Error(data.error)
                }
              } catch (parseErr) {
                // Ignore parse errors for incomplete JSON
              }
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      // Final check before updating editor with complete data
      if (signal.aborted || !editor || editor.isDestroyed) {
        console.log('[Autocomplete] Aborted after stream or editor destroyed')
        return
      }

      // Update with final data including citations
      if (finalData?.suggestion && finalData?.displaySuggestion) {
        // Convert API citations to ghost text format
        const ghostCitations: GhostTextCitation[] = (finalData.citations || []).map((c: {
          paperId: string
          marker: string
          formatted: string
          displayStartOffset: number
          displayEndOffset: number
          rawStartOffset: number
          rawEndOffset: number
          paper?: {
            id: string
            title: string
            authors: string[]
            year: number
            doi?: string
            venue?: string
          }
        }) => ({
          paperId: c.paperId,
          marker: c.marker,
          formatted: c.formatted,
          displayStartOffset: c.displayStartOffset,
          displayEndOffset: c.displayEndOffset,
          paper: c.paper ? {
            id: c.paper.id,
            title: c.paper.title,
            authors: c.paper.authors,
            year: c.paper.year,
            journal: c.paper.venue,
            doi: c.paper.doi
          } : undefined
        }))

        // Set ghost text with both raw (for accept) and display (for rendering)
        editor.commands.setGhostText(
          finalData.suggestion,        // rawText with [CITE: id] markers
          finalData.displaySuggestion, // displayText with formatted citations
          ghostCitations,
          currentPapers
        )
        
        // Reset context key after successful ghost text display
        // This allows new requests if user dismisses ghost text and triggers again
        lastContextKeyRef.current = ''
      } else if (finalData?.suggestion) {
        // Fallback: no displaySuggestion (shouldn't happen with new API)
        editor.commands.setGhostText(finalData.suggestion, finalData.suggestion, [], currentPapers)
        lastContextKeyRef.current = ''
      }
    } catch (error: unknown) {
      // Ignore all abort errors - check multiple conditions
      // Check signal first (most reliable)
      if (signal.aborted) return
      // Check for DOMException AbortError
      if (error instanceof DOMException && error.name === 'AbortError') return
      // Check for Error with AbortError name
      if (error instanceof Error && error.name === 'AbortError') return
      // Handle string errors from abort reasons
      if (typeof error === 'string') return
      // Handle errors with abort/cancel messages
      if (error instanceof Error && (
        error.message?.toLowerCase().includes('abort') ||
        error.message?.toLowerCase().includes('cancel')
      )) return
      
      // Only log non-abort errors
      console.error('Completion error:', error)
    } finally {
      // Clean up in-flight request cache
      inFlightRequestRef.current.delete(contextKey)
      
      // Only update state if component is still mounted
      if (mountedRef.current) {
        setIsGenerating(false)
      }
      // Reset context key only if request wasn't aborted
      // This allows new requests with the same context after successful completion
      // but prevents rapid duplicate requests during typing
      if (!signal.aborted) {
        lastContextKeyRef.current = ''
      }
    }
    })()
    
    // Store the request promise for deduplication
    inFlightRequestRef.current.set(contextKey, requestPromise)
    
    return requestPromise
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

  // Store callbacks in refs to avoid effect re-runs when they change
  const scheduleAutoTriggerRef = useRef(scheduleAutoTrigger)
  const cancelPendingRequestRef = useRef(cancelPendingRequest)
  
  useEffect(() => {
    scheduleAutoTriggerRef.current = scheduleAutoTrigger
    cancelPendingRequestRef.current = cancelPendingRequest
  }, [scheduleAutoTrigger, cancelPendingRequest])

  // Track edits with debounced auto-trigger
  useEffect(() => {
    if (!editor || !enabled) return

    // Mark the time when this editor instance is set up
    // Used to detect initial content load period
    editorSetupTimeRef.current = Date.now()

    // On content change, schedule auto-trigger check
    const handleUpdate = () => {
      const now = Date.now()
      const timeSinceSetup = now - editorSetupTimeRef.current
      
      // During the initial 2 seconds after editor setup, don't cancel requests
      // This prevents aborting requests during initial content load which happens in multiple updates
      const isInitialLoadPeriod = timeSinceSetup < 2000
      
      if (isInitialLoadPeriod) {
        console.log('[Autocomplete] In initial load period, not cancelling request', { timeSinceSetup })
        // Just reschedule, don't cancel
        scheduleAutoTriggerRef.current()
        return
      }
      
      // After initial period, any doc change should cancel pending requests (user is typing)
      console.log('[Autocomplete] User edit detected, cancelling pending request')
      cancelPendingRequestRef.current()
      scheduleAutoTriggerRef.current()
    }

    // Clear ghost text on selection change
    const handleSelectionUpdate = () => {
      // Don't clear during range selections (user is selecting text)
      if (!editor.state.selection.empty) return
      
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
      
      // Clean up all timeouts only - don't abort requests on effect cleanup
      // Requests should only be aborted when user types (handleUpdate) or component unmounts
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
        debounceTimeoutRef.current = null
      }
      if (selectionTimeoutRef.current) {
        clearTimeout(selectionTimeoutRef.current)
        selectionTimeoutRef.current = null
      }
    }
  }, [editor, enabled]) // Only re-run when editor or enabled changes

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
