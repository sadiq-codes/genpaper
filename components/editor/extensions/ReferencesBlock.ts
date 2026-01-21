import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { ReferencesNodeView } from './ReferencesNodeView'

/**
 * ReferencesBlock Extension
 * 
 * A read-only, auto-generated block that displays the formatted bibliography
 * at the end of the document. It:
 * 
 * - Uses the same citation style as inline citations (APA, IEEE, etc.)
 * - Updates in real-time when citations are added/removed
 * - Is automatically inserted when first citation is added
 * - Is automatically removed when last citation is removed
 * - Cannot be edited or deleted by the user directly
 */
export const ReferencesBlock = Node.create({
  name: 'referencesBlock',
  
  group: 'block',
  
  // Atom: not directly editable content
  atom: true,
  
  // Can be selected (for visual feedback)
  selectable: true,
  
  // Cannot be dragged around
  draggable: false,
  
  // Isolate from surrounding content
  isolating: true,

  // No attributes needed - content is computed from document citations
  addAttributes() {
    return {}
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="references-block"]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      {
        ...HTMLAttributes,
        'data-type': 'references-block',
        'class': 'references-block',
      },
      // Content will be rendered by NodeView
      0,
    ]
  },

  // Plain text rendering for clipboard
  renderText() {
    // This will be overridden by the NodeView for proper formatting
    return '\n\nReferences\n\n'
  },

  addNodeView() {
    return ReactNodeViewRenderer(ReferencesNodeView)
  },

  addProseMirrorPlugins() {
    const nodeName = this.name
    
    return [
      // Plugin to prevent user from deleting/modifying the references block
      new Plugin({
        key: new PluginKey('referencesBlockGuard'),
        filterTransaction(tr) {
          // Allow programmatic changes (marked with meta)
          if (tr.getMeta('programmaticReferencesChange')) {
            return true
          }
          
          // Allow non-doc-changing transactions
          if (!tr.docChanged) {
            return true
          }
          
          // Check if this transaction would delete or modify a references block
          let wouldModifyReferences = false
          
          tr.steps.forEach((step) => {
            // Check the step's slice for references block
            const stepMap = step.getMap()
            stepMap.forEach((oldStart, oldEnd) => {
              // Get the content being replaced in the old doc
              tr.docs[0]?.nodesBetween(oldStart, oldEnd, (node) => {
                if (node.type.name === nodeName) {
                  wouldModifyReferences = true
                  return false
                }
              })
            })
          })
          
          // Block the transaction if it would modify references
          if (wouldModifyReferences) {
            // Allow selection changes even if they touch references
            const isSelectionOnly = tr.selectionSet && tr.steps.length === 0
            
            if (!isSelectionOnly) {
              console.log('[ReferencesBlock] Blocked user modification of references block')
              return false
            }
          }
          
          return true
        },
      }),
    ]
  },

  addCommands() {
    return {
      // Command to insert references block at the end of the document
      insertReferencesBlock:
        () =>
        ({ editor, commands }) => {
          // Check if references block already exists
          let hasReferencesBlock = false
          editor.state.doc.descendants((node) => {
            if (node.type.name === this.name) {
              hasReferencesBlock = true
              return false
            }
          })
          
          if (hasReferencesBlock) {
            return false
          }
          
          // Insert at the end of the document
          const endPos = editor.state.doc.content.size
          return commands.insertContentAt(endPos, {
            type: this.name,
          }, {
            updateSelection: false,
          })
        },
      
      // Command to remove references block
      removeReferencesBlock:
        () =>
        ({ editor, tr, dispatch }) => {
          let found = false
          let pos = 0
          
          editor.state.doc.descendants((node, nodePos) => {
            if (node.type.name === this.name) {
              found = true
              pos = nodePos
              return false
            }
          })
          
          if (!found) {
            return false
          }
          
          if (dispatch) {
            // Mark as programmatic so the guard plugin allows it
            tr.setMeta('programmaticReferencesChange', true)
            tr.delete(pos, pos + 1)
            dispatch(tr)
          }
          
          return true
        },
    }
  },
})

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    referencesBlock: {
      insertReferencesBlock: () => ReturnType
      removeReferencesBlock: () => ReturnType
    }
  }
}
