import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// Types for ghost text state
export interface GhostTextState {
  text: string | null
  citations: GhostTextCitation[]
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
      setGhostText: (text: string, citations?: GhostTextCitation[]) => ReturnType
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
                position: tr.selection.from
              }
            }

            const clearGhostText = tr.getMeta('clearGhostText')
            if (clearGhostText) {
              return {
                text: null,
                citations: [],
                position: null
              }
            }

            // Clear ghost text if document changed (user typed something)
            if (tr.docChanged && value.text) {
              return {
                text: null,
                citations: [],
                position: null
              }
            }

            // Clear if selection moved away from ghost text position
            if (value.position !== null && tr.selection.from !== value.position) {
              return {
                text: null,
                citations: [],
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
                
                // Render text with citations highlighted
                if (pluginState.citations.length === 0) {
                  span.textContent = pluginState.text
                } else {
                  // Build HTML with citation spans
                  let html = ''
                  let lastEnd = 0
                  const text = pluginState.text || ''
                  
                  // Sort citations by start offset
                  const sortedCitations = [...pluginState.citations].sort(
                    (a, b) => a.startOffset - b.startOffset
                  )
                  
                  for (const citation of sortedCitations) {
                    // Add text before citation
                    if (citation.startOffset > lastEnd) {
                      html += escapeHtml(text.slice(lastEnd, citation.startOffset))
                    }
                    // Add citation with special styling
                    html += `<span class="ghost-text-citation">${escapeHtml(citation.marker)}</span>`
                    lastEnd = citation.endOffset
                  }
                  
                  // Add remaining text
                  if (lastEnd < text.length) {
                    html += escapeHtml(text.slice(lastEnd))
                  }
                  
                  span.innerHTML = html
                }
                
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
        (text: string, citations: GhostTextCitation[] = []) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta('setGhostText', { text, citations })
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

          if (dispatch) {
            const { text, citations, position } = pluginState

            // Build content to insert
            if (citations.length === 0) {
              // Simple case: just insert text
              tr.insertText(text, position)
            } else {
              // Complex case: insert text with citation nodes
              const contentParts: any[] = []
              let lastEnd = 0

              // Sort citations by offset ascending
              const sortedCitations = [...citations].sort(
                (a, b) => a.startOffset - b.startOffset
              )

              for (const citation of sortedCitations) {
                // Add text before this citation
                if (citation.startOffset > lastEnd) {
                  contentParts.push({
                    type: 'text',
                    text: text.slice(lastEnd, citation.startOffset)
                  })
                }

                // Add citation node
                contentParts.push({
                  type: 'citation',
                  attrs: citation.attrs
                })

                lastEnd = citation.endOffset
              }

              // Add remaining text after last citation
              if (lastEnd < text.length) {
                contentParts.push({
                  type: 'text',
                  text: text.slice(lastEnd)
                })
              }

              // Insert all content
              editor.chain().focus().insertContentAt(position, contentParts).run()
            }

            // Clear ghost text state
            tr.setMeta('clearGhostText', true)
            dispatch(tr)
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

// Helper to escape HTML
function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// Helper to get current ghost text state
export function getGhostTextState(editor: any): GhostTextState | null {
  return ghostTextPluginKey.getState(editor.state) || null
}

// Helper to check if ghost text is active
export function hasGhostText(editor: any): boolean {
  const state = getGhostTextState(editor)
  return !!state?.text
}
