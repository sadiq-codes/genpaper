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
  // Track whether we're currently managing (to avoid loops)
  const isManaging = useRef(false)
  
  useEffect(() => {
    if (!editor) return
    
    // Function to count citations and manage references block
    const manageReferencesBlock = () => {
      if (isManaging.current) return
      isManaging.current = true
      
      try {
        const doc = editor.state.doc
        
        // Count citations in document
        let citationCount = 0
        doc.descendants((node) => {
          if (node.type.name === 'citation') {
            citationCount++
          }
        })
        
        // Check if references block exists and its position
        let hasReferencesBlock = false
        let referencesPos = -1
        let referencesNodeSize = 0
        
        doc.descendants((node, pos) => {
          if (node.type.name === 'referencesBlock') {
            hasReferencesBlock = true
            referencesPos = pos
            referencesNodeSize = node.nodeSize
            return false
          }
        })
        
        // Case 1: Has citations but no references block -> Insert at end
        if (citationCount > 0 && !hasReferencesBlock) {
          
          // Use setTimeout to avoid transaction conflicts
          setTimeout(() => {
            if (!editor.isDestroyed) {
              const { tr } = editor.state
              const endPos = editor.state.doc.content.size
              
              // Create the references block node
              const referencesNode = editor.schema.nodes.referencesBlock?.create()
              if (referencesNode) {
                tr.setMeta('programmaticReferencesChange', true)
                tr.insert(endPos, referencesNode)
                editor.view.dispatch(tr)
              }
            }
          }, 0)
        }
        
        // Case 2: No citations but has references block -> Remove it
        if (citationCount === 0 && hasReferencesBlock && referencesPos >= 0) {
          
          setTimeout(() => {
            if (!editor.isDestroyed) {
              const { tr } = editor.state
              tr.setMeta('programmaticReferencesChange', true)
              tr.delete(referencesPos, referencesPos + referencesNodeSize)
              editor.view.dispatch(tr)
            }
          }, 0)
        }
        
        // Case 3: References block exists but not at end -> Move to end
        if (hasReferencesBlock && referencesPos >= 0) {
          const docSize = doc.content.size
          const expectedPos = docSize - referencesNodeSize
          
          // If not at the end (with some tolerance for paragraph spacing)
          if (referencesPos < expectedPos - 2) {
            
            setTimeout(() => {
              if (!editor.isDestroyed) {
                // Re-check position as it may have changed
                let currentPos = -1
                let nodeSize = 0
                editor.state.doc.descendants((node, pos) => {
                  if (node.type.name === 'referencesBlock') {
                    currentPos = pos
                    nodeSize = node.nodeSize
                    return false
                  }
                })
                
                if (currentPos >= 0) {
                  const { tr } = editor.state
                  const node = editor.state.doc.nodeAt(currentPos)
                  
                  if (node) {
                    tr.setMeta('programmaticReferencesChange', true)
                    // Delete from current position
                    tr.delete(currentPos, currentPos + nodeSize)
                    // Insert at new end
                    const newEndPos = tr.doc.content.size
                    tr.insert(newEndPos, node)
                    editor.view.dispatch(tr)
                  }
                }
              }
            }, 0)
          }
        }
      } finally {
        // Reset flag after a short delay to allow the transaction to complete
        setTimeout(() => {
          isManaging.current = false
        }, 50)
      }
    }
    
    // Run on mount to handle initial state
    manageReferencesBlock()
    
    // Listen for document updates
    const handleUpdate = () => {
      manageReferencesBlock()
    }
    
    editor.on('update', handleUpdate)
    
    return () => {
      editor.off('update', handleUpdate)
    }
  }, [editor])
}
