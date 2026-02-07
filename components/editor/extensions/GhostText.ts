import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { ProjectPaper } from '../types'
import { processContent } from '../utils/content-processor'

// Types for ghost text state
export interface GhostTextState {
  // Raw text with [@id] markers (Pandoc format) - used for accept/processing
  rawText: string | null
  // Display text with formatted citations - used for rendering
  displayText: string | null
  // Citation metadata for display styling
  citations: GhostTextCitation[]
  // Papers for content processing
  papers: ProjectPaper[]
  // Cursor position where ghost text appears
  position: number | null
  // Number of queued sentences remaining
  queueCount: number
  // Loading state
  isLoading: boolean
  // Loading message to display
  loadingMessage: string | null
}

export interface GhostTextCitation {
  paperId: string
  marker: string       // Original [@id] marker (Pandoc format)
  formatted: string    // Formatted display text (Smith et al., 2024)
  citedContent?: string // The exact quote from the paper (for saving to DB)
  // Positions in display text (for rendering)
  displayStartOffset: number
  displayEndOffset: number
  // Paper metadata (for content processing)
  paper?: {
    id: string
    title: string
    authors: string[]
    year: number
    journal?: string
    doi?: string
  }
}

// Plugin key for accessing ghost text state
export const ghostTextPluginKey = new PluginKey<GhostTextState>('ghostText')

// Callback type for when citations are accepted
export type OnCitationsAccepted = (citations: GhostTextCitation[]) => void

// Declare custom commands
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    ghostText: {
      /**
       * Set ghost text suggestion at current cursor position
       * @param rawText - Text with [@id] markers (Pandoc format, for processing on accept)
       * @param displayText - Text with formatted citations (for display)
       * @param citations - Citation metadata array
       * @param papers - Project papers for content processing
       * @param queueCount - Number of queued sentences remaining
       */
      setGhostText: (
        rawText: string,
        displayText: string,
        citations?: GhostTextCitation[],
        papers?: ProjectPaper[],
        queueCount?: number
      ) => ReturnType
      /**
       * Accept and insert the ghost text
       */
      acceptGhostText: () => ReturnType
      /**
       * Clear/dismiss the ghost text
       */
      clearGhostText: () => ReturnType
      /**
       * Accept the next word of ghost text (partial acceptance)
       */
      acceptNextWord: () => ReturnType
      /**
       * Set loading state with message
       */
      setGhostTextLoading: (isLoading: boolean, message?: string | null) => ReturnType
    }
  }
}

// Safely render ghost text content using DOM API (XSS-safe)
// Uses displayText with formatted citations highlighted
function renderGhostTextContent(
  container: HTMLElement,
  displayText: string,
  citations: GhostTextCitation[],
  queueCount: number,
  isLoading: boolean,
  loadingMessage: string | null
): void {
  container.textContent = ''

  // If loading, show loading message with pulse animation
  if (isLoading && loadingMessage) {
    const loadingSpan = document.createElement('span')
    loadingSpan.className = 'ghost-text-loading'
    loadingSpan.textContent = loadingMessage
    container.appendChild(loadingSpan)
    return
  }

  if (citations.length === 0) {
    container.textContent = displayText
  } else {
    // Sort citations by display position
    const sortedCitations = [...citations].sort(
      (a, b) => a.displayStartOffset - b.displayStartOffset
    )
    let lastEnd = 0

    for (const citation of sortedCitations) {
      // Add text before citation
      if (citation.displayStartOffset > lastEnd) {
        container.appendChild(
          document.createTextNode(displayText.slice(lastEnd, citation.displayStartOffset))
        )
      }

      // Add formatted citation with special styling
      const citationSpan = document.createElement('span')
      citationSpan.className = 'ghost-text-citation'
      citationSpan.textContent = citation.formatted
      container.appendChild(citationSpan)

      lastEnd = citation.displayEndOffset
    }

    // Add remaining text after last citation
    if (lastEnd < displayText.length) {
      container.appendChild(document.createTextNode(displayText.slice(lastEnd)))
    }
  }

  // Append queue indicator if there are more queued sentences
  if (queueCount > 0) {
    const queueSpan = document.createElement('span')
    queueSpan.className = 'ghost-text-queue'
    queueSpan.textContent = ` [${queueCount} more]`
    container.appendChild(queueSpan)
  }
}

export const GhostText = Extension.create({
  name: 'ghostText',

  addProseMirrorPlugins() {
    const editor = this.editor

    return [
      new Plugin({
        key: ghostTextPluginKey,

        state: {
          init(): GhostTextState {
            return {
              rawText: null,
              displayText: null,
              citations: [],
              papers: [],
              position: null,
              queueCount: 0,
              isLoading: false,
              loadingMessage: null
            }
          },

          apply(tr, value): GhostTextState {
            // Check for ghost text meta
            const setGhostText = tr.getMeta('setGhostText')
            if (setGhostText) {
              return {
                rawText: setGhostText.rawText,
                displayText: setGhostText.displayText,
                citations: setGhostText.citations || [],
                papers: setGhostText.papers || [],
                position: tr.selection.from,
                queueCount: setGhostText.queueCount || 0,
                isLoading: false,
                loadingMessage: null
              }
            }

            // Check for loading state meta
            const setLoading = tr.getMeta('setGhostTextLoading')
            if (setLoading) {
              return {
                ...value,
                isLoading: setLoading.isLoading,
                loadingMessage: setLoading.message || null
              }
            }

            const clearGhostText = tr.getMeta('clearGhostText')
            if (clearGhostText) {
              return {
                rawText: null,
                displayText: null,
                citations: [],
                papers: [],
                position: null,
                queueCount: 0,
                isLoading: false,
                loadingMessage: null
              }
            }

            // Smart persistence: only clear ghost text if user typed conflicting text
            if (tr.docChanged && value.rawText && value.position !== null) {
              const doc = tr.doc
              const insertionPos = value.position
              const ghostText = value.rawText
              
              // Get the text from the document at the ghost text position
              // Check up to the length of ghost text to see what user has typed
              const maxCheckLength = Math.min(ghostText.length, 100) // Limit check to reasonable length
              let textAtPosition = ''
              
              // Extract text from document at the insertion position
              if (insertionPos <= doc.content.size) {
                const textContent = doc.textBetween(insertionPos, Math.min(insertionPos + maxCheckLength, doc.content.size), ' ')
                textAtPosition = textContent
              }
              
              // If there's text at the position, check if it's compatible with ghost text
              if (textAtPosition.length > 0) {
                // Get the expected start of ghost text (same length as what user typed)
                const expectedStart = ghostText.slice(0, textAtPosition.length)
                
                // Normalize for comparison (case-insensitive, ignore extra whitespace)
                const normalizedTyped = textAtPosition.toLowerCase().replace(/\s+/g, ' ').trim()
                const normalizedExpected = expectedStart.toLowerCase().replace(/\s+/g, ' ').trim()
                
                // Check for conflict: typed text doesn't match expected ghost text start
                const hasConflict = normalizedTyped.length > 0 && 
                                   !normalizedExpected.startsWith(normalizedTyped) && 
                                   !normalizedTyped.startsWith(normalizedExpected)
                
                if (hasConflict) {
                  // Clear ghost text on conflict
                  return {
                    rawText: null,
                    displayText: null,
                    citations: [],
                    papers: [],
                    position: null,
                    queueCount: 0,
                    isLoading: false,
                    loadingMessage: null
                  }
                }
                // No conflict: keep ghost text visible (user is typing matching text)
              }
            }

            // Clear if selection moved away from ghost text position
            if (value.position !== null && tr.selection.from !== value.position) {
              return {
                rawText: null,
                displayText: null,
                citations: [],
                papers: [],
                position: null,
                queueCount: 0,
                isLoading: false,
                loadingMessage: null
              }
            }

            return value
          }
        },

        props: {
          // Render ghost text as decoration using displayText
          decorations(state) {
            const pluginState = ghostTextPluginKey.getState(state)
            if (!pluginState?.displayText && !pluginState?.isLoading) {
              return DecorationSet.empty
            }

            // Create a widget decoration that renders after the cursor
            const widget = Decoration.widget(
              pluginState.position || state.selection.from,
              () => {
                const span = document.createElement('span')
                span.className = 'ghost-text'
                span.setAttribute('data-ghost-text', 'true')
                
                // Render using displayText (formatted citations) or loading message
                renderGhostTextContent(
                  span,
                  pluginState.displayText || '',
                  pluginState.citations,
                  pluginState.queueCount,
                  pluginState.isLoading,
                  pluginState.loadingMessage
                )
                
                // Tap/click on ghost text to accept (essential for mobile)
                span.addEventListener('pointerdown', (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  requestAnimationFrame(() => {
                    if (!editor.isDestroyed) {
                      editor.commands.acceptGhostText()
                    }
                  })
                })
                span.style.cursor = 'pointer'

                return span
              },
              { side: 1 } // Render after cursor
            )

            return DecorationSet.create(state.doc, [widget])
          },

          // Handle keyboard events
          handleKeyDown(view, event) {
            const pluginState = ghostTextPluginKey.getState(view.state)
            
            // Don't handle keys if loading
            if (pluginState?.isLoading) {
              return false
            }
            
            if (!pluginState?.rawText) {
              return false
            }

            // Get accept key preference from localStorage
            let acceptKey: 'tab' | 'ctrlEnter' = 'tab'
            try {
              const stored = localStorage.getItem('genpaper-autocomplete-prefs')
              if (stored) {
                const prefs = JSON.parse(stored)
                if (prefs.acceptKey === 'ctrlEnter') {
                  acceptKey = 'ctrlEnter'
                }
              }
            } catch (e) {
              console.warn('[GhostText] Failed to read autocomplete prefs from localStorage:', e)
            }

            // Accept ghost text - Tab or Ctrl+Enter based on preference
            const isTabAccept = acceptKey === 'tab' && event.key === 'Tab' && !event.shiftKey
            const isCtrlEnterAccept = acceptKey === 'ctrlEnter' && event.key === 'Enter' && (event.ctrlKey || event.metaKey)
            
            if (isTabAccept || isCtrlEnterAccept) {
              event.preventDefault()
              // Use requestAnimationFrame to ensure state is synchronized
              requestAnimationFrame(() => {
                if (!editor.isDestroyed) {
                  editor.commands.acceptGhostText()
                }
              })
              return true
            }

            // Escape - clear ghost text
            if (event.key === 'Escape') {
              event.preventDefault()
              requestAnimationFrame(() => {
                if (!editor.isDestroyed) {
                  editor.commands.clearGhostText()
                }
              })
              return true
            }

            // Ctrl+Right Arrow - accept next word of ghost text
            if (event.key === 'ArrowRight' && event.ctrlKey) {
              event.preventDefault()
              requestAnimationFrame(() => {
                if (!editor.isDestroyed) {
                  editor.commands.acceptNextWord()
                }
              })
              return true
            }

            // Arrow keys - clear ghost text and let default behavior happen
            if (event.key.startsWith('Arrow')) {
              requestAnimationFrame(() => {
                if (!editor.isDestroyed) {
                  editor.commands.clearGhostText()
                }
              })
              return false
            }

            return false
          }
        }
      })
    ]
  },

  addCommands() {
    return {
      setGhostText:
        (
          rawText: string,
          displayText: string,
          citations: GhostTextCitation[] = [],
          papers: ProjectPaper[] = [],
          queueCount: number = 0
        ) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta('setGhostText', { rawText, displayText, citations, papers, queueCount })
            dispatch(tr)
          }
          return true
        },

      setGhostTextLoading:
        (isLoading: boolean, message: string | null = null) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta('setGhostTextLoading', { isLoading, message })
            dispatch(tr)
          }
          return true
        },

      acceptGhostText:
        () =>
        ({ editor }) => {
          const pluginState = ghostTextPluginKey.getState(editor.state)
          if (!pluginState?.rawText || pluginState.position === null) {
            return false
          }

          // Capture all needed data before any state changes
          const { rawText, citations, papers, position } = pluginState

          // NOTE: We don't manually clear ghost text here.
          // The insert operation changes the doc, which triggers docChanged in the plugin,
          // which automatically clears the ghost text state.

          // Process rawText (with [@id] markers) through unified pipeline
          try {
            const { json: processedContent, isFullDoc } = processContent(rawText, papers)

            if (isFullDoc && processedContent.content) {
              // Full document - insert the content array
              editor.chain().focus().insertContentAt(position, processedContent.content).run()
            } else if (Array.isArray(processedContent) && processedContent.length > 0) {
              // Content fragment - insert directly
              editor.chain().focus().insertContentAt(position, processedContent).run()
            } else {
              // Fallback: simple text insert (no citations to process)
              editor.chain().focus().insertContentAt(position, rawText).run()
            }
          } catch (error) {
            // If content processing fails, insert as plain text
            console.error('Ghost text content processing error:', error)
            editor.chain().focus().insertContentAt(position, rawText).run()
          }

          // Emit event for citations that were accepted (so citedContent can be saved)
          if (citations.length > 0) {
            const event = new CustomEvent('ghosttext:citations-accepted', {
              detail: { citations },
              bubbles: true
            })
            editor.view.dom.dispatchEvent(event)
          }

          // Emit event that ghost text was accepted (for sentence queue progression)
          const acceptedEvent = new CustomEvent('ghosttext:accepted', {
            bubbles: true
          })
          editor.view.dom.dispatchEvent(acceptedEvent)

          return true
        },

      acceptNextWord:
        () =>
        ({ editor }) => {
          const pluginState = ghostTextPluginKey.getState(editor.state)
          if (!pluginState?.rawText || pluginState.position === null) {
            return false
          }

          const { rawText, citations, papers, position, queueCount } = pluginState

          // Split rawText into tokens (words and citation markers)
          // Citation markers like [@paperId#instanceId] are treated as single units
          const tokens = rawText.match(/\[@[\w#-]+\]|\S+/g) || []
          
          if (tokens.length === 0) {
            return false
          }

          // Get the next token to accept
          const nextToken = tokens[0]!
          const remainingTokens = tokens.slice(1)
          const remainingText = remainingTokens.join(' ')

          // Insert the next token at the current position
          editor.chain().focus().insertContentAt(position, nextToken).run()

          // Calculate new position (after the inserted token)
          const newPosition = position + nextToken.length

          // Filter citations to only include those still in the remaining text
          const remainingCitations = citations.filter(citation => {
            // Check if the citation marker is still in the remaining text
            return remainingText.includes(citation.marker)
          })

          // Update ghost text state with remaining content
          if (remainingText.length > 0) {
            // Process the remaining text to get new display text
            try {
              const { json: processedContent } = processContent(remainingText, papers)
              // Extract plain text from processed content for display
              let newDisplayText = remainingText
              if (processedContent && typeof processedContent === 'object') {
                // Simple extraction of text content
                const extractText = (node: unknown): string => {
                  if (typeof node === 'string') return node
                  if (Array.isArray(node)) return node.map(extractText).join('')
                  if (node && typeof node === 'object') {
                    if ('text' in node && typeof node.text === 'string') return node.text
                    if ('content' in node && Array.isArray(node.content)) {
                      return node.content.map(extractText).join('')
                    }
                  }
                  return ''
                }
                const extracted = extractText(processedContent)
                if (extracted) newDisplayText = extracted
              }

              // Update the ghost text with remaining content
              const tr = editor.state.tr
              tr.setMeta('setGhostText', {
                rawText: remainingText,
                displayText: newDisplayText,
                citations: remainingCitations,
                papers,
                queueCount
              })
              // Set selection to the new position
              tr.setSelection(TextSelection.near(tr.doc.resolve(newPosition)))
              editor.view.dispatch(tr)
            } catch {
              // Fallback: update with raw remaining text
              const tr = editor.state.tr
              tr.setMeta('setGhostText', {
                rawText: remainingText,
                displayText: remainingText,
                citations: remainingCitations,
                papers,
                queueCount
              })
              tr.setSelection(TextSelection.near(tr.doc.resolve(newPosition)))
              editor.view.dispatch(tr)
            }
          } else {
            // No remaining text, clear ghost text
            editor.commands.clearGhostText()
          }

          return true
        },

      clearGhostText:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta('clearGhostText', true)
            dispatch(tr)
          }
          return true
        }
    }
  },

  addKeyboardShortcuts() {
    return {
      // Ctrl/Cmd + Space is handled externally to trigger generation
      // Tab and Escape are handled in the plugin's handleKeyDown
    }
  }
})

// Helper to get current ghost text state
export function getGhostTextState(editor: { state: { doc: unknown } }): GhostTextState | null {
  return ghostTextPluginKey.getState(editor.state as Parameters<typeof ghostTextPluginKey.getState>[0]) || null
}

// Helper to check if ghost text is active
export function hasGhostText(editor: { state: { doc: unknown } }): boolean {
  const state = getGhostTextState(editor)
  return !!state?.rawText
}

// Helper to check if ghost text is loading
export function isGhostTextLoading(editor: { state: { doc: unknown } }): boolean {
  const state = getGhostTextState(editor)
  return !!state?.isLoading
}
