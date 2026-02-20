/**
 * Edit Calculator - Computes edit positions without executing them
 * 
 * This is used to preview edits before applying them. It reuses the
 * targeting logic from tool-executor.ts but returns calculated positions
 * instead of performing mutations.
 */

import type { Editor } from '@tiptap/react'
import { findBlockById } from '../extensions/BlockId'
import { 
  findTextInStructure, 
  findSectionBounds, 
  matchToRange 
} from '../utils/structure-search'

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
      case 'mergeBlocks':
        return calculateMergeBlocks(editor, args, editId, toolName)
      case 'splitBlock':
        return calculateSplitBlock(editor, args, editId, toolName)
      case 'insertTable':
        return calculateInsertTable(editor, args, editId, toolName)
      default:
        // Non-visual tools (addCitation, highlightText, addComment, formatText,
        // moveBlock, searchAndReplace) don't need ghost preview
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

  // Priority 1: After specific phrase (structure-aware search)
  if (afterPhrase) {
    const match = findTextInStructure(editor, afterPhrase)
    if (match.found) {
      const range = matchToRange(match)
      if (range) {
        insertPos = range.to
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
          newContent: content,  // No prefix - TipTap handles paragraph spacing
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
        newContent: content,  // No prefix - TipTap handles paragraph spacing
        description: 'Insert at end of document',
      }
    }
  }

  // Handle section locations
  const afterMatch = location?.match(/^after:(.+)$/i)
  const startMatch = location?.match(/^start:(.+)$/i)

  if (afterMatch) {
    const sectionName = afterMatch[1]
    const sectionBounds = findSectionBounds(editor, sectionName)
    if (sectionBounds.found) {
      insertPos = sectionBounds.contentEndPos
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
          newContent: content,  // No prefix - TipTap handles paragraph spacing
          description: `Insert at end of ${sectionName}`,
        }
      }
    }
    return { success: false, error: `Section "${sectionName}" not found` }
  }

  if (startMatch) {
    const sectionName = startMatch[1]
    const sectionBounds = findSectionBounds(editor, sectionName)
    if (sectionBounds.found) {
      insertPos = sectionBounds.contentStartPos
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
          newContent: content,  // No suffix - TipTap handles paragraph spacing
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

  // Text-level replacement (structure-aware)
  if (searchPhrase) {
    const match = findTextInStructure(editor, searchPhrase, { blockId, section })
    if (!match.found) {
      return { success: false, error: `Could not find text: "${searchPhrase.slice(0, 50)}..."` }
    }

    const range = matchToRange(match)
    if (!range) {
      return { success: false, error: 'Failed to calculate edit range' }
    }

    const oldContent = match.node?.textBetween(match.startOffset, match.endOffset) || ''

    return {
      success: true,
      edit: {
        id: editId,
        type: 'replace',
        toolName,
        toolArgs: args,
        from: range.from,
        to: range.to,
        oldContent,
        newContent,
        description: `Replace "${oldContent.slice(0, 30)}..."`,
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
    const sectionBounds = findSectionBounds(editor, section)
    if (!sectionBounds.found) {
      return { success: false, error: `Section "${section}" not found` }
    }

    // Get old content from the section
    let oldContent = ''
    editor.state.doc.nodesBetween(sectionBounds.contentStartPos, sectionBounds.contentEndPos, (node) => {
      if (node.isTextblock) {
        oldContent += node.textContent + '\n\n'
      }
    })
    oldContent = oldContent.trim()

    return {
      success: true,
      edit: {
        id: editId,
        type: 'replace',
        toolName,
        toolArgs: args,
        from: sectionBounds.contentStartPos,
        to: sectionBounds.contentEndPos,
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

  // Text-level deletion (structure-aware)
  if (searchPhrase) {
    const match = findTextInStructure(editor, searchPhrase, { blockId, section })
    if (!match.found) {
      return { success: false, error: `Could not find text: "${searchPhrase.slice(0, 50)}..."` }
    }

    const range = matchToRange(match)
    if (!range) {
      return { success: false, error: 'Failed to calculate delete range' }
    }

    const oldContent = match.node?.textBetween(match.startOffset, match.endOffset) || ''

    return {
      success: true,
      edit: {
        id: editId,
        type: 'delete',
        toolName,
        toolArgs: args,
        from: range.from,
        to: range.to,
        oldContent,
        newContent: '',
        description: reason || `Delete "${oldContent.slice(0, 30)}..."`,
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
    const sectionBounds = findSectionBounds(editor, section)
    if (!sectionBounds.found) {
      return { success: false, error: `Section "${section}" not found` }
    }

    // Get old content from the section
    let oldContent = ''
    editor.state.doc.nodesBetween(sectionBounds.contentStartPos, sectionBounds.contentEndPos, (node) => {
      if (node.isTextblock) {
        oldContent += node.textContent + '\n\n'
      }
    })
    oldContent = oldContent.trim()

    return {
      success: true,
      edit: {
        id: editId,
        type: 'delete',
        toolName,
        toolArgs: args,
        from: sectionBounds.contentStartPos,
        to: sectionBounds.contentEndPos,
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

  const sectionBounds = findSectionBounds(editor, sectionName)

  if (!sectionBounds.found) {
    return { success: false, error: `Section "${sectionName}" not found` }
  }

  // Get old content from the section
  let oldContent = ''
  editor.state.doc.nodesBetween(sectionBounds.contentStartPos, sectionBounds.contentEndPos, (node) => {
    if (node.isTextblock) {
      oldContent += node.textContent + '\n\n'
    }
  })
  oldContent = oldContent.trim()

  return {
    success: true,
    edit: {
      id: editId,
      type: 'replace',
      toolName,
      toolArgs: args,
      from: sectionBounds.contentStartPos,
      to: sectionBounds.contentEndPos,
      oldContent,
      newContent: '\n\n' + newContent + '\n\n',
      description: reason || `Rewrite ${sectionName} section`,
    }
  }
}

// =============================================================================
// MERGE BLOCKS CALCULATOR
// =============================================================================

function calculateMergeBlocks(
  editor: Editor,
  args: Record<string, unknown>,
  editId: string,
  toolName: string
): CalculationResult {
  const firstBlockId = args.firstBlockId as string | undefined
  const secondBlockId = args.secondBlockId as string | undefined
  const searchPhrase = args.searchPhrase as string | undefined
  const section = args.section as string | undefined

  if (firstBlockId && secondBlockId) {
    const firstBlock = findBlockById(editor, firstBlockId)
    const secondBlock = findBlockById(editor, secondBlockId)
    if (!firstBlock) return { success: false, error: `First block not found: ${firstBlockId}` }
    if (!secondBlock) return { success: false, error: `Second block not found: ${secondBlockId}` }

    const from = firstBlock.pos
    const to = secondBlock.pos + secondBlock.node.nodeSize
    const oldContent = firstBlock.node.textContent + '\n\n' + secondBlock.node.textContent
    const newContent = firstBlock.node.textContent + ' ' + secondBlock.node.textContent

    return {
      success: true,
      edit: { id: editId, type: 'replace', toolName, toolArgs: args, from, to, oldContent, newContent, description: 'Merge two paragraphs' }
    }
  }

  if (searchPhrase) {
    const match = findTextInStructure(editor, searchPhrase, { section })
    if (!match.found) return { success: false, error: `Text not found: "${searchPhrase.slice(0, 50)}..."` }

    const $pos = editor.state.doc.resolve(match.pos + match.startOffset)
    const parentStart = $pos.before($pos.depth)
    const parentNode = $pos.node($pos.depth)
    const parentEnd = parentStart + parentNode.nodeSize
    const nextNode = editor.state.doc.nodeAt(parentEnd)
    if (!nextNode) return { success: false, error: 'No adjacent block to merge with' }

    const from = parentStart
    const to = parentEnd + nextNode.nodeSize
    const oldContent = parentNode.textContent + '\n\n' + nextNode.textContent
    const newContent = parentNode.textContent + ' ' + nextNode.textContent

    return {
      success: true,
      edit: { id: editId, type: 'replace', toolName, toolArgs: args, from, to, oldContent, newContent, description: 'Merge two paragraphs' }
    }
  }

  return { success: false, error: 'Provide firstBlockId+secondBlockId or searchPhrase' }
}

// =============================================================================
// SPLIT BLOCK CALCULATOR
// =============================================================================

function calculateSplitBlock(
  editor: Editor,
  args: Record<string, unknown>,
  editId: string,
  toolName: string
): CalculationResult {
  const splitAfterPhrase = args.splitAfterPhrase as string
  const blockId = args.blockId as string | undefined
  const section = args.section as string | undefined

  if (!splitAfterPhrase) return { success: false, error: 'Missing splitAfterPhrase' }

  const match = findTextInStructure(editor, splitAfterPhrase, { blockId, section })
  if (!match.found) return { success: false, error: `Text not found: "${splitAfterPhrase.slice(0, 50)}..."` }

  const range = matchToRange(match)
  if (!range) return { success: false, error: 'Failed to calculate split position' }

  // Get the parent block content
  const $pos = editor.state.doc.resolve(range.to)
  const parentStart = $pos.before($pos.depth)
  const parentNode = $pos.node($pos.depth)
  const parentEnd = parentStart + parentNode.nodeSize
  const fullText = parentNode.textContent
  const splitIndex = fullText.indexOf(splitAfterPhrase) + splitAfterPhrase.length
  const firstPart = fullText.slice(0, splitIndex).trim()
  const secondPart = fullText.slice(splitIndex).trim()

  return {
    success: true,
    edit: {
      id: editId, type: 'replace', toolName, toolArgs: args,
      from: parentStart, to: parentEnd,
      oldContent: fullText,
      newContent: firstPart + '\n\n' + secondPart,
      description: 'Split paragraph into two',
    }
  }
}

// =============================================================================
// INSERT TABLE CALCULATOR
// =============================================================================

function calculateInsertTable(
  editor: Editor,
  args: Record<string, unknown>,
  editId: string,
  toolName: string
): CalculationResult {
  const headers = args.headers as string[]
  const rows = args.rows as string[][]
  const caption = args.caption as string | undefined
  const afterBlockId = args.afterBlockId as string | undefined
  const location = args.location as string | undefined

  if (!headers || headers.length === 0) return { success: false, error: 'No headers provided' }

  // Build a text preview of the table
  const headerLine = '| ' + headers.join(' | ') + ' |'
  const separatorLine = '| ' + headers.map(() => '---').join(' | ') + ' |'
  const rowLines = (rows || []).map(row => '| ' + headers.map((_, i) => row[i] || '').join(' | ') + ' |')
  const tablePreview = [caption || '', headerLine, separatorLine, ...rowLines].filter(Boolean).join('\n')

  let insertPos = editor.state.selection.from

  if (afterBlockId) {
    const block = findBlockById(editor, afterBlockId)
    if (block) insertPos = block.pos + block.node.nodeSize
  } else if (location === 'end') {
    insertPos = editor.state.doc.content.size
  } else if (location) {
    const afterMatch = location.match(/^after:(.+)$/i)
    if (afterMatch) {
      const bounds = findSectionBounds(editor, afterMatch[1])
      if (bounds.found) insertPos = bounds.contentEndPos
    }
  }

  return {
    success: true,
    edit: {
      id: editId, type: 'insert', toolName, toolArgs: args,
      from: insertPos, to: insertPos,
      oldContent: '',
      newContent: tablePreview,
      description: caption || 'Insert table',
    }
  }
}
