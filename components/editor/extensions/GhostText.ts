import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { ProjectPaper } from '../types'
// Pre-import content processor to avoid async issues in commands
import { processContent } from '../utils/content-processor'

// Types for ghost text state
export interface GhostTextState {
  text: string | null
  citations: GhostTextCitation[]
  papers: ProjectPaper[]
  position: number | null
}

export interface GhostTextCitation {
  paperId: string
  marker: string
  startOffset: number
  endOffset: number
  attrs: {
    id: string
    authors: string[]
    title: string
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
       */
      setGhostText: (text: string, citations?: GhostTextCitation[], papers?: ProjectPaper[]) => ReturnType
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
function renderGhostTextContent(
  container: HTMLElement,
  text: string,
  citations: GhostTextCitation[]
): void {
  // Clear container
  container.textContent = ''

  if (citations.length === 0) {
    container.textContent = text
    return
  }

  const sortedCitations = [...citations].sort((a, b) => a.startOffset - b.startOffset)
  let lastEnd = 0

  for (const citation of sortedCitations) {
    // Add text before citation
    if (citation.startOffset > lastEnd) {
      container.appendChild(
        document.createTextNode(text.slice(lastEnd, citation.startOffset))
      )
    }

    // Add citation with special styling
    const citationSpan = document.createElement('span')
    citationSpan.className = 'ghost-text-citation'
    citationSpan.textContent = citation.marker
    container.appendChild(citationSpan)

    lastEnd = citation.endOffset
  }

  // Add remaining text after last citation
  if (lastEnd < text.length) {
    container.appendChild(document.createTextNode(text.slice(lastEnd)))
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
              text: null,
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
                text: setGhostText.text,
                citations: setGhostText.citations || [],
                papers: setGhostText.papers || [],
                position: tr.selection.from
              }
            }

            const clearGhostText = tr.getMeta('clearGhostText')
            if (clearGhostText) {
              return {
                text: null,
                citations: [],
                papers: [],
                position: null
              }
            }

            // Clear ghost text if document changed (user typed something)
            if (tr.docChanged && value.text) {
              return {
                text: null,
                citations: [],
                papers: [],
                position: null
              }
            }

            // Clear if selection moved away from ghost text position
            if (value.position !== null && tr.selection.from !== value.position) {
              return {
                text: null,
                citations: [],
                papers: [],
                position: null
              }
            }

            return value
          }
        },

        props: {
          // Render ghost text as decoration
          decorations(state) {
            const pluginState = ghostTextPluginKey.getState(state)
            if (!pluginState?.text || pluginState.position === null) {
              return DecorationSet.empty
            }

            // Create a widget decoration that renders after the cursor
            const widget = Decoration.widget(
              pluginState.position,
              () => {
                const span = document.createElement('span')
                span.className = 'ghost-text'
                span.setAttribute('data-ghost-text', 'true')
                
                // Use safe DOM rendering
                renderGhostTextContent(
                  span,
                  pluginState.text || '',
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
            if (!pluginState?.text) {
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
        (text: string, citations: GhostTextCitation[] = [], papers: ProjectPaper[] = []) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta('setGhostText', { text, citations, papers })
            dispatch(tr)
          }
          return true
        },

      acceptGhostText:
        () =>
        ({ editor, tr, dispatch }) => {
          const pluginState = ghostTextPluginKey.getState(editor.state)
          if (!pluginState?.text || pluginState.position === null) {
            return false
          }

          // Capture all needed data before any state changes
          const { text, citations, papers, position } = pluginState

          if (dispatch) {
            // Clear ghost text state FIRST
            tr.setMeta('clearGhostText', true)
            dispatch(tr)
          }

          // Now synchronously process and insert content
          // Using pre-imported processContent - no async needed
          try {
            const { json: processedContent, isFullDoc } = processContent(text, papers)

            if (isFullDoc && processedContent.content) {
              // Full document - insert the content array
              editor.chain().focus().insertContentAt(position, processedContent.content).run()
            } else if (Array.isArray(processedContent) && processedContent.length > 0) {
              // Content fragment - insert directly
              editor.chain().focus().insertContentAt(position, processedContent).run()
            } else if (citations.length === 0) {
              // Fallback: simple text insert
              editor.chain().focus().insertContentAt(position, text).run()
            } else {
              // Fallback with citations from API
              const contentParts: Array<{type: string; text?: string; attrs?: GhostTextCitation['attrs']}> = []
              let lastEnd = 0

              const sortedCitations = [...citations].sort(
                (a, b) => a.startOffset - b.startOffset
              )

              for (const citation of sortedCitations) {
                if (citation.startOffset > lastEnd) {
                  contentParts.push({
                    type: 'text',
                    text: text.slice(lastEnd, citation.startOffset)
                  })
                }

                contentParts.push({
                  type: 'citation',
                  attrs: citation.attrs
                })

                lastEnd = citation.endOffset
              }

              if (lastEnd < text.length) {
                contentParts.push({
                  type: 'text',
                  text: text.slice(lastEnd)
                })
              }

              editor.chain().focus().insertContentAt(position, contentParts).run()
            }
          } catch (error) {
            // If content processing fails, insert as plain text
            console.error('Ghost text content processing error:', error)
            editor.chain().focus().insertContentAt(position, text).run()
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

  // Add keyboard shortcuts
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
  return !!state?.text
}
