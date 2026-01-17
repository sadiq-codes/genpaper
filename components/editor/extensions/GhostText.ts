import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
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
}

export interface GhostTextCitation {
  paperId: string
  marker: string       // Original [@id] marker (Pandoc format)
  formatted: string    // Formatted display text (Smith et al., 2024)
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
       */
      setGhostText: (
        rawText: string,
        displayText: string,
        citations?: GhostTextCitation[],
        papers?: ProjectPaper[]
      ) => ReturnType
      /**
       * Accept and insert the ghost text
       */
      acceptGhostText: () => ReturnType
      /**
       * Clear/dismiss the ghost text
       */
      clearGhostText: () => ReturnType
    }
  }
}

// Safely render ghost text content using DOM API (XSS-safe)
// Uses displayText with formatted citations highlighted
function renderGhostTextContent(
  container: HTMLElement,
  displayText: string,
  citations: GhostTextCitation[]
): void {
  container.textContent = ''

  if (citations.length === 0) {
    container.textContent = displayText
    return
  }

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
              position: null
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
                position: tr.selection.from
              }
            }

            const clearGhostText = tr.getMeta('clearGhostText')
            if (clearGhostText) {
              return {
                rawText: null,
                displayText: null,
                citations: [],
                papers: [],
                position: null
              }
            }

            // Clear ghost text if document changed (user typed something)
            if (tr.docChanged && value.rawText) {
              return {
                rawText: null,
                displayText: null,
                citations: [],
                papers: [],
                position: null
              }
            }

            // Clear if selection moved away from ghost text position
            if (value.position !== null && tr.selection.from !== value.position) {
              return {
                rawText: null,
                displayText: null,
                citations: [],
                papers: [],
                position: null
              }
            }

            return value
          }
        },

        props: {
          // Render ghost text as decoration using displayText
          decorations(state) {
            const pluginState = ghostTextPluginKey.getState(state)
            if (!pluginState?.displayText || pluginState.position === null) {
              return DecorationSet.empty
            }

            // Create a widget decoration that renders after the cursor
            const widget = Decoration.widget(
              pluginState.position,
              () => {
                const span = document.createElement('span')
                span.className = 'ghost-text'
                span.setAttribute('data-ghost-text', 'true')
                
                // Render using displayText (formatted citations)
                renderGhostTextContent(
                  span,
                  pluginState.displayText || '',
                  pluginState.citations
                )
                
                return span
              },
              { side: 1 } // Render after cursor
            )

            return DecorationSet.create(state.doc, [widget])
          },

          // Handle keyboard events
          handleKeyDown(view, event) {
            const pluginState = ghostTextPluginKey.getState(view.state)
            if (!pluginState?.rawText) {
              return false
            }

            // Tab - accept ghost text
            if (event.key === 'Tab' && !event.shiftKey) {
              event.preventDefault()
              editor.commands.acceptGhostText()
              return true
            }

            // Escape - clear ghost text
            if (event.key === 'Escape') {
              event.preventDefault()
              editor.commands.clearGhostText()
              return true
            }

            // Arrow keys - clear ghost text and let default behavior happen
            if (event.key.startsWith('Arrow')) {
              editor.commands.clearGhostText()
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
          papers: ProjectPaper[] = []
        ) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta('setGhostText', { rawText, displayText, citations, papers })
            dispatch(tr)
          }
          return true
        },

      acceptGhostText:
        () =>
        ({ editor, tr, dispatch }) => {
          const pluginState = ghostTextPluginKey.getState(editor.state)
          if (!pluginState?.rawText || pluginState.position === null) {
            return false
          }

          // Capture all needed data before any state changes
          const { rawText, citations: _citations, papers, position } = pluginState

          if (dispatch) {
            // Clear ghost text state FIRST
            tr.setMeta('clearGhostText', true)
            dispatch(tr)
          }

          // Citation formatting is now 100% local via CitationNodeView
          // The papers array passed to processContent provides all metadata needed
          // No need for CitationManager cache population

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
