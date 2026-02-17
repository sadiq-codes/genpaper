'use client'

import { useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/react'

/**
 * useReferencesManager
 * 
 * Manages the auto-insertion and removal of the ReferencesBlock node.
 * 
 * - Automatically inserts ReferencesBlock when first citation is added
 * - Automatically removes ReferencesBlock when last citation is removed
 * - Ensures only one ReferencesBlock exists
 * - Keeps ReferencesBlock at the end of the document
 */
export function useReferencesManager(editor: Editor | null) {
  // Track in-flight scheduling to avoid re-entrant loops.
  const isManaging = useRef(false)
  const isScheduled = useRef(false)
  
  useEffect(() => {
    if (!editor) return

    const scheduleManage = () => {
      if (isManaging.current || isScheduled.current) return
      isScheduled.current = true

      queueMicrotask(() => {
        isScheduled.current = false
        if (!editor || editor.isDestroyed || isManaging.current) return
        isManaging.current = true

        try {
          const doc = editor.state.doc
          let citationCount = 0
          const refs: Array<{ pos: number; size: number }> = []

          doc.descendants((node, pos) => {
            if (node.type.name === 'citation') {
              citationCount++
              return
            }
            if (node.type.name === 'referencesBlock') {
              refs.push({ pos, size: node.nodeSize })
            }
          })

          const referencesNode = editor.schema.nodes.referencesBlock?.create()
          const tr = editor.state.tr
          tr.setMeta('programmaticReferencesChange', true)

          // No citations: remove all references blocks.
          if (citationCount === 0 && refs.length > 0) {
            for (const ref of [...refs].reverse()) {
              tr.delete(ref.pos, ref.pos + ref.size)
            }
          }

          // Has citations: ensure exactly one references block.
          if (citationCount > 0) {
            if (refs.length === 0 && referencesNode) {
              tr.insert(tr.doc.content.size, referencesNode)
            } else if (refs.length > 1) {
              // Keep first, remove duplicates.
              for (const ref of refs.slice(1).reverse()) {
                tr.delete(ref.pos, ref.pos + ref.size)
              }
            }
          }

          if (tr.docChanged) {
            editor.view.dispatch(tr)
          }
        } finally {
          isManaging.current = false
        }
      })
    }

    // Run once on mount for existing content.
    scheduleManage()

    const handleTransaction = ({ transaction }: { transaction: { docChanged: boolean; getMeta: (key: string) => unknown } }) => {
      if (!transaction.docChanged) return
      if (transaction.getMeta('programmaticReferencesChange')) return
      scheduleManage()
    }

    editor.on('transaction', handleTransaction)

    return () => {
      editor.off('transaction', handleTransaction)
    }
  }, [editor])
}
