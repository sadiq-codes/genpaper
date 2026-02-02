'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import type { ProjectPaper } from '../types'
import { hasGhostText, type GhostTextCitation } from '../extensions/GhostText'
import { toast } from 'sonner'
import type { AutocompletePrefs } from './useAutocompletePrefs'

// Note: SuggestionType removed - the unified prompt now handles all cases
// The LLM analyzes writing intent semantically rather than using pre-classified types

interface UseSmartCompletionOptions {
  editor: Editor | null
  enabled: boolean
  papers: ProjectPaper[]
  projectId: string
  projectTopic: string
  /** Autocomplete preferences from useAutocompletePrefs */
  prefs?: AutocompletePrefs
}

interface UseSmartCompletionReturn {
  isGenerating: boolean
  triggerCompletion: () => void
  showNextQueuedSentence: () => boolean  // Returns true if there was a queued sentence to show
  hasQueuedSentences: boolean
  /** Current loading message for display */
  loadingMessage: string | null
  /** Number of queued sentences */
  queueCount: number
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

// Auto-trigger debounce delay (only used when autoSuggestions enabled)
const AUTO_TRIGGER_DEBOUNCE_MS = 1200

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

// Check if context has enough content to generate a completion
// No longer determines suggestion type - the LLM does that semantically
function shouldTriggerCompletion(context: EditorContext): boolean {
  const { precedingText, isEmptyParagraph, hasHeadingAbove, currentSection } = context

  // Empty paragraph after a real heading -> good for opening sentence
  if (isEmptyParagraph && hasHeadingAbove && currentSection !== 'Untitled Section') {
    return true
  }

  // Need at least some text to work with
  if (!precedingText.trim()) {
    return false
  }

  // Has meaningful text (2+ words) -> good for completion
  const wordCount = precedingText.trim().split(/\s+/).length
  return wordCount >= 2
}

// Processed sentence from API response
interface QueuedSentence {
  text: string           // Raw text with [@paperId#instanceId] markers
  displayText: string    // Formatted with (Author, Year)
  citations: GhostTextCitation[]
}

/**
 * Smart spacing helper: prepends a space to suggestion if needed
 * 
 * Rules:
 * - After sentence-ending punctuation (.!?) → add space (unless at paragraph start)
 * - After other punctuation (,:;) → add space (unless at paragraph start)
 * - If cursor already has space before it → no extra space
 * - If suggestion already starts with space → no extra space
 * - At paragraph start → no space needed
 */
function prependSpaceIfNeeded(
  editor: Editor,
  sentence: QueuedSentence
): QueuedSentence {
  const cursorPos = editor.state.selection.from
  const { doc } = editor.state
  
  // Get character before cursor
  const charBefore = cursorPos > 0 ? doc.textBetween(cursorPos - 1, cursorPos) : ''
  
  // Check if at paragraph start
  const $pos = doc.resolve(cursorPos)
  const isAtParagraphStart = $pos.parentOffset === 0
  
  // Check if space is already present
  const alreadyHasSpace = charBefore === ' '
  const textStartsWithSpace = sentence.text.startsWith(' ')
  
  // Need space if: after punctuation, not at paragraph start, no existing space
  const isAfterPunctuation = /[.!?:;,]/.test(charBefore)
  const needsSpace = isAfterPunctuation && !isAtParagraphStart && !alreadyHasSpace && !textStartsWithSpace
  
  if (!needsSpace) {
    return sentence
  }
  
  // Prepend space and adjust citation offsets
  return {
    text: ' ' + sentence.text,
    displayText: ' ' + sentence.displayText,
    citations: sentence.citations.map(c => ({
      ...c,
      displayStartOffset: c.displayStartOffset + 1,
      displayEndOffset: c.displayEndOffset + 1
    }))
  }
}

export function useSmartCompletion({
  editor,
  enabled,
  papers,
  projectId,
  projectTopic,
  prefs
}: UseSmartCompletionOptions): UseSmartCompletionReturn {
  const [isGenerating, setIsGenerating] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null)
  
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
  
  // SENTENCE QUEUE: Store remaining sentences for instant display on accept
  const sentenceQueueRef = useRef<QueuedSentence[]>([])
  // Track the context when sentences were fetched (to invalidate queue on context change)
  const queueContextRef = useRef<string>('')
  
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

  // Show error toast with retry action
  const showErrorToast = useCallback((message: string, onRetry?: () => void) => {
    if (onRetry) {
      toast.error(message, {
        action: {
          label: 'Try Again',
          onClick: onRetry,
        },
        duration: 5000,
      })
    } else {
      toast.error(message, { duration: 4000 })
    }
  }, [])

  // Generate completion from API
  // Note: suggestionType removed - the LLM now analyzes writing intent semantically
  const generateCompletion = useCallback(async (
    context: EditorContext
  ) => {
    console.log('[Autocomplete] generateCompletion called', { 
      hasEditor: !!editor, 
      projectId
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
    const contextKey = `${context.currentSection}:${context.precedingText}:${cursorPos}`
    
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
    setLoadingMessage('AI is thinking...')

    // Create the request promise and store it for deduplication
    const requestPromise = (async () => {
    try {
      // Early exit if already aborted or unmounted (race condition protection)
      if (signal.aborted || !mountedRef.current) {
        console.log('[Autocomplete] Early exit: already aborted or unmounted', { signalAborted: signal.aborted, mounted: mountedRef.current })
        if (mountedRef.current) {
          setIsGenerating(false)
          setLoadingMessage(null)
        }
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
            paperIds: prefs?.includeCitations ? currentPapers.map(p => p.id) : [],
            topic: projectTopic
            // suggestionType removed - LLM analyzes intent semantically
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
        // Network error - show toast
        if (fetchError instanceof Error) {
          showErrorToast('Connection lost', () => {
            generateCompletion(context)
          })
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
        
        // Show appropriate error toast
        if (response.status === 404) {
          showErrorToast('No suggestions for this context')
        } else if (response.status >= 500) {
          showErrorToast('Server error. Please try again.', () => {
            generateCompletion(context)
          })
        } else {
          showErrorToast(errorData.message || errorData.error || 'Failed to generate completion')
        }
        
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
      // Updated to handle sentence-based response
      let finalData: {
        sentences?: Array<{
          text: string
          displayText: string
          citations: Array<{
            paperId: string
            marker: string
            formatted: string
            citedContent?: string
            displayStartOffset: number
            displayEndOffset: number
            paper?: {
              id: string
              title: string
              authors: string[]
              year: number
              doi?: string
              venue?: string
            }
          }>
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
                  // Final data with sentences array
                  finalData = data
                  console.log('[Autocomplete] Stream complete:', {
                    sentencesCount: data.sentences?.length || 0,
                    firstSentencePreview: data.sentences?.[0]?.displayText?.slice(0, 50)
                  })
                } else if (data.type === 'error') {
                  console.log('[Autocomplete] Stream error:', data.error)
                  showErrorToast(data.error || 'Failed to generate suggestions')
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

      // Process sentences array from API
      if (finalData?.sentences && finalData.sentences.length > 0) {
        // Convert API sentences to QueuedSentence format
        const queuedSentences: QueuedSentence[] = finalData.sentences.map(s => ({
          text: s.text,
          displayText: s.displayText,
          citations: s.citations.map(c => ({
            paperId: c.paperId,
            marker: c.marker,
            formatted: c.formatted,
            citedContent: c.citedContent,
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
        }))
        
        // Show FIRST sentence as ghost text (with smart spacing)
        const firstSentence = prependSpaceIfNeeded(editor, queuedSentences[0])
        editor.commands.setGhostText(
          firstSentence.text,        // rawText with [@paperId#instanceId] markers
          firstSentence.displayText, // displayText with formatted citations
          firstSentence.citations,
          currentPapers,
          queuedSentences.length - 1  // queueCount (remaining after showing first)
        )
        
        // Queue remaining sentences for instant display on accept
        sentenceQueueRef.current = queuedSentences.slice(1)
        queueContextRef.current = contextKey
        
        console.log('[Autocomplete] Showing first sentence, queued:', sentenceQueueRef.current.length)
        
        // Reset context key after successful ghost text display
        lastContextKeyRef.current = ''
      } else {
        // No suggestions returned
        showErrorToast('No suggestions for this context')
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
        setLoadingMessage(null)
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
  }, [editor, projectId, projectTopic, prefs?.includeCitations, showErrorToast])

  // Use a ref to track generating state to avoid stale closure in setTimeout
  const isGeneratingRef = useRef(isGenerating)
  useEffect(() => {
    isGeneratingRef.current = isGenerating
  }, [isGenerating])

  // Schedule completion request (auto-trigger based on prefs)
  // This is called by: manual trigger (Ctrl+Space) and background queue refill
  const scheduleAutoTrigger = useCallback(() => {
    console.log('[Autocomplete] scheduleAutoTrigger called', { 
      hasEditor: !!editor, 
      enabled, 
      autoSuggestions: prefs?.autoSuggestions,
      isGenerating,
      isFocused: editor?.isFocused 
    })
    
    if (!editor || !enabled || isGenerating) {
      console.log('[Autocomplete] Early return: basic checks failed')
      return
    }
    
    // Only auto-trigger if autoSuggestions is enabled
    if (!prefs?.autoSuggestions) {
      console.log('[Autocomplete] Early return: autoSuggestions disabled')
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

    // Check if we should trigger completion (has enough context)
    if (!shouldTriggerCompletion(context)) {
      console.log('[Autocomplete] Early return: not enough context for completion')
      return
    }

    // Clear any existing debounce timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
    }

    // Schedule the completion with fixed delay (no longer varies by suggestion type)
    console.log('[Autocomplete] Scheduling with delay:', AUTO_TRIGGER_DEBOUNCE_MS)
    
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
      
      // Check again that we have enough context
      if (!shouldTriggerCompletion(freshContext)) {
        console.log('[Autocomplete] Timeout: not enough context')
        return
      }
      
      console.log('[Autocomplete] Calling generateCompletion')
      generateCompletion(freshContext)
    }, AUTO_TRIGGER_DEBOUNCE_MS)
  }, [editor, enabled, isGenerating, prefs?.autoSuggestions, generateCompletion])

  // Manual trigger - always generates
  const triggerCompletion = useCallback(() => {
    if (!editor || !enabled) return

    const context = extractEditorContext(editor)
    if (!context) return

    // Clear the sentence queue when manually triggering (fresh context)
    sentenceQueueRef.current = []
    queueContextRef.current = ''

    // For manual trigger, always generate (LLM determines what's appropriate)
    generateCompletion(context)
  }, [editor, enabled, generateCompletion])

  // Show next queued sentence as ghost text (called after user accepts current sentence)
  const showNextQueuedSentence = useCallback((): boolean => {
    if (!editor || editor.isDestroyed) return false
    
    const queue = sentenceQueueRef.current
    if (queue.length === 0) {
      console.log('[Autocomplete] No queued sentences')
      return false
    }
    
    // Pop the next sentence from queue
    const rawNextSentence = queue.shift()!
    sentenceQueueRef.current = queue
    
    console.log('[Autocomplete] Showing queued sentence, remaining:', queue.length)
    
    // Apply smart spacing (cursor position may have changed since fetch)
    const nextSentence = prependSpaceIfNeeded(editor, rawNextSentence)
    
    // Show it as ghost text immediately (no API call!)
    editor.commands.setGhostText(
      nextSentence.text,
      nextSentence.displayText,
      nextSentence.citations,
      papersRef.current,
      sentenceQueueRef.current.length  // queueCount (remaining after popping)
    )
    
    // If queue is getting low (1 or 0 left), trigger background refetch
    if (queue.length <= 1 && enabled && prefs?.autoSuggestions) {
      console.log('[Autocomplete] Queue low, scheduling background refetch')
      // Delay slightly to let the current sentence be processed
      setTimeout(() => {
        if (!editor || editor.isDestroyed || !mountedRef.current) return
        
        const context = extractEditorContext(editor)
        if (!context) return
        
        // This will fetch new sentences in the background
        generateCompletion(context)
      }, 500)
    }
    
    return true
  }, [editor, enabled, prefs?.autoSuggestions, generateCompletion])

  // Store callbacks in refs to avoid effect re-runs when they change
  const scheduleAutoTriggerRef = useRef(scheduleAutoTrigger)
  const cancelPendingRequestRef = useRef(cancelPendingRequest)
  const showNextQueuedSentenceRef = useRef(showNextQueuedSentence)
  
  useEffect(() => {
    scheduleAutoTriggerRef.current = scheduleAutoTrigger
    cancelPendingRequestRef.current = cancelPendingRequest
    showNextQueuedSentenceRef.current = showNextQueuedSentence
  }, [scheduleAutoTrigger, cancelPendingRequest, showNextQueuedSentence])

  // Listen for ghost text acceptance to show next queued sentence
  useEffect(() => {
    if (!editor || !enabled) return

    const handleGhostTextAccepted = () => {
      console.log('[Autocomplete] Ghost text accepted, checking for queued sentences')
      // Small delay to let the accepted text be inserted first
      setTimeout(() => {
        if (!editor || editor.isDestroyed || !mountedRef.current) return
        showNextQueuedSentenceRef.current()
      }, 50)
    }

    const editorDom = editor.view.dom
    editorDom.addEventListener('ghosttext:accepted', handleGhostTextAccepted)

    return () => {
      editorDom.removeEventListener('ghosttext:accepted', handleGhostTextAccepted)
    }
  }, [editor, enabled])

  // Track edits with debounced auto-trigger
  useEffect(() => {
    if (!editor || !enabled) return

    // Mark the time when this editor instance is set up
    // Used to detect initial content load period
    editorSetupTimeRef.current = Date.now()

    // On content change, cancel pending requests and optionally auto-trigger
    const handleUpdate = () => {
      const now = Date.now()
      const timeSinceSetup = now - editorSetupTimeRef.current
      
      // During the initial 2 seconds after editor setup, don't cancel requests
      // This prevents aborting requests during initial content load which happens in multiple updates
      const isInitialLoadPeriod = timeSinceSetup < 2000
      
      if (isInitialLoadPeriod) {
        console.log('[Autocomplete] In initial load period, not cancelling request', { timeSinceSetup })
        return
      }
      
      // After initial period, any doc change should cancel pending requests (user is typing)
      console.log('[Autocomplete] User edit detected, cancelling pending request')
      cancelPendingRequestRef.current()
      
      // Auto-trigger if enabled in preferences
      if (prefs?.autoSuggestions) {
        scheduleAutoTriggerRef.current()
      }
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
  }, [editor, enabled, prefs?.autoSuggestions])

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

  // Pause autocomplete when page is hidden (saves API costs on mobile/tab switch)
  useEffect(() => {
    if (!enabled) return

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Page is hidden - cancel pending autocomplete requests and clear debounce
        // Generation continues server-side, but we don't need to fetch new completions
        console.log('[Autocomplete] Page hidden, pausing autocomplete')
        cancelPendingRequestRef.current()
        if (debounceTimeoutRef.current) {
          clearTimeout(debounceTimeoutRef.current)
          debounceTimeoutRef.current = null
        }
        // Clear sentence queue - context will likely be stale when user returns
        sentenceQueueRef.current = []
        queueContextRef.current = ''
      } else {
        console.log('[Autocomplete] Page visible again')
        // Don't auto-trigger on return - let user action trigger it
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [enabled])

  // Check if there are queued sentences available
  const hasQueuedSentences = sentenceQueueRef.current.length > 0
  const queueCount = sentenceQueueRef.current.length

  return {
    isGenerating,
    triggerCompletion,
    showNextQueuedSentence,
    hasQueuedSentences,
    loadingMessage,
    queueCount,
  }
}
