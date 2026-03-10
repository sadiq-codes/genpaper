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

/**
 * Extract human-readable text from a ProseMirror node.
 * For tables, formats as a simple text table instead of concatenating all cells.
 */
function readableNodeText(node: { type: { name: string }; textContent: string; content: { forEach: (cb: (child: any) => void) => void } }): string {
  if (node.type.name !== 'table') {
    return node.textContent
  }

  const rows: string[][] = []
  node.content.forEach((row: any) => {
    if (row.type.name !== 'tableRow') return
    const cells: string[] = []
    row.content.forEach((cell: any) => {
      cells.push(cell.textContent.trim())
    })
    rows.push(cells)
  })

  if (rows.length === 0) return node.textContent

  const colWidths = rows[0].map((_, colIdx) =>
    Math.max(...rows.map(r => (r[colIdx] || '').length))
  )

  return rows.map(row =>
    row.map((cell, i) => cell.padEnd(colWidths[i] || 0)).join('  |  ')
  ).join('\n')
}

function looksLikeStandaloneParagraph(content: string): boolean {
  const text = content.trim()
  if (!text) return false

  if (/\n\s*\n/.test(text)) return true
  if (/^\s*[-*]\s+/m.test(text)) return true
  if (/^\s*\d+\.\s+/m.test(text)) return true
  if (/^\s*#{1,6}\s+/m.test(text)) return true
  if (/\|.+\|/.test(text)) return true

  const sentenceCount = (text.match(/[.!?](?=\s|$)/g) || []).length
  if (sentenceCount >= 2) return true

  return text.length >= 140
}

function getContainingTextblockEnd(editor: Editor, pos: number): number | null {
  const $pos = editor.state.doc.resolve(pos)

  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth)
    if (!node.isTextblock) continue
    const from = $pos.before(depth)
    return from + node.nodeSize
  }

  return null
}

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
      case 'insertHeading':
        return calculateInsertHeading(editor, args, editId, toolName)
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
      case 'editTable':
        return calculateEditTable(editor, args, editId, toolName)
      case 'addCitation':
        return calculateAddCitation(editor, args, editId, toolName)
      default:
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
        insertPos = looksLikeStandaloneParagraph(content)
          ? (getContainingTextblockEnd(editor, range.to) ?? range.to)
          : range.to
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
            description: looksLikeStandaloneParagraph(content)
              ? `Insert paragraph after "${afterPhrase.slice(0, 30)}..."`
              : `Insert after "${afterPhrase.slice(0, 30)}..."`,
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

  if (location === 'cursor') {
    insertPos = looksLikeStandaloneParagraph(content)
      ? (getContainingTextblockEnd(editor, editor.state.selection.from) ?? editor.state.selection.from)
      : editor.state.selection.from
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
        description: looksLikeStandaloneParagraph(content) ? 'Insert paragraph at cursor' : 'Insert at cursor',
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
  insertPos = looksLikeStandaloneParagraph(content)
    ? (getContainingTextblockEnd(editor, editor.state.selection.from) ?? editor.state.selection.from)
    : editor.state.selection.from
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
      description: looksLikeStandaloneParagraph(content) ? 'Insert paragraph at cursor' : 'Insert at cursor',
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
        oldContent: readableNodeText(block.node),
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
        oldContent: readableNodeText(block.node),
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
  const exactSectionMatch = args.exactSectionMatch === true

  if (!sectionName || !newContent) {
    return { success: false, error: 'Missing section name or new content' }
  }

  const findSectionBoundsExact = () => {
    const target = sectionName.trim().toLowerCase().replace(/\s+/g, ' ')
    const headings: Array<{ start: number; end: number; text: string }> = []
    editor.state.doc.forEach((node, offset) => {
      if (node.type.name === 'heading') {
        headings.push({
          start: offset,
          end: offset + node.nodeSize,
          text: (node.textContent || '').trim().toLowerCase().replace(/\s+/g, ' '),
        })
      }
    })
    const idx = headings.findIndex(h => h.text === target)
    if (idx === -1) return { found: false, contentStartPos: -1, contentEndPos: -1 }
    const current = headings[idx]
    const next = headings[idx + 1]
    return {
      found: true,
      contentStartPos: current.end,
      contentEndPos: next ? next.start : editor.state.doc.content.size,
    }
  }

  const sectionBounds = exactSectionMatch
    ? findSectionBoundsExact()
    : findSectionBounds(editor, sectionName)

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

function calculateInsertHeading(
  editor: Editor,
  args: Record<string, unknown>,
  editId: string,
  toolName: string
): CalculationResult {
  const text = (args.text as string | undefined)?.trim()
  const level = (args.level as number | undefined) ?? 2
  const afterBlockId = args.afterBlockId as string | undefined
  const afterPhrase = args.afterPhrase as string | undefined
  const location = args.location as string | undefined

  if (!text) return { success: false, error: 'No heading text provided' }
  if (!Number.isInteger(level) || level < 1 || level > 6) {
    return { success: false, error: 'Heading level must be between 1 and 6' }
  }

  let insertPos = editor.state.selection.from
  if (afterBlockId) {
    const block = findBlockById(editor, afterBlockId)
    if (block) insertPos = block.pos + block.node.nodeSize
  } else if (afterPhrase) {
    const match = findTextInStructure(editor, afterPhrase)
    if (match.found) {
      const range = matchToRange(match)
      if (range) insertPos = getContainingTextblockEnd(editor, range.to) ?? range.to
    }
  } else if (location === 'end') {
    insertPos = editor.state.doc.content.size
  } else if (location) {
    const afterMatch = location.match(/^after:(.+)$/i)
    const startMatch = location.match(/^start:(.+)$/i)
    if (afterMatch) {
      const bounds = findSectionBounds(editor, afterMatch[1])
      if (bounds.found) insertPos = bounds.contentEndPos
    } else if (startMatch) {
      const bounds = findSectionBounds(editor, startMatch[1])
      if (bounds.found) insertPos = bounds.contentStartPos
    }
  }

  const headingPrefix = '#'.repeat(level)
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
      newContent: `${headingPrefix} ${text}`,
      description: `Insert heading "${text.slice(0, 40)}"`,
    }
  }
}

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
  const afterPhrase = args.afterPhrase as string | undefined
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
  } else if (afterPhrase) {
    const match = findTextInStructure(editor, afterPhrase)
    if (match.found) {
      const range = matchToRange(match)
      if (range) {
        insertPos = getContainingTextblockEnd(editor, range.to) ?? range.to
      }
    }
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

// =============================================================================
// EDIT TABLE CALCULATOR
// =============================================================================

function calculateEditTable(
  editor: Editor,
  args: Record<string, unknown>,
  editId: string,
  toolName: string
): CalculationResult {
  const action = args.action as string
  const tableIndex = (args.tableIndex as number | undefined) ?? 0
  const section = args.section as string | undefined

  if (!action) return { success: false, error: 'Missing table action' }

  let searchFrom = 0
  let searchTo = editor.state.doc.content.size
  if (section) {
    const sectionBounds = findSectionBounds(editor, section)
    if (!sectionBounds.found) return { success: false, error: `Section not found: ${section}` }
    searchFrom = sectionBounds.contentStartPos
    searchTo = sectionBounds.contentEndPos
  }

  const tablePositions: number[] = []
  editor.state.doc.nodesBetween(searchFrom, searchTo, (node, pos) => {
    if (node.type.name === 'table') tablePositions.push(pos)
  })

  if (tablePositions.length === 0) {
    return { success: false, error: section ? `No tables in section "${section}"` : 'No tables in document' }
  }
  if (tableIndex >= tablePositions.length) {
    return { success: false, error: `tableIndex ${tableIndex} out of range (0-${tablePositions.length - 1})` }
  }

  const tablePos = tablePositions[tableIndex]
  const tableNode = editor.state.doc.nodeAt(tablePos)
  if (!tableNode || tableNode.type.name !== 'table') {
    return { success: false, error: 'Could not resolve target table' }
  }

  const oldContent = readableNodeText(tableNode)

  let description = 'Edit table'
  let newContent = oldContent

  if (action === 'appendRow') {
    const row = args.row as string[] | undefined
    if (Array.isArray(row)) {
      newContent = oldContent + '\n' + row.join('  |  ')
      description = 'Append row to table'
    }
  } else if (action === 'updateCell') {
    const value = args.value as string | undefined
    description = `Update table cell to "${(value || '').slice(0, 30)}"`
    // For updateCell, rebuild the text preview with the changed cell
    const rowIndex = args.rowIndex as number | undefined
    const colIndex = args.colIndex as number | undefined
    if (typeof rowIndex === 'number' && typeof colIndex === 'number' && typeof value === 'string') {
      const lines = oldContent.split('\n')
      const targetLine = rowIndex + 1 // +1 for header row
      if (targetLine >= 0 && targetLine < lines.length) {
        const cells = lines[targetLine].split('  |  ')
        if (colIndex >= 0 && colIndex < cells.length) {
          cells[colIndex] = value
          lines[targetLine] = cells.join('  |  ')
          newContent = lines.join('\n')
        }
      }
    }
  } else if (action === 'renameColumn') {
    const header = args.header as string | undefined
    const colIndex = args.colIndex as number | undefined
    description = `Rename column to "${(header || '').slice(0, 30)}"`
    if (typeof colIndex === 'number' && typeof header === 'string') {
      const lines = oldContent.split('\n')
      if (lines.length > 0) {
        const cells = lines[0].split('  |  ')
        if (colIndex >= 0 && colIndex < cells.length) {
          cells[colIndex] = header
          lines[0] = cells.join('  |  ')
          newContent = lines.join('\n')
        }
      }
    }
  } else if (action === 'removeColumn') {
    const colIndex = args.colIndex as number | undefined
    description = `Remove column ${colIndex ?? ''}`
    if (typeof colIndex === 'number') {
      newContent = oldContent.split('\n').map(line => {
        const cells = line.split('  |  ')
        if (colIndex >= 0 && colIndex < cells.length) {
          cells.splice(colIndex, 1)
        }
        return cells.join('  |  ')
      }).join('\n')
    }
  } else if (action === 'removeRow') {
    const rowIndex = args.rowIndex as number | undefined
    description = `Remove row ${rowIndex ?? ''}`
    if (typeof rowIndex === 'number') {
      const lines = oldContent.split('\n')
      const targetLine = rowIndex + 1 // +1 to skip header
      if (targetLine >= 1 && targetLine < lines.length) {
        lines.splice(targetLine, 1)
        newContent = lines.join('\n')
      }
    }
  }

  return {
    success: true,
    edit: {
      id: editId, type: 'replace', toolName, toolArgs: args,
      from: tablePos, to: tablePos + tableNode.nodeSize,
      oldContent,
      newContent,
      description,
    }
  }
}

// =============================================================================
// ADD CITATION CALCULATOR
// =============================================================================

function calculateAddCitation(
  editor: Editor,
  args: Record<string, unknown>,
  editId: string,
  toolName: string
): CalculationResult {
  const afterPhrase = args.afterPhrase as string | undefined
  const blockId = args.blockId as string | undefined
  const section = args.section as string | undefined
  const paperId = args.paperId as string | undefined

  if (!afterPhrase) return { success: false, error: 'Missing afterPhrase' }
  if (!paperId) return { success: false, error: 'Missing paperId' }

  const match = findTextInStructure(editor, afterPhrase, { blockId, section })
  if (!match.found) {
    return { success: false, error: `Could not find text: "${afterPhrase.slice(0, 50)}..."` }
  }

  const range = matchToRange(match)
  if (!range) return { success: false, error: 'Failed to calculate citation position' }

  return {
    success: true,
    edit: {
      id: editId, type: 'insert', toolName, toolArgs: args,
      from: range.to, to: range.to,
      oldContent: '',
      newContent: ` (${paperId.slice(0, 8)}...)`,
      description: `Add citation after "${afterPhrase.slice(0, 30)}..."`,
    }
  }
}
