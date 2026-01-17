/**
 * GhostEdit Extension - Block-level visual previews for AI document edits
 * 
 * This extension shows proposed edits as distinct diff blocks:
 * - Deletions: Block showing content to be removed (red)
 * - Insertions: Block showing content to be added (green)
 * - Replacements: Block showing both old and new content
 * 
 * Users can accept/reject edits via:
 * - Large buttons in each diff block
 * - Keyboard: Enter (accept), Escape (reject), Tab (navigate)
 * - Floating toolbar for batch operations
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
  /** Current chunk start index for pagination (0, 5, 10, ...) */
  chunkStart: number
  /** Number of edits to show at once */
  chunkSize: number
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
      /**
       * Set the active edit by ID
       */
      setActiveGhostEdit: (editId: string) => ReturnType
    }
  }
}

// =============================================================================
// CONSTANTS
// =============================================================================

const CHUNK_SIZE = 5 // Show 5 edits at a time for performance

// =============================================================================
// DECORATION BUILDERS
// =============================================================================

/**
 * Create a block-level diff decoration for an edit
 */
function createDiffBlockDecoration(
  edit: CalculatedEdit,
  isActive: boolean,
  editNumber: number,
  totalEdits: number,
  onAccept: (editId: string) => void,
  onReject: (editId: string) => void,
  onNavigateNext: () => void,
  onNavigatePrev: () => void
): Decoration {
  // Create the decoration at the start of the edit
  const position = edit.from

  return Decoration.widget(position, () => {
    return createDiffBlockElement(
      edit,
      isActive,
      editNumber,
      totalEdits,
      onAccept,
      onReject,
      onNavigateNext,
      onNavigatePrev
    )
  }, {
    side: -1, // Before the content
    key: `diff-block-${edit.id}`,
  })
}

/**
 * Create the DOM element for a diff block
 */
function createDiffBlockElement(
  edit: CalculatedEdit,
  isActive: boolean,
  editNumber: number,
  totalEdits: number,
  onAccept: (editId: string) => void,
  onReject: (editId: string) => void,
  onNavigateNext: () => void,
  onNavigatePrev: () => void
): HTMLElement {
  const container = document.createElement('div')
  container.className = `diff-block diff-block--${edit.type}${isActive ? ' diff-block--active' : ''}`
  container.setAttribute('data-edit-id', edit.id)
  container.setAttribute('data-diff-block', 'true')
  container.setAttribute('role', 'region')
  container.setAttribute('aria-label', `Edit ${editNumber} of ${totalEdits}: ${getEditTypeLabel(edit.type)}`)

  // Header
  const header = document.createElement('div')
  header.className = 'diff-block__header'
  
  const headerLeft = document.createElement('div')
  headerLeft.className = 'diff-block__header-left'
  
  const icon = document.createElement('span')
  icon.className = `diff-block__icon diff-block__icon--${edit.type}`
  icon.innerHTML = getEditTypeIcon(edit.type)
  headerLeft.appendChild(icon)
  
  const label = document.createElement('span')
  label.className = 'diff-block__label'
  label.textContent = getEditTypeLabel(edit.type)
  headerLeft.appendChild(label)
  
  header.appendChild(headerLeft)

  // Navigation (if multiple edits)
  if (totalEdits > 1) {
    const nav = document.createElement('div')
    nav.className = 'diff-block__nav'
    
    const prevBtn = document.createElement('button')
    prevBtn.className = 'diff-block__nav-btn'
    prevBtn.innerHTML = '&larr;'
    prevBtn.title = 'Previous edit (Shift+Tab)'
    prevBtn.onclick = (e) => { e.stopPropagation(); onNavigatePrev() }
    nav.appendChild(prevBtn)
    
    const position = document.createElement('span')
    position.className = 'diff-block__position'
    position.textContent = `${editNumber}/${totalEdits}`
    nav.appendChild(position)
    
    const nextBtn = document.createElement('button')
    nextBtn.className = 'diff-block__nav-btn'
    nextBtn.innerHTML = '&rarr;'
    nextBtn.title = 'Next edit (Tab)'
    nextBtn.onclick = (e) => { e.stopPropagation(); onNavigateNext() }
    nav.appendChild(nextBtn)
    
    header.appendChild(nav)
  }

  container.appendChild(header)

  // Content sections
  const showOld = edit.type === 'delete' || edit.type === 'replace'
  const showNew = edit.type === 'insert' || edit.type === 'replace'

  if (showOld && edit.oldContent) {
    const oldSection = createContentSection(edit.oldContent, 'old')
    container.appendChild(oldSection)
  }

  if (showNew && edit.newContent) {
    const newSection = createContentSection(edit.newContent, 'new')
    container.appendChild(newSection)
  }

  // Actions
  const actions = document.createElement('div')
  actions.className = 'diff-block__actions'

  const hints = document.createElement('div')
  hints.className = 'diff-block__hints'
  hints.innerHTML = '<kbd>Enter</kbd> accept <kbd>Esc</kbd> reject'
  actions.appendChild(hints)

  const buttons = document.createElement('div')
  buttons.className = 'diff-block__buttons'

  const rejectBtn = document.createElement('button')
  rejectBtn.className = 'diff-block__btn diff-block__btn--reject'
  rejectBtn.innerHTML = '<span class="diff-block__btn-icon">✕</span> Reject'
  rejectBtn.onclick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    onReject(edit.id)
  }
  buttons.appendChild(rejectBtn)

  const acceptBtn = document.createElement('button')
  acceptBtn.className = 'diff-block__btn diff-block__btn--accept'
  acceptBtn.innerHTML = '<span class="diff-block__btn-icon">✓</span> Accept'
  acceptBtn.onclick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    onAccept(edit.id)
  }
  buttons.appendChild(acceptBtn)

  actions.appendChild(buttons)
  container.appendChild(actions)

  return container
}

/**
 * Create a content section (old or new)
 */
function createContentSection(content: string, variant: 'old' | 'new'): HTMLElement {
  const section = document.createElement('div')
  section.className = `diff-block__content diff-block__content--${variant}`

  const labelDiv = document.createElement('div')
  labelDiv.className = `diff-block__content-label diff-block__content-label--${variant}`
  labelDiv.innerHTML = variant === 'old' 
    ? '<span class="diff-block__content-icon">−</span> Current content (will be removed)'
    : '<span class="diff-block__content-icon">+</span> New content (will be added)'
  section.appendChild(labelDiv)

  const textDiv = document.createElement('div')
  textDiv.className = `diff-block__content-text diff-block__content-text--${variant}`
  textDiv.textContent = content
  section.appendChild(textDiv)

  return section
}

/**
 * Get icon SVG for edit type
 */
function getEditTypeIcon(type: 'delete' | 'insert' | 'replace'): string {
  switch (type) {
    case 'delete':
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>'
    case 'insert':
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
    case 'replace':
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>'
  }
}

/**
 * Get label for edit type
 */
function getEditTypeLabel(type: 'delete' | 'insert' | 'replace'): string {
  switch (type) {
    case 'delete': return 'Delete'
    case 'insert': return 'Insert'
    case 'replace': return 'Replace'
  }
}

/**
 * Scroll the editor view to show a specific edit
 */
function scrollToEdit(editor: { view: { dom: HTMLElement } }, editId: string): void {
  const editorDom = editor.view.dom
  // Use CSS.escape to handle any special characters in the editId
  const escapedId = CSS.escape(editId)
  const editElement = editorDom.querySelector(`[data-edit-id="${escapedId}"]`) as HTMLElement | null
  
  if (editElement) {
    editElement.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    })
    
    // Add highlight animation
    editElement.classList.add('diff-block--highlight')
    setTimeout(() => {
      editElement.classList.remove('diff-block--highlight')
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
              chunkStart: 0,
              chunkSize: CHUNK_SIZE,
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
                chunkStart: 0,
                chunkSize: CHUNK_SIZE,
                onAccept: setEdits.onAccept,
                onReject: setEdits.onReject,
              }
            }

            // Check for clearGhostEdits meta
            if (tr.getMeta('clearGhostEdits')) {
              return {
                edits: [],
                activeEditId: null,
                chunkStart: 0,
                chunkSize: CHUNK_SIZE,
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

            // Check for setActiveGhostEdit meta
            const setActiveId = tr.getMeta('setActiveGhostEdit') as string | undefined
            if (setActiveId && value.edits.some(e => e.id === setActiveId)) {
              return {
                ...value,
                activeEditId: setActiveId,
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

            // If document changed while ghost edits are active, clear them
            // (positions may now be invalid)
            if (tr.docChanged && value.edits.length > 0) {
              if (!tr.getMeta('ghostEditAccepted')) {
                return {
                  edits: [],
                  activeEditId: null,
                  chunkStart: 0,
                  chunkSize: CHUNK_SIZE,
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
            const totalEdits = pluginState.edits.length

            // Create navigation handlers
            const createNavigateNext = () => {
              editor.commands.navigateGhostEdit('next')
            }
            const createNavigatePrev = () => {
              editor.commands.navigateGhostEdit('prev')
            }

            // Create decorations for visible edits
            const visibleEdits = pluginState.edits.slice(
              pluginState.chunkStart,
              pluginState.chunkStart + pluginState.chunkSize
            )

            for (let i = 0; i < visibleEdits.length; i++) {
              const edit = visibleEdits[i]
              const isActive = edit.id === pluginState.activeEditId
              const editNumber = pluginState.chunkStart + i + 1

              const decoration = createDiffBlockDecoration(
                edit,
                isActive,
                editNumber,
                totalEdits,
                onAccept,
                onReject,
                createNavigateNext,
                createNavigatePrev
              )
              allDecorations.push(decoration)
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

            // Cmd/Ctrl+Shift+A - accept all (handled at higher level)
            // Cmd/Ctrl+Shift+R - reject all (handled at higher level)

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
              scrollToEdit(editor as { view: { dom: HTMLElement } }, edits[0].id)
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

          // Scroll to the new active edit after a short delay
          if (newActiveEdit) {
            setTimeout(() => {
              scrollToEdit(editor as { view: { dom: HTMLElement } }, newActiveEdit.id)
            }, 10)
          }

          return true
        },

      scrollToGhostEdit:
        (editId: string) =>
        ({ editor }: { editor: { state: Parameters<typeof ghostEditPluginKey.getState>[0]; view: { dom: HTMLElement } } }) => {
          const pluginState = ghostEditPluginKey.getState(editor.state)
          if (!pluginState) return false

          const edit = pluginState.edits.find(e => e.id === editId)
          if (!edit) return false

          scrollToEdit(editor, editId)
          return true
        },

      setActiveGhostEdit:
        (editId: string) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta('setActiveGhostEdit', editId)
            dispatch(tr)
          }
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

/**
 * Get the current active edit index (1-based)
 */
export function getActiveEditIndex(editor: { state: { doc: unknown } }): number {
  const state = getGhostEditState(editor)
  if (!state || !state.activeEditId) return 0
  const index = state.edits.findIndex(e => e.id === state.activeEditId)
  return index >= 0 ? index + 1 : 0
}
