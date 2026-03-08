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
import type { DocumentChangeRange } from '../services/doc-diff'

// =============================================================================
// UTILS
// =============================================================================

/**
 * Clean raw citation markers from preview text.
 * Converts [@paperId#instanceId] → [citation] for human-readable display.
 * Also handles [N] numbered markers.
 */
function cleanCitationMarkers(text: string): string {
  // Replace [@uuid#uuid] format with readable placeholder
  let cleaned = text.replace(/\[@[0-9a-f-]+#[0-9a-f-]+\]/gi, '[citation]')
  // Replace [@uuid] format (without instance) 
  cleaned = cleaned.replace(/\[@[0-9a-f-]+\]/gi, '[citation]')
  // Collapse consecutive [citation][citation] into [citations]
  cleaned = cleaned.replace(/(\[citation\]\s*){2,}/g, '[citations]')
  return cleaned
}

/**
 * Build an HTML <table> element from headers and rows arrays.
 */
function buildTableElement(headers: string[], rows: string[][], variant: 'old' | 'new'): HTMLElement {
  const table = document.createElement('table')
  table.className = `diff-block__table diff-block__table--${variant}`

  const thead = document.createElement('thead')
  const headerRow = document.createElement('tr')
  for (const h of headers) {
    const th = document.createElement('th')
    th.textContent = h
    headerRow.appendChild(th)
  }
  thead.appendChild(headerRow)
  table.appendChild(thead)

  const tbody = document.createElement('tbody')
  for (const row of rows) {
    const tr = document.createElement('tr')
    for (let i = 0; i < headers.length; i++) {
      const td = document.createElement('td')
      td.textContent = row[i] || ''
      tr.appendChild(td)
    }
    tbody.appendChild(tr)
  }
  table.appendChild(tbody)
  return table
}

/**
 * Try to parse pipe-separated text table into headers + rows.
 * Returns null if the text doesn't look like a table.
 */
function parsePipeTable(text: string): { headers: string[]; rows: string[][] } | null {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length < 2) return null
  if (!lines[0].includes('|')) return null

  const parseRow = (line: string) =>
    line.split(/\s*\|\s*/).map(c => c.trim()).filter(Boolean)

  const headers = parseRow(lines[0])
  if (headers.length < 2) return null

  const rows = lines.slice(1)
    .filter(l => !l.match(/^[-|\s]+$/))
    .map(parseRow)

  return { headers, rows }
}

// =============================================================================
// TYPES
// =============================================================================

export interface GhostEditState {
  /** Pending edits to preview */
  edits: CalculatedEdit[]
  /** Batch change highlights for apply-then-review mode */
  changeHighlights: DocumentChangeRange[]
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
       * Set batch change highlights.
       */
      setChangeHighlights: (changes: DocumentChangeRange[]) => ReturnType
      /**
       * Clear batch change highlights.
       */
      clearChangeHighlights: () => ReturnType
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

function createDeletedChangeWidget(change: DocumentChangeRange): HTMLElement {
  const container = document.createElement('div')
  container.className = 'diff-change-delete-widget'
  const preview = (change.oldContent || '').trim()
  container.textContent = preview
    ? `Deleted: ${preview.slice(0, 140)}${preview.length > 140 ? '...' : ''}`
    : 'Deleted content'
  return container
}

/**
 * Create the DOM element for a diff block - minimal inline card style
 */
function createDiffBlockElement(
  edit: CalculatedEdit,
  isActive: boolean,
  _editNumber: number,
  _totalEdits: number,
  onAccept: (editId: string) => void,
  onReject: (editId: string) => void,
  _onNavigateNext: () => void,
  _onNavigatePrev: () => void
): HTMLElement {
  const container = document.createElement('div')
  container.className = `diff-block diff-block--${edit.type}${isActive ? ' diff-block--active' : ''}`
  container.setAttribute('data-edit-id', edit.id)
  container.setAttribute('data-diff-block', 'true')
  container.setAttribute('role', 'region')
  container.setAttribute('aria-label', `${getEditTypeLabel(edit.type)} edit`)

  // Content wrapper — vertical stack: old then new
  const contentWrapper = document.createElement('div')
  contentWrapper.className = 'diff-block__content-wrapper'

  // Show content based on edit type
  const showOld = edit.type === 'delete' || edit.type === 'replace'
  const showNew = edit.type === 'insert' || edit.type === 'replace'

  if (showOld && edit.oldContent) {
    const oldWrapper = document.createElement('div')
    oldWrapper.className = 'diff-block__text diff-block__text--old'
    const oldTable = parsePipeTable(edit.oldContent)
    if (oldTable) {
      oldWrapper.appendChild(buildTableElement(oldTable.headers, oldTable.rows, 'old'))
    } else {
      oldWrapper.textContent = edit.oldContent
    }
    contentWrapper.appendChild(oldWrapper)
  }

  if (showNew && edit.newContent) {
    const newWrapper = document.createElement('div')
    newWrapper.className = 'diff-block__text diff-block__text--new'
    const isTableInsert = edit.toolName === 'insertTable'
    const newTable = isTableInsert
      ? { headers: edit.toolArgs.headers as string[], rows: (edit.toolArgs.rows || []) as string[][] }
      : parsePipeTable(cleanCitationMarkers(edit.newContent))
    if (newTable && newTable.headers?.length) {
      if (edit.toolArgs.caption) {
        const cap = document.createElement('div')
        cap.className = 'diff-block__table-caption'
        cap.textContent = edit.toolArgs.caption as string
        newWrapper.appendChild(cap)
      }
      newWrapper.appendChild(buildTableElement(newTable.headers, newTable.rows, 'new'))
    } else {
      newWrapper.textContent = cleanCitationMarkers(edit.newContent)
    }
    contentWrapper.appendChild(newWrapper)
  }

  container.appendChild(contentWrapper)

  // Action bar at bottom
  const actions = document.createElement('div')
  actions.className = 'diff-block__actions'

  const acceptBtn = document.createElement('button')
  acceptBtn.className = 'diff-block__btn diff-block__btn--accept'
  acceptBtn.textContent = 'Accept'
  acceptBtn.onclick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    onAccept(edit.id)
  }
  actions.appendChild(acceptBtn)

  const rejectBtn = document.createElement('button')
  rejectBtn.className = 'diff-block__btn diff-block__btn--reject'
  rejectBtn.textContent = 'Reject'
  rejectBtn.onclick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    onReject(edit.id)
  }
  actions.appendChild(rejectBtn)

  // Keyboard hint
  const hint = document.createElement('span')
  hint.className = 'diff-block__hint'
  hint.textContent = 'Enter to accept · Esc to reject'
  actions.appendChild(hint)

  container.appendChild(actions)

  return container
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
              changeHighlights: [],
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
                changeHighlights: [],
                activeEditId: setEdits.edits.length > 0 ? setEdits.edits[0].id : null,
                chunkStart: 0,
                chunkSize: CHUNK_SIZE,
                onAccept: setEdits.onAccept,
                onReject: setEdits.onReject,
              }
            }

            const setChangeHighlights = tr.getMeta('setChangeHighlights') as { changes: DocumentChangeRange[] } | undefined
            if (setChangeHighlights) {
              return {
                ...value,
                edits: [],
                activeEditId: null,
                changeHighlights: setChangeHighlights.changes,
              }
            }

            if (tr.getMeta('clearChangeHighlights')) {
              return {
                ...value,
                changeHighlights: [],
              }
            }

            // Check for clearGhostEdits meta
            if (tr.getMeta('clearGhostEdits')) {
              return {
                edits: [],
                changeHighlights: [],
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

            // If document changed while ghost edits are active, map positions
            // through the transaction and trigger a recalc in useEditorChat.
            if (tr.docChanged && value.edits.length > 0) {
              const mappedEdits = value.edits
                .map(edit => {
                  const mappedFrom = tr.mapping.map(edit.from, -1)
                  const mappedTo = tr.mapping.map(edit.to, 1)
                  const clampedFrom = Math.max(0, Math.min(mappedFrom, tr.doc.content.size))
                  const clampedTo = Math.max(clampedFrom, Math.min(mappedTo, tr.doc.content.size))
                  return {
                    ...edit,
                    from: clampedFrom,
                    to: clampedTo,
                  }
                })
                .filter(edit => edit.from <= edit.to)

              if (!tr.getMeta('ghostEditAccepted')) {
                // Emit event so useEditorChat can sync pendingTools state
                const affectedEditIds = value.edits.map(e => e.id)
                setTimeout(() => {
                  editor.view.dom.dispatchEvent(new CustomEvent('ghostedits:invalidated', {
                    detail: { editIds: affectedEditIds, reason: 'document-changed' },
                    bubbles: true,
                  }))
                }, 0)
              }

              const activeEditStillExists = mappedEdits.some(e => e.id === value.activeEditId)
              return {
                ...value,
                edits: mappedEdits,
                activeEditId: mappedEdits.length === 0
                  ? null
                  : activeEditStillExists
                    ? value.activeEditId
                    : mappedEdits[0].id,
              }
            }

            if (tr.docChanged && value.changeHighlights.length > 0) {
              const mapped = value.changeHighlights.map(change => {
                const mappedFrom = tr.mapping.map(change.from, -1)
                const mappedTo = tr.mapping.map(change.to, 1)
                const clampedFrom = Math.max(0, Math.min(mappedFrom, tr.doc.content.size))
                const clampedTo = Math.max(clampedFrom, Math.min(mappedTo, tr.doc.content.size))
                return {
                  ...change,
                  from: clampedFrom,
                  to: clampedTo,
                }
              })
              return {
                ...value,
                changeHighlights: mapped,
              }
            }

            return value
          },
        },

        props: {
          decorations(state) {
            const pluginState = ghostEditPluginKey.getState(state)
            if (!pluginState || (pluginState.edits.length === 0 && pluginState.changeHighlights.length === 0)) {
              return DecorationSet.empty
            }

            const allDecorations: Decoration[] = []

            if (pluginState.changeHighlights.length > 0 && pluginState.edits.length === 0) {
              if (process.env.NODE_ENV === 'development') {
                console.log('[GhostEdit] Rendering changeHighlights:', pluginState.changeHighlights.map(c => ({
                  id: c.id, type: c.type, from: c.from, to: c.to, docSize: state.doc.content.size,
                })))
              }
              for (const change of pluginState.changeHighlights) {
                if (change.type === 'deleted') {
                  allDecorations.push(
                    Decoration.widget(change.from, () => createDeletedChangeWidget(change), {
                      side: -1,
                      key: `change-delete-${change.id}`,
                    })
                  )
                  continue
                }

                if (change.from < change.to) {
                  allDecorations.push(
                    Decoration.inline(change.from, change.to, {
                      class: change.type === 'added'
                        ? 'diff-highlight diff-highlight--added'
                        : 'diff-highlight diff-highlight--modified',
                    })
                  )
                }
              }

              return DecorationSet.create(state.doc, allDecorations)
            }

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

              // Hide the original content for replace/delete edits so it
              // doesn't render alongside the ghost diff widget
              if ((edit.type === 'replace' || edit.type === 'delete') && edit.from < edit.to) {
                allDecorations.push(
                  Decoration.inline(edit.from, edit.to, {
                    class: 'ghost-edit-hidden',
                    style: 'display: none;',
                  })
                )
              }
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
      setChangeHighlights:
        (changes: DocumentChangeRange[]) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta('setChangeHighlights', { changes })
            dispatch(tr)
          }
          return true
        },

      clearChangeHighlights:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta('clearChangeHighlights', true)
            dispatch(tr)
          }
          return true
        },

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
  return !!state && (state.edits.length > 0 || state.changeHighlights.length > 0)
}

/**
 * Get count of pending ghost edits
 */
export function getGhostEditCount(editor: { state: { doc: unknown } }): number {
  const state = getGhostEditState(editor)
  if (!state) return 0
  return state.edits.length > 0 ? state.edits.length : state.changeHighlights.length
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
