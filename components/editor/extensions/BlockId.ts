/**
 * BlockId Extension - Adds stable unique IDs to block-level nodes
 * 
 * This enables AI tools to reference specific blocks by ID rather than
 * relying on fuzzy text matching. Block IDs are:
 * 
 * - Generated automatically for new blocks
 * - Preserved when editing content
 * - Stable across saves/loads (if stored)
 * - Used by AI tools for precise targeting
 * 
 * Supported block types:
 * - paragraph
 * - heading (h1-h6)
 * - blockquote
 * - codeBlock
 * - bulletList, orderedList, listItem
 * - table, tableRow, tableCell
 */

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Node as ProseMirrorNode } from '@tiptap/pm/model'

// Block types that should receive IDs
const BLOCK_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'bulletList',
  'orderedList',
  'listItem',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'taskList',
  'taskItem',
]

/**
 * Generate a short unique ID for a block.
 * Format: {type_prefix}_{random_suffix}
 */
function generateBlockId(nodeType: string): string {
  const prefix = nodeType.slice(0, 3).toLowerCase()
  const suffix = Math.random().toString(36).substring(2, 8)
  return `${prefix}_${suffix}`
}

/**
 * Check if a node type should have a block ID.
 */
function shouldHaveBlockId(nodeType: string): boolean {
  return BLOCK_TYPES.includes(nodeType)
}

export interface BlockIdOptions {
  /**
   * Types of nodes to add block IDs to.
   * Defaults to common block types.
   */
  types: string[]
  
  /**
   * Attribute name for the block ID.
   * Defaults to 'blockId'.
   */
  attributeName: string
}

export const BlockId = Extension.create<BlockIdOptions>({
  name: 'blockId',

  addOptions() {
    return {
      types: BLOCK_TYPES,
      attributeName: 'blockId',
    }
  },

  addGlobalAttributes() {
    return [
      {
        // Apply to all configured block types
        types: this.options.types,
        attributes: {
          [this.options.attributeName]: {
            default: null,
            parseHTML: (element) => element.getAttribute(`data-${this.options.attributeName}`),
            renderHTML: (attributes) => {
              if (!attributes[this.options.attributeName]) {
                return {}
              }
              return {
                [`data-${this.options.attributeName}`]: attributes[this.options.attributeName],
              }
            },
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    const attributeName = this.options.attributeName
    const types = this.options.types

    return [
      new Plugin({
        key: new PluginKey('blockId'),
        
        // Add IDs to nodes that don't have them on document changes
        appendTransaction: (transactions, oldState, newState) => {
          // Only process if document changed
          const docChanged = transactions.some(tr => tr.docChanged)
          if (!docChanged) return null

          // Performance optimization: Only auto-assign IDs during AI edits, paste, or doc load
          // Skip for regular typing to avoid unnecessary processing
          const isAIEdit = transactions.some(tr => tr.getMeta('aiEdit'))
          const isPaste = transactions.some(tr => tr.getMeta('paste'))
          const isUiEvent = transactions.some(tr => tr.getMeta('uiEvent'))
          const isInitialLoad = oldState.doc.content.size <= 2 // Empty doc
          
          // For regular typing, only process if new blocks were added (not just text changes)
          const hasNewBlocks = transactions.some(tr => {
            let addedBlock = false
            tr.steps.forEach(step => {
              // Check if step added new content that might be a block
              if (step.toJSON().stepType === 'replace') {
                addedBlock = true
              }
            })
            return addedBlock
          })
          
          if (!isAIEdit && !isPaste && !isUiEvent && !isInitialLoad && !hasNewBlocks) {
            return null
          }

          const tr = newState.tr
          let modified = false

          // Walk through all nodes
          newState.doc.descendants((node: ProseMirrorNode, pos: number) => {
            // Skip non-block types
            if (!types.includes(node.type.name)) return

            // Skip if already has an ID
            if (node.attrs[attributeName]) return

            // Generate and set new ID
            const newId = generateBlockId(node.type.name)
            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              [attributeName]: newId,
            })
            modified = true
          })

          return modified ? tr : null
        },
      }),
    ]
  },
})

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

export interface BlockInfo {
  id: string
  type: string
  text: string
  pos: number
  size: number
}

/**
 * Extract all blocks with their IDs from a TipTap editor.
 */
export function extractBlocks(editor: { state: { doc: ProseMirrorNode } }): BlockInfo[] {
  const blocks: BlockInfo[] = []
  
  editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
    if (!shouldHaveBlockId(node.type.name)) return
    
    const blockId = node.attrs.blockId
    if (!blockId) return
    
    blocks.push({
      id: blockId,
      type: node.type.name,
      text: node.textContent,
      pos,
      size: node.nodeSize,
    })
  })
  
  return blocks
}

/**
 * Find a block by its ID.
 */
export function findBlockById(
  editor: { state: { doc: ProseMirrorNode } },
  blockId: string
): { node: ProseMirrorNode; pos: number } | null {
  let result: { node: ProseMirrorNode; pos: number } | null = null
  
  editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
    if (result) return false // Already found
    
    if (node.attrs.blockId === blockId) {
      result = { node, pos }
      return false
    }
  })
  
  return result
}

/**
 * Find a block by type and approximate text content.
 * Useful as a fallback when block ID is not available.
 */
export function findBlockByTypeAndText(
  editor: { state: { doc: ProseMirrorNode } },
  type: string,
  searchText: string,
  minSimilarity: number = 0.6
): { node: ProseMirrorNode; pos: number; similarity: number } | null {
  let bestMatch: { node: ProseMirrorNode; pos: number; similarity: number } | null = null
  
  editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
    if (node.type.name !== type) return
    
    const text = node.textContent.toLowerCase()
    const search = searchText.toLowerCase()
    
    // Simple similarity: longest common substring ratio
    const similarity = calculateSimilarity(text, search)
    
    if (similarity >= minSimilarity) {
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = { node, pos, similarity }
      }
    }
  })
  
  return bestMatch
}

/**
 * Calculate text similarity (0-1).
 */
function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length === 0 || b.length === 0) return 0
  
  // Check if one contains the other
  if (a.includes(b)) return b.length / a.length
  if (b.includes(a)) return a.length / b.length
  
  // Jaccard similarity on words
  const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 2))
  const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 2))
  
  if (wordsA.size === 0 || wordsB.size === 0) return 0
  
  let intersection = 0
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++
  }
  
  const union = wordsA.size + wordsB.size - intersection
  return intersection / union
}

/**
 * Get a document summary with block IDs for AI context.
 * This is a compact representation that AI can use for targeting.
 */
export function getDocumentStructure(editor: { state: { doc: ProseMirrorNode } }): string {
  const blocks = extractBlocks(editor)
  
  const lines = blocks.map(block => {
    const textPreview = block.text.slice(0, 80).replace(/\n/g, ' ')
    const suffix = block.text.length > 80 ? '...' : ''
    return `[${block.id}] ${block.type}: "${textPreview}${suffix}"`
  })
  
  return lines.join('\n')
}
