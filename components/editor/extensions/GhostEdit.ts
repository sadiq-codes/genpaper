/**
 * GhostEdit Extension - Visual previews for AI document edits
 * 
 * Shows proposed edits as inline decorations:
 * - Deletions: Red strikethrough
 * - Insertions: Green highlighted text
 * - Replacements: Red strikethrough + green insertion
 * 
 * Users can accept/reject edits via inline buttons or keyboard.
 */

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { CalculatedEdit } from '../services/edit-calculator'

// =============================================================================
// TYPES
// =============================================================================

export interface GhostEditState {
  /** Pending edits to preview */
  edits: CalculatedEdit[]
  /** Currently focused edit (for keyboard navigation) */
  activeEditId: string | null
  /** Callbacks for accept/reject */
  onAccept?: (editId: string) => void
  onReject?: (editId: string) => void
}

// Plugin key for accessing ghost edit state
export const ghostEditPluginKey = new PluginKey<GhostEditState>('ghostEdit')

// =============================================================================
// COMMAND DECLARATIONS
// =============================================================================

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    ghostEdit: {
      /**
       * Set ghost edits to preview
       */
      setGhostEdits: (
        edits: CalculatedEdit[],
        onAccept?: (editId: string) => void,
        onReject?: (editId: string) => void
      ) => ReturnType
      /**
       * Clear all ghost edits
       */
      clearGhostEdits: () => ReturnType
      /**
       * Clear a specific ghost edit
       */
      clearGhostEdit: (editId: string) => ReturnType
      /**
       * Accept the active/specified ghost edit
       */
      acceptGhostEdit: (editId?: string) => ReturnType
      /**
       * Reject the active/specified ghost edit
       */
      rejectGhostEdit: (editId?: string) => ReturnType
      /**
       * Navigate to next/previous ghost edit
       */
      navigateGhostEdit: (direction: 'next' | 'prev') => ReturnType
      /**
       * Scroll to a specific ghost edit
       */
      scrollToGhostEdit: (editId: string) => ReturnType
    }
  }
}

// =============================================================================
// DECORATION BUILDERS
// =============================================================================

/**
 * Create decorations for a single edit
 */
function createEditDecorations(
  edit: CalculatedEdit,
  isActive: boolean,
  onAccept: (editId: string) => void,
  onReject: (editId: string) => void
): Decoration[] {
  const decorations: Decoration[] = []
  const activeClass = isActive ? ' ghost-edit-active' : ''

  switch (edit.type) {
    case 'delete':
      // Strikethrough for deletion
      decorations.push(
        Decoration.inline(edit.from, edit.to, {
          class: `ghost-edit-delete${activeClass}`,
          'data-edit-id': edit.id,
        })
      )
      // Control buttons after the deletion
      decorations.push(
        Decoration.widget(edit.to, () => createControlWidget(edit, onAccept, onReject), {
          side: 1,
          key: `controls-${edit.id}`,
        })
      )
      break

    case 'insert':
      // Green text widget for insertion
      decorations.push(
        Decoration.widget(edit.from, () => createInsertWidget(edit, isActive, onAccept, onReject), {
          side: 1,
          key: `insert-${edit.id}`,
        })
      )
      break

    case 'replace':
      // Strikethrough for old content
      if (edit.from !== edit.to) {
        decorations.push(
          Decoration.inline(edit.from, edit.to, {
            class: `ghost-edit-delete${activeClass}`,
            'data-edit-id': edit.id,
          })
        )
      }
      // Green widget for new content (after the strikethrough)
      decorations.push(
        Decoration.widget(edit.to, () => createReplaceWidget(edit, isActive, onAccept, onReject), {
          side: 1,
          key: `replace-${edit.id}`,
        })
      )
      break
  }

  return decorations
}

/**
 * Create the insertion widget (green text + controls)
 */
function createInsertWidget(
  edit: CalculatedEdit,
  isActive: boolean,
  onAccept: (editId: string) => void,
  onReject: (editId: string) => void
): HTMLElement {
  const container = document.createElement('span')
  container.className = `ghost-edit-insert-container${isActive ? ' ghost-edit-active' : ''}`
  container.setAttribute('data-edit-id', edit.id)

  // Insert text preview
  const textSpan = document.createElement('span')
  textSpan.className = 'ghost-edit-insert'
  textSpan.textContent = truncateForPreview(edit.newContent, 100)
  container.appendChild(textSpan)

  // Add controls
  container.appendChild(createControlButtons(edit, onAccept, onReject))

  return container
}

/**
 * Create the replacement widget (green text + controls)
 */
function createReplaceWidget(
  edit: CalculatedEdit,
  isActive: boolean,
  onAccept: (editId: string) => void,
  onReject: (editId: string) => void
): HTMLElement {
  const container = document.createElement('span')
  container.className = `ghost-edit-replace-container${isActive ? ' ghost-edit-active' : ''}`
  container.setAttribute('data-edit-id', edit.id)

  // New content preview
  const textSpan = document.createElement('span')
  textSpan.className = 'ghost-edit-insert'
  textSpan.textContent = truncateForPreview(edit.newContent, 100)
  container.appendChild(textSpan)

  // Add controls
  container.appendChild(createControlButtons(edit, onAccept, onReject))

  return container
}

/**
 * Create just the control widget (for deletions where text is inline styled)
 */
function createControlWidget(
  edit: CalculatedEdit,
  onAccept: (editId: string) => void,
  onReject: (editId: string) => void
): HTMLElement {
  const container = document.createElement('span')
  container.className = 'ghost-edit-control-container'
  container.setAttribute('data-edit-id', edit.id)
  container.appendChild(createControlButtons(edit, onAccept, onReject))
  return container
}

/**
 * Create accept/reject buttons
 */
function createControlButtons(
  edit: CalculatedEdit,
  onAccept: (editId: string) => void,
  onReject: (editId: string) => void
): HTMLElement {
  const controls = document.createElement('span')
  controls.className = 'ghost-edit-controls'

  // Accept button
  const acceptBtn = document.createElement('button')
  acceptBtn.className = 'ghost-edit-btn ghost-edit-accept'
  acceptBtn.textContent = '✓'
  acceptBtn.title = 'Accept edit (Enter)'
  acceptBtn.onclick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    onAccept(edit.id)
  }

  // Reject button
  const rejectBtn = document.createElement('button')
  rejectBtn.className = 'ghost-edit-btn ghost-edit-reject'
  rejectBtn.textContent = '✕'
  rejectBtn.title = 'Reject edit (Escape)'
  rejectBtn.onclick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    onReject(edit.id)
  }

  controls.appendChild(acceptBtn)
  controls.appendChild(rejectBtn)

  return controls
}

/**
 * Truncate text for preview display
 */
function truncateForPreview(text: string, maxLength: number): string {
  // Remove excessive whitespace/newlines for inline preview
  const cleaned = text.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim()
  if (cleaned.length <= maxLength) return cleaned
  return cleaned.slice(0, maxLength) + '...'
}

/**
 * Scroll the editor view to show a specific edit
 */
function scrollToEdit(editor: { view: { dom: HTMLElement } }, edit: CalculatedEdit): void {
  // Find the decoration element in the DOM
  const editorDom = editor.view.dom
  const editElement = editorDom.querySelector(`[data-edit-id="${edit.id}"]`) as HTMLElement | null
  
  if (editElement) {
    // Scroll the element into view with some padding
    editElement.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    })
    
    // Add a brief highlight pulse to draw attention
    editElement.classList.add('ghost-edit-scroll-highlight')
    setTimeout(() => {
      editElement.classList.remove('ghost-edit-scroll-highlight')
    }, 600)
  }
}

// =============================================================================
// EXTENSION
// =============================================================================

export const GhostEdit = Extension.create({
  name: 'ghostEdit',

  addProseMirrorPlugins() {
    const editor = this.editor

    return [
      new Plugin({
        key: ghostEditPluginKey,

        state: {
          init(): GhostEditState {
            return {
              edits: [],
              activeEditId: null,
            }
          },

          apply(tr, value): GhostEditState {
            // Check for setGhostEdits meta
            const setEdits = tr.getMeta('setGhostEdits') as {
              edits: CalculatedEdit[]
              onAccept?: (editId: string) => void
              onReject?: (editId: string) => void
            } | undefined
            
            if (setEdits) {
              return {
                edits: setEdits.edits,
                activeEditId: setEdits.edits.length > 0 ? setEdits.edits[0].id : null,
                onAccept: setEdits.onAccept,
                onReject: setEdits.onReject,
              }
            }

            // Check for clearGhostEdits meta
            if (tr.getMeta('clearGhostEdits')) {
              return {
                edits: [],
                activeEditId: null,
              }
            }

            // Check for clearGhostEdit (single) meta
            const clearEditId = tr.getMeta('clearGhostEdit') as string | undefined
            if (clearEditId) {
              const remaining = value.edits.filter(e => e.id !== clearEditId)
              return {
                ...value,
                edits: remaining,
                activeEditId: remaining.length > 0 
                  ? (value.activeEditId === clearEditId ? remaining[0].id : value.activeEditId)
                  : null,
              }
            }

            // Check for navigateGhostEdit meta
            const navigate = tr.getMeta('navigateGhostEdit') as 'next' | 'prev' | undefined
            if (navigate && value.edits.length > 0) {
              const currentIndex = value.edits.findIndex(e => e.id === value.activeEditId)
              let newIndex: number
              
              if (navigate === 'next') {
                newIndex = (currentIndex + 1) % value.edits.length
              } else {
                newIndex = currentIndex <= 0 ? value.edits.length - 1 : currentIndex - 1
              }
              
              return {
                ...value,
                activeEditId: value.edits[newIndex].id,
              }
            }

            // If document changed while ghost edits are active, we need to clear them
            // (positions may now be invalid)
            if (tr.docChanged && value.edits.length > 0) {
              // Check if this was an edit acceptance (shouldn't clear in that case)
              if (!tr.getMeta('ghostEditAccepted')) {
                return {
                  edits: [],
                  activeEditId: null,
                }
              }
            }

            return value
          },
        },

        props: {
          decorations(state) {
            const pluginState = ghostEditPluginKey.getState(state)
            if (!pluginState || pluginState.edits.length === 0) {
              return DecorationSet.empty
            }

            const allDecorations: Decoration[] = []
            const onAccept = pluginState.onAccept || (() => {})
            const onReject = pluginState.onReject || (() => {})

            for (const edit of pluginState.edits) {
              const isActive = edit.id === pluginState.activeEditId
              const editDecos = createEditDecorations(edit, isActive, onAccept, onReject)
              allDecorations.push(...editDecos)
            }

            return DecorationSet.create(state.doc, allDecorations)
          },

          handleKeyDown(view, event) {
            const pluginState = ghostEditPluginKey.getState(view.state)
            if (!pluginState || pluginState.edits.length === 0) {
              return false
            }

            // Enter - accept active edit
            if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
              event.preventDefault()
              editor.commands.acceptGhostEdit()
              return true
            }

            // Escape - reject active edit
            if (event.key === 'Escape') {
              event.preventDefault()
              editor.commands.rejectGhostEdit()
              return true
            }

            // Tab - navigate to next edit
            if (event.key === 'Tab' && !event.shiftKey) {
              event.preventDefault()
              editor.commands.navigateGhostEdit('next')
              return true
            }

            // Shift+Tab - navigate to previous edit
            if (event.key === 'Tab' && event.shiftKey) {
              event.preventDefault()
              editor.commands.navigateGhostEdit('prev')
              return true
            }

            return false
          },
        },
      }),
    ]
  },

  addCommands() {
    return {
      setGhostEdits:
        (
          edits: CalculatedEdit[],
          onAccept?: (editId: string) => void,
          onReject?: (editId: string) => void
        ) =>
        ({ editor, tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta('setGhostEdits', { edits, onAccept, onReject })
            dispatch(tr)
          }
          
          // Scroll to the first edit after a short delay to let decorations render
          if (edits.length > 0) {
            setTimeout(() => {
              scrollToEdit(editor as { view: { dom: HTMLElement } }, edits[0])
            }, 50)
          }
          
          return true
        },

      clearGhostEdits:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta('clearGhostEdits', true)
            dispatch(tr)
          }
          return true
        },

      clearGhostEdit:
        (editId: string) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta('clearGhostEdit', editId)
            dispatch(tr)
          }
          return true
        },

      acceptGhostEdit:
        (editId?: string) =>
        ({ editor }) => {
          const pluginState = ghostEditPluginKey.getState(editor.state)
          if (!pluginState || pluginState.edits.length === 0) {
            return false
          }

          const targetId = editId || pluginState.activeEditId
          if (!targetId) return false

          // Call the onAccept callback (which will handle actual execution)
          if (pluginState.onAccept) {
            pluginState.onAccept(targetId)
          }

          return true
        },

      rejectGhostEdit:
        (editId?: string) =>
        ({ editor }) => {
          const pluginState = ghostEditPluginKey.getState(editor.state)
          if (!pluginState || pluginState.edits.length === 0) {
            return false
          }

          const targetId = editId || pluginState.activeEditId
          if (!targetId) return false

          // Call the onReject callback
          if (pluginState.onReject) {
            pluginState.onReject(targetId)
          }

          return true
        },

      navigateGhostEdit:
        (direction: 'next' | 'prev') =>
        ({ editor, tr, dispatch }) => {
          const pluginState = ghostEditPluginKey.getState(editor.state)
          if (!pluginState || pluginState.edits.length === 0) {
            return false
          }

          // Calculate new active edit
          const currentIndex = pluginState.edits.findIndex(e => e.id === pluginState.activeEditId)
          let newIndex: number
          
          if (direction === 'next') {
            newIndex = (currentIndex + 1) % pluginState.edits.length
          } else {
            newIndex = currentIndex <= 0 ? pluginState.edits.length - 1 : currentIndex - 1
          }
          
          const newActiveEdit = pluginState.edits[newIndex]

          if (dispatch) {
            tr.setMeta('navigateGhostEdit', direction)
            dispatch(tr)
          }

          // Scroll to the new active edit after a short delay to let decorations update
          if (newActiveEdit) {
            setTimeout(() => {
              scrollToEdit(editor, newActiveEdit)
            }, 10)
          }

          return true
        },

      /**
       * Scroll to a specific ghost edit
       */
      scrollToGhostEdit:
        (editId: string) =>
        ({ editor }: { editor: { state: Parameters<typeof ghostEditPluginKey.getState>[0]; view: { dom: HTMLElement } } }) => {
          const pluginState = ghostEditPluginKey.getState(editor.state)
          if (!pluginState) return false

          const edit = pluginState.edits.find(e => e.id === editId)
          if (!edit) return false

          scrollToEdit(editor, edit)
          return true
        },
    }
  },
})

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Get current ghost edit state
 */
export function getGhostEditState(editor: { state: { doc: unknown } }): GhostEditState | null {
  return ghostEditPluginKey.getState(
    editor.state as Parameters<typeof ghostEditPluginKey.getState>[0]
  ) || null
}

/**
 * Check if ghost edits are active
 */
export function hasGhostEdits(editor: { state: { doc: unknown } }): boolean {
  const state = getGhostEditState(editor)
  return !!state && state.edits.length > 0
}

/**
 * Get count of pending ghost edits
 */
export function getGhostEditCount(editor: { state: { doc: unknown } }): number {
  const state = getGhostEditState(editor)
  return state?.edits.length || 0
}
