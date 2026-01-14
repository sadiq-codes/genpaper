'use client'

import { useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { getCitationManager } from './services/CitationManager'

interface CitationUpdaterProps {
  editor: Editor | null
}

/**
 * Updates citation text in the DOM when CitationManager loads data.
 * This bridges the gap between static TipTap rendering and dynamic citation loading.
 */
export function CitationUpdater({ editor }: CitationUpdaterProps) {
  // Track processed DOM elements (not IDs) so undo/redo or re-rendered citations
  // with the same ID still get updated.
  const processedElements = useRef<WeakSet<Element>>(new WeakSet())
  const manager = getCitationManager()

  useEffect(() => {
    if (!editor) return

    const editorElement = editor.view.dom

    const updateCitations = async () => {
      if (!manager.isConfigured()) return

      const citations = editorElement.querySelectorAll('[data-citation]')
      
      for (const el of citations) {
        const id = el.getAttribute('data-citation')
        if (!id || processedElements.current.has(el)) continue

        try {
          const data = await manager.getCitation(id)
          if (data.status === 'loaded' && data.renderedText) {
            // Update DOM text
            el.textContent = data.renderedText
            processedElements.current.add(el)

            // Also update the ProseMirror node attributes for future renders
            if (data.paper) {
              updateNodeInEditor(editor, id, data.paper)
            }
          }
        } catch {
          // Ignore errors, keep original text
        }
      }
    }

    // Initial update
    const timer = setTimeout(updateCitations, 200)

    // Listen for editor changes to update new citations
    const handleUpdate = () => {
      setTimeout(updateCitations, 100)
    }
    editor.on('update', handleUpdate)

    return () => {
      clearTimeout(timer)
      editor.off('update', handleUpdate)
    }
  }, [editor, manager])

  return null
}

/**
 * Update ALL citation nodes with matching ID in the editor document.
 * This handles:
 * - Multiple citations with the same ID
 * - Undo/redo restoring nodes with empty attrs
 */
function updateNodeInEditor(
  editor: Editor,
  citationId: string,
  paper: { id: string; title: string; authors: string[]; year: number | null; journal?: string; doi?: string }
) {
  const { state, view } = editor
  const { doc } = state
  let tr = state.tr
  let updatedAny = false

  doc.descendants((node, pos) => {
    if (node.type.name === 'citation' && node.attrs.id === citationId) {
      // Check if the node needs updating - either missing data or data doesn't match
      const currentAuthors = node.attrs.authors || []
      const currentYear = node.attrs.year
      
      const needsUpdate = 
        currentAuthors.length === 0 || 
        !currentYear ||
        // Also update if the data doesn't match (in case paper was updated)
        JSON.stringify(currentAuthors) !== JSON.stringify(paper.authors) ||
        currentYear !== paper.year

      if (needsUpdate) {
        tr = tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          authors: paper.authors || [],
          title: paper.title || '',
          year: paper.year,
          journal: paper.journal || null,
          doi: paper.doi || null,
        })
        updatedAny = true
      }
    }
    // Always return true to continue traversing all nodes
    return true
  })

  if (updatedAny) {
    view.dispatch(tr)
  }
}
