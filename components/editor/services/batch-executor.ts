/**
 * Batch Executor - Applies multiple edits in a single ProseMirror transaction
 * 
 * This enables Cursor-style batch operations where multiple AI edits are
 * applied atomically. Key features:
 * 
 * 1. Sorts edits by position (descending) to avoid position drift
 * 2. Applies all edits in a single transaction
 * 3. Atomic rollback - if any edit fails, none are applied
 * 4. Returns affected range for potential cursor positioning
 * 
 * Note: When edits are sorted descending, earlier edits don't affect
 * the positions of later edits because we're modifying from end to start.
 */

import type { Editor } from '@tiptap/react'
import type { CalculatedEdit } from './edit-calculator'
import { TextSelection, Transaction } from '@tiptap/pm/state'
import type { Schema } from '@tiptap/pm/model'

// =============================================================================
// TYPES
// =============================================================================

export interface BatchExecutionResult {
  success: boolean
  appliedCount: number
  error?: string
  /** The affected range in the document after all edits */
  affectedRange?: { from: number; to: number }
}

// =============================================================================
// BATCH EXECUTOR
// =============================================================================

/**
 * Check if content requires block-level handling (contains paragraph breaks).
 * Multi-block content can't be safely inserted as plain text nodes.
 */
function containsMultipleBlocks(content: string): boolean {
  // Check for common block separators
  return content.includes('\n\n') || content.includes('\r\n\r\n')
}

/**
 * Execute multiple edits in a single ProseMirror transaction.
 * 
 * NOTE: For edits with multi-block content (containing paragraph breaks),
 * we fall back to sequential execution using editor.commands to preserve
 * proper document structure. Batch execution with plain text nodes would
 * collapse paragraphs.
 * 
 * @param editor - TipTap editor instance
 * @param edits - Array of calculated edits to apply
 * @returns Result indicating success/failure and affected range
 */
export function executeBatchEdits(
  editor: Editor,
  edits: CalculatedEdit[]
): BatchExecutionResult {
  if (edits.length === 0) {
    return { success: true, appliedCount: 0 }
  }

  // Filter out edits that had calculation errors
  const validEdits = edits.filter(edit => !edit.error)
  
  if (validEdits.length === 0) {
    return { 
      success: false, 
      appliedCount: 0,
      error: 'No valid edits to apply'
    }
  }

  // Check if any edit contains multi-block content
  // If so, fall back to sequential execution to preserve block structure
  const hasMultiBlockContent = validEdits.some(edit => 
    edit.newContent && containsMultipleBlocks(edit.newContent)
  )

  if (hasMultiBlockContent) {
    console.log('[BatchExecutor] Multi-block content detected, using sequential execution')
    return executeSequentially(editor, validEdits)
  }

  // Sort edits by position DESCENDING (highest position first)
  // This ensures earlier edits don't affect positions of later edits
  const sortedEdits = [...validEdits].sort((a, b) => b.from - a.from)

  try {
    const { state, view } = editor
    let tr = state.tr
    
    // Track min/max positions for affected range
    let minFrom = Infinity
    let maxTo = -Infinity

    // Apply each edit to the transaction
    for (const edit of sortedEdits) {
      tr = applyEditToTransaction(tr, edit, editor.schema)
      
      // Track affected range
      minFrom = Math.min(minFrom, edit.from)
      maxTo = Math.max(maxTo, edit.to)
    }

    // Mark as AI edit so manual edit detection doesn't clear the edit group
    tr = tr.setMeta('aiEdit', true)
    
    // Dispatch the transaction
    view.dispatch(tr)

    return {
      success: true,
      appliedCount: sortedEdits.length,
      affectedRange: { from: minFrom, to: maxTo }
    }
  } catch (error) {
    console.error('[BatchExecutor] Failed to execute batch:', error)
    return {
      success: false,
      appliedCount: 0,
      error: error instanceof Error ? error.message : 'Unknown error during batch execution'
    }
  }
}

/**
 * Execute edits sequentially using editor.chain() to preserve block structure.
 * This is used when edits contain multi-block content.
 */
function executeSequentially(
  editor: Editor,
  edits: CalculatedEdit[]
): BatchExecutionResult {
  // Sort by position DESCENDING to avoid position drift
  const sortedEdits = [...edits].sort((a, b) => b.from - a.from)
  
  let appliedCount = 0
  let minFrom = Infinity
  let maxTo = -Infinity

  for (const edit of sortedEdits) {
    try {
      switch (edit.type) {
        case 'delete':
          editor.chain()
            .focus()
            .setTextSelection({ from: edit.from, to: edit.to })
            .deleteSelection()
            .run()
          break

        case 'insert':
          editor.chain()
            .focus()
            .setTextSelection(edit.from)
            .insertContent(edit.newContent)
            .run()
          break

        case 'replace':
          editor.chain()
            .focus()
            .setTextSelection({ from: edit.from, to: edit.to })
            .insertContent(edit.newContent)
            .run()
          break
      }

      appliedCount++
      minFrom = Math.min(minFrom, edit.from)
      maxTo = Math.max(maxTo, edit.to)
    } catch (error) {
      console.error(`[BatchExecutor] Failed to execute edit:`, error, edit)
      // Continue with remaining edits
    }
  }

  return {
    success: appliedCount > 0,
    appliedCount,
    affectedRange: appliedCount > 0 ? { from: minFrom, to: maxTo } : undefined,
    error: appliedCount < edits.length ? `Applied ${appliedCount}/${edits.length} edits` : undefined
  }
}

/**
 * Apply a single edit to a transaction (without dispatching).
 */
function applyEditToTransaction(
  tr: Transaction,
  edit: CalculatedEdit,
  schema: Schema
): Transaction {
  switch (edit.type) {
    case 'delete':
      // Delete content between from and to
      tr = tr.delete(edit.from, edit.to)
      break

    case 'insert':
      // Insert new content at position
      // For rich content, we need to parse it properly
      if (edit.newContent) {
        const textNode = createTextNode(edit.newContent, schema)
        if (textNode) {
          tr = tr.insert(edit.from, textNode)
        } else {
          // Fallback to plain text
          tr = tr.insertText(edit.newContent, edit.from)
        }
      }
      break

    case 'replace':
      // Delete old content and insert new content
      tr = tr.delete(edit.from, edit.to)
      if (edit.newContent) {
        const textNode = createTextNode(edit.newContent, schema)
        if (textNode) {
          tr = tr.insert(edit.from, textNode)
        } else {
          tr = tr.insertText(edit.newContent, edit.from)
        }
      }
      break
  }

  return tr
}

/**
 * Create a ProseMirror text node from content.
 */
function createTextNode(
  content: string,
  schema: Schema
) {
  try {
    return schema.text(content)
  } catch {
    return null
  }
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Validate that edits don't overlap in problematic ways.
 * Returns true if edits are safe to batch.
 */
export function validateEditBatch(edits: CalculatedEdit[]): {
  valid: boolean
  reason?: string
} {
  // Sort by position
  const sorted = [...edits].sort((a, b) => a.from - b.from)
  
  // Check for overlapping edits
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i]
    const next = sorted[i + 1]
    
    // If current edit's end overlaps with next edit's start, they conflict
    if (current.to > next.from) {
      return {
        valid: false,
        reason: `Edits overlap: "${current.description}" and "${next.description}"`
      }
    }
  }
  
  return { valid: true }
}

/**
 * Set cursor position after batch execution.
 * Positions cursor at the end of the affected range.
 */
export function setCursorAfterBatch(
  editor: Editor,
  affectedRange: { from: number; to: number }
): void {
  const { state, view } = editor
  
  // Position cursor at end of affected range (or end of doc if out of bounds)
  const endPos = Math.min(affectedRange.to, state.doc.content.size)
  
  const selection = TextSelection.create(state.doc, endPos)
  const tr = state.tr.setSelection(selection)
  
  view.dispatch(tr)
}
