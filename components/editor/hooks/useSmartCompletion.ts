'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import type { ProjectPaper, ExtractedClaim } from '../types'
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
  claims: ExtractedClaim[]
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

// Extract context from editor
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

  // Find nearest heading above cursor
  let currentSection = ''
  let hasHeadingAbove = false
  const cursorPos = $from.pos

  doc.descendants((node, pos) => {
    if (node.type.name === 'heading' && pos < cursorPos) {
      currentSection = node.textContent
      hasHeadingAbove = true
    }
    return true
  })

  // Build document outline
  const documentOutline: string[] = []
  doc.descendants((node) => {
    if (node.type.name === 'heading') {
      documentOutline.push(node.textContent)
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
  const wordCount = precedingText.trim().split(/\s+/).length
  if (wordCount >= 3 && !SENTENCE_END_PATTERN.test(precedingText)) {
    return 'complete_sentence'
  }

  return null
}

// Determine if we should auto-trigger
function shouldAutoTrigger(
  context: EditorContext,
  suggestionType: SuggestionType | null,
  timeSinceLastEdit: number
): boolean {
  if (!suggestionType) return false

  // Different pause times for different contexts
  switch (suggestionType) {
    case 'opening_sentence':
      // Trigger faster for empty paragraphs - user is waiting
      return timeSinceLastEdit >= 1000
    case 'provide_examples':
    case 'contrast_point':
      // Pattern detected - trigger quickly
      return timeSinceLastEdit >= 800
    case 'complete_sentence':
    case 'next_sentence':
      // User might still be thinking - wait longer
      return timeSinceLastEdit >= 1500
    default:
      return false
  }
}

export function useSmartCompletion({
  editor,
  enabled,
  papers,
  claims,
  projectId,
  projectTopic
}: UseSmartCompletionOptions): UseSmartCompletionReturn {
  const [isGenerating, setIsGenerating] = useState(false)
  
  const lastEditTimeRef = useRef<number>(Date.now())
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const lastContextKeyRef = useRef<string>('')

  // Cancel any pending request
  const cancelPending = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }, [])

  // Generate completion from API
  const generateCompletion = useCallback(async (
    context: EditorContext,
    suggestionType: SuggestionType
  ) => {
    if (!editor || !projectId) return

    // Don't generate if already showing ghost text
    if (hasGhostText(editor)) return

    // Create context key to avoid duplicate requests
    const contextKey = `${context.currentSection}:${context.precedingText}:${suggestionType}`
    if (contextKey === lastContextKeyRef.current) return
    lastContextKeyRef.current = contextKey

    cancelPending()
    setIsGenerating(true)

    abortControllerRef.current = new AbortController()

    try {
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
          papers: papers.map(p => ({
            id: p.id,
            title: p.title,
            abstract: p.abstract,
            authors: p.authors,
            year: p.year
          })),
          claims: claims.slice(0, 20).map(c => ({
            id: c.id,
            claim_text: c.claim_text,
            claim_type: c.claim_type,
            paper_id: c.paper_id,
            paper_title: c.paper_title,
            paper_authors: c.paper_authors,
            paper_year: c.paper_year
          })),
          topic: projectTopic,
          suggestionType
        }),
        signal: abortControllerRef.current.signal
      })

      if (!response.ok) {
        throw new Error('Failed to generate completion')
      }

      const data = await response.json()

      if (data.suggestion && editor) {
        // Convert API citations to ghost text citations
        const ghostCitations: GhostTextCitation[] = (data.citations || []).map((c: any) => {
          const paper = papers.find(p => p.id === c.paperId)
          return {
            paperId: c.paperId,
            marker: c.marker,
            startOffset: c.startOffset,
            endOffset: c.endOffset,
            attrs: {
              id: c.paperId,
              authors: paper?.authors || [],
              title: paper?.title || '',
              year: paper?.year || 0,
              journal: paper?.journal,
              doi: paper?.doi
            }
          }
        })

        // Set ghost text
        editor.commands.setGhostText(data.suggestion, ghostCitations)
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Request cancelled, ignore
        return
      }
      console.error('Completion error:', error)
    } finally {
      setIsGenerating(false)
    }
  }, [editor, projectId, papers, claims, projectTopic, cancelPending])

  // Manual trigger - always generates
  const triggerCompletion = useCallback(() => {
    if (!editor || !enabled) return

    const context = extractEditorContext(editor)
    if (!context) return

    // For manual trigger, determine type or use contextual
    const suggestionType = detectSuggestionType(context) || 'contextual'
    generateCompletion(context, suggestionType)
  }, [editor, enabled, generateCompletion])

  // Check if we should auto-trigger
  const checkForAutoTrigger = useCallback(() => {
    if (!editor || !enabled || isGenerating) return
    if (hasGhostText(editor)) return

    const context = extractEditorContext(editor)
    if (!context) return

    const suggestionType = detectSuggestionType(context)
    if (!suggestionType) return

    const timeSinceLastEdit = Date.now() - lastEditTimeRef.current

    if (shouldAutoTrigger(context, suggestionType, timeSinceLastEdit)) {
      generateCompletion(context, suggestionType)
    }
  }, [editor, enabled, isGenerating, generateCompletion])

  // Track edits and set up polling
  useEffect(() => {
    if (!editor || !enabled) return

    // Update last edit time on any change
    const handleUpdate = () => {
      lastEditTimeRef.current = Date.now()
      lastContextKeyRef.current = '' // Reset to allow new suggestions
    }

    // Clear ghost text on selection change
    const handleSelectionUpdate = () => {
      if (hasGhostText(editor)) {
        // Small delay to check if this is just cursor repositioning
        setTimeout(() => {
          if (hasGhostText(editor)) {
            editor.commands.clearGhostText()
          }
        }, 50)
      }
    }

    editor.on('update', handleUpdate)
    editor.on('selectionUpdate', handleSelectionUpdate)

    // Poll for auto-trigger conditions
    checkIntervalRef.current = setInterval(checkForAutoTrigger, 300)

    return () => {
      editor.off('update', handleUpdate)
      editor.off('selectionUpdate', handleSelectionUpdate)
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current)
      }
      cancelPending()
    }
  }, [editor, enabled, checkForAutoTrigger, cancelPending])

  // Handle Ctrl+Space for manual trigger
  useEffect(() => {
    if (!editor || !enabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
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
