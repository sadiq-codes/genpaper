/**
 * Edit Calculator - Computes edit positions without executing them
 * 
 * This is used to preview edits before applying them. It reuses the
 * targeting logic from tool-executor.ts but returns calculated positions
 * instead of performing mutations.
 */

import type { Editor } from '@tiptap/react'
import { findBlockById } from '../extensions/BlockId'
import { fuzzyFindPhrase, findSection } from '@/lib/utils/fuzzy-match'
import { textIndexToDocPosition } from '../utils/position-utils'

// =============================================================================
// TYPES
// =============================================================================

export type EditType = 'insert' | 'replace' | 'delete'

export interface CalculatedEdit {
  id: string
  type: EditType
  toolName: string
  toolArgs: Record<string, unknown>
  // Position info
  from: number
  to: number
  // Content info
  oldContent: string      // Text being replaced/deleted (empty for insert)
  newContent: string      // Text being inserted/used as replacement (empty for delete)
  // Metadata
  description: string     // Human-readable description
  error?: string          // If we couldn't calculate the edit
}

export interface CalculationResult {
  success: boolean
  edit?: CalculatedEdit
  error?: string
}

// =============================================================================
// MAIN CALCULATOR
// =============================================================================

/**
 * Calculate the positions and content for an edit without executing it.
 */
export function calculateEdit(
  editor: Editor,
  toolName: string,
  args: Record<string, unknown>,
  editId: string
): CalculationResult {
  try {
    switch (toolName) {
      case 'insertContent':
        return calculateInsert(editor, args, editId, toolName)
      case 'replaceBlock':
      case 'replaceInSection':
        return calculateReplace(editor, args, editId, toolName)
      case 'deleteContent':
        return calculateDelete(editor, args, editId, toolName)
      case 'rewriteSection':
        return calculateRewriteSection(editor, args, editId, toolName)
      default:
        // Non-visual tools (addCitation, highlightText, addComment) don't need ghost preview
        return { 
          success: false, 
          error: `Tool "${toolName}" does not support ghost preview` 
        }
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error calculating edit'
    }
  }
}

// =============================================================================
// CALCULATION HELPERS
// =============================================================================

/**
 * Calculate an insert operation.
 */
function calculateInsert(
  editor: Editor,
  args: Record<string, unknown>,
  editId: string,
  toolName: string
): CalculationResult {
  const content = args.content as string
  // Use nullish coalescing to properly handle empty string vs undefined
  const afterBlockId = (args.afterBlockId ?? args.blockId) as string | undefined
  const afterPhrase = args.afterPhrase as string | undefined
  const location = args.location as string | undefined

  if (!content) {
    return { success: false, error: 'No content provided' }
  }

  let insertPos: number

  // Priority 1: After specific phrase
  if (afterPhrase) {
    const docText = editor.getText()
    const match = fuzzyFindPhrase(docText, afterPhrase)
    if (match.found) {
      insertPos = findTipTapPosition(editor, match.endIndex)
      return {
        success: true,
        edit: {
          id: editId,
          type: 'insert',
          toolName,
          toolArgs: args,
          from: insertPos,
          to: insertPos,
          oldContent: '',
          newContent: content,
          description: `Insert after "${afterPhrase.slice(0, 30)}..."`,
        }
      }
    }
  }

  // Priority 2: After specific block
  if (afterBlockId) {
    const block = findBlockById(editor, afterBlockId)
    if (block) {
      insertPos = block.pos + block.node.nodeSize
      return {
        success: true,
        edit: {
          id: editId,
          type: 'insert',
          toolName,
          toolArgs: args,
          from: insertPos,
          to: insertPos,
          oldContent: '',
          newContent: '\n\n' + content,
          description: `Insert after block`,
        }
      }
    }
  }

  // Priority 3: Location string
  if (location === 'end') {
    insertPos = editor.state.doc.content.size
    return {
      success: true,
      edit: {
        id: editId,
        type: 'insert',
        toolName,
        toolArgs: args,
        from: insertPos,
        to: insertPos,
        oldContent: '',
        newContent: '\n\n' + content,
        description: 'Insert at end of document',
      }
    }
  }

  // Handle section locations
  const afterMatch = location?.match(/^after:(.+)$/i)
  const startMatch = location?.match(/^start:(.+)$/i)

  if (afterMatch) {
    const sectionName = afterMatch[1]
    const docText = editor.getText()
    const section = findSection(docText, sectionName)
    if (section.found) {
      insertPos = findTipTapPosition(editor, section.contentEnd)
      return {
        success: true,
        edit: {
          id: editId,
          type: 'insert',
          toolName,
          toolArgs: args,
          from: insertPos,
          to: insertPos,
          oldContent: '',
          newContent: '\n\n' + content,
          description: `Insert at end of ${sectionName}`,
        }
      }
    }
    return { success: false, error: `Section "${sectionName}" not found` }
  }

  if (startMatch) {
    const sectionName = startMatch[1]
    const docText = editor.getText()
    const section = findSection(docText, sectionName)
    if (section.found) {
      insertPos = findTipTapPosition(editor, section.contentStart)
      return {
        success: true,
        edit: {
          id: editId,
          type: 'insert',
          toolName,
          toolArgs: args,
          from: insertPos,
          to: insertPos,
          oldContent: '',
          newContent: content + '\n\n',
          description: `Insert at start of ${sectionName}`,
        }
      }
    }
    return { success: false, error: `Section "${sectionName}" not found` }
  }

  // Default: cursor position
  insertPos = editor.state.selection.from
  return {
    success: true,
    edit: {
      id: editId,
      type: 'insert',
      toolName,
      toolArgs: args,
      from: insertPos,
      to: insertPos,
      oldContent: '',
      newContent: content,
      description: 'Insert at cursor',
    }
  }
}

/**
 * Calculate a replace operation.
 */
function calculateReplace(
  editor: Editor,
  args: Record<string, unknown>,
  editId: string,
  toolName: string
): CalculationResult {
  const blockId = args.blockId as string | undefined
  const section = args.section as string | undefined
  const searchPhrase = args.searchPhrase as string | undefined
  const newContent = args.newContent as string

  if (!newContent) {
    return { success: false, error: 'No new content provided' }
  }

  const docText = editor.getText()

  // Text-level replacement
  if (searchPhrase) {
    const match = fuzzyFindPhrase(docText, searchPhrase)
    if (!match.found) {
      return { success: false, error: `Could not find text: "${searchPhrase.slice(0, 50)}..."` }
    }

    const from = findTipTapPosition(editor, match.startIndex)
    const to = findTipTapPosition(editor, match.endIndex)

    return {
      success: true,
      edit: {
        id: editId,
        type: 'replace',
        toolName,
        toolArgs: args,
        from,
        to,
        oldContent: match.matchedText,
        newContent,
        description: `Replace "${match.matchedText.slice(0, 30)}..."`,
      }
    }
  }

  // Block-level replacement
  if (blockId) {
    const block = findBlockById(editor, blockId)
    if (!block) {
      return { success: false, error: `Block not found: ${blockId}` }
    }

    return {
      success: true,
      edit: {
        id: editId,
        type: 'replace',
        toolName,
        toolArgs: args,
        from: block.pos,
        to: block.pos + block.node.nodeSize,
        oldContent: block.node.textContent,
        newContent,
        description: 'Replace entire block',
      }
    }
  }

  // Section-level (for replaceInSection without searchPhrase - shouldn't happen but handle it)
  if (section) {
    const sec = findSection(docText, section)
    if (!sec.found) {
      return { success: false, error: `Section "${section}" not found` }
    }

    const from = findTipTapPosition(editor, sec.contentStart)
    const to = findTipTapPosition(editor, sec.contentEnd)
    const oldContent = docText.slice(sec.contentStart, sec.contentEnd)

    return {
      success: true,
      edit: {
        id: editId,
        type: 'replace',
        toolName,
        toolArgs: args,
        from,
        to,
        oldContent,
        newContent,
        description: `Replace content in ${section}`,
      }
    }
  }

  return { success: false, error: 'No target specified for replacement' }
}

/**
 * Calculate a delete operation.
 */
function calculateDelete(
  editor: Editor,
  args: Record<string, unknown>,
  editId: string,
  toolName: string
): CalculationResult {
  const blockId = args.blockId as string | undefined
  const section = args.section as string | undefined
  const searchPhrase = args.searchPhrase as string | undefined
  const reason = args.reason as string | undefined

  const docText = editor.getText()

  // Text-level deletion
  if (searchPhrase) {
    const match = fuzzyFindPhrase(docText, searchPhrase)
    if (!match.found) {
      return { success: false, error: `Could not find text: "${searchPhrase.slice(0, 50)}..."` }
    }

    const from = findTipTapPosition(editor, match.startIndex)
    const to = findTipTapPosition(editor, match.endIndex)

    return {
      success: true,
      edit: {
        id: editId,
        type: 'delete',
        toolName,
        toolArgs: args,
        from,
        to,
        oldContent: match.matchedText,
        newContent: '',
        description: reason || `Delete "${match.matchedText.slice(0, 30)}..."`,
      }
    }
  }

  // Block-level deletion
  if (blockId) {
    const block = findBlockById(editor, blockId)
    if (!block) {
      return { success: false, error: `Block not found: ${blockId}` }
    }

    return {
      success: true,
      edit: {
        id: editId,
        type: 'delete',
        toolName,
        toolArgs: args,
        from: block.pos,
        to: block.pos + block.node.nodeSize,
        oldContent: block.node.textContent,
        newContent: '',
        description: reason || 'Delete entire block',
      }
    }
  }

  // Section-level
  if (section) {
    const sec = findSection(docText, section)
    if (!sec.found) {
      return { success: false, error: `Section "${section}" not found` }
    }

    const from = findTipTapPosition(editor, sec.contentStart)
    const to = findTipTapPosition(editor, sec.contentEnd)
    const oldContent = docText.slice(sec.contentStart, sec.contentEnd)

    return {
      success: true,
      edit: {
        id: editId,
        type: 'delete',
        toolName,
        toolArgs: args,
        from,
        to,
        oldContent,
        newContent: '',
        description: reason || `Delete content in ${section}`,
      }
    }
  }

  return { success: false, error: 'No target specified for deletion' }
}

/**
 * Calculate a section rewrite operation.
 */
function calculateRewriteSection(
  editor: Editor,
  args: Record<string, unknown>,
  editId: string,
  toolName: string
): CalculationResult {
  const sectionName = args.section as string
  const newContent = args.newContent as string
  const reason = args.reason as string | undefined

  if (!sectionName || !newContent) {
    return { success: false, error: 'Missing section name or new content' }
  }

  const docText = editor.getText()
  const section = findSection(docText, sectionName)

  if (!section.found) {
    return { success: false, error: `Section "${sectionName}" not found` }
  }

  const from = findTipTapPosition(editor, section.contentStart)
  const to = findTipTapPosition(editor, section.contentEnd)
  const oldContent = docText.slice(section.contentStart, section.contentEnd)

  return {
    success: true,
    edit: {
      id: editId,
      type: 'replace',
      toolName,
      toolArgs: args,
      from,
      to,
      oldContent,
      newContent: '\n\n' + newContent + '\n\n',
      description: reason || `Rewrite ${sectionName} section`,
    }
  }
}

// =============================================================================
// POSITION HELPER
// =============================================================================

// Use shared utility to avoid duplication
const findTipTapPosition = textIndexToDocPosition
