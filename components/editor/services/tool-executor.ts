/**
 * Tool Executor - Executes AI tool calls on TipTap editor
 * 
 * Targeting strategy:
 * 1. Block ID (preferred) - Uses stable IDs assigned by BlockId extension
 * 2. Section + Text (fallback) - Fuzzy matching when IDs not available
 * 
 * This provides reliable edits while maintaining backward compatibility.
 */

import type { Editor } from '@tiptap/react'
import { findBlockById } from '../extensions/BlockId'
import { fuzzyFindPhrase, findSection, findInSection } from '@/lib/utils/fuzzy-match'
import { toast } from 'sonner'

// =============================================================================
// TYPES
// =============================================================================

export interface ToolExecutionResult {
  success: boolean
  message: string
  affectedRange?: { from: number; to: number }
  blockId?: string
}

interface BlockTarget {
  found: boolean
  pos: number
  endPos: number
  blockId?: string
  method: 'blockId' | 'text' | 'section'
}

// =============================================================================
// BLOCK TARGETING
// =============================================================================

/**
 * Find a block by ID or fall back to text search.
 */
function findTargetBlock(
  editor: Editor,
  args: {
    blockId?: string
    section?: string
    searchPhrase?: string
  }
): BlockTarget {
  // Strategy 1: Use block ID if provided
  if (args.blockId) {
    const block = findBlockById(editor, args.blockId)
    if (block) {
      return {
        found: true,
        pos: block.pos,
        endPos: block.pos + block.node.nodeSize,
        blockId: args.blockId,
        method: 'blockId',
      }
    }
    // Block ID not found - log and try fallback
    console.warn(`[ToolExecutor] Block ID not found: ${args.blockId}, trying fallback`)
  }

  // Strategy 2: Fall back to text search
  if (args.searchPhrase) {
    const docText = editor.getText()
    const match = args.section 
      ? findInSection(docText, args.section, args.searchPhrase)
      : fuzzyFindPhrase(docText, args.searchPhrase)

    if (match.found) {
      const from = findTipTapPosition(editor, match.startIndex)
      const to = findTipTapPosition(editor, match.endIndex)
      return {
        found: true,
        pos: from,
        endPos: to,
        method: 'text',
      }
    }
  }

  // Strategy 3: Section-level targeting
  if (args.section) {
    const docText = editor.getText()
    const section = findSection(docText, args.section)
    if (section.found) {
      const from = findTipTapPosition(editor, section.contentStart)
      const to = findTipTapPosition(editor, section.contentEnd)
      return {
        found: true,
        pos: from,
        endPos: to,
        method: 'section',
      }
    }
  }

  return { found: false, pos: -1, endPos: -1, method: 'text' }
}

/**
 * Generate a helpful error message when a block can't be found.
 */
function getNotFoundMessage(args: {
  blockId?: string
  section?: string
  searchPhrase?: string
}): string {
  if (args.blockId) {
    return `Block not found (ID: ${args.blockId}). The document may have changed.`
  }
  if (args.searchPhrase) {
    const preview = args.searchPhrase.slice(0, 50)
    return `Could not find text: "${preview}..."${args.section ? ` in ${args.section}` : ''}`
  }
  if (args.section) {
    return `Section "${args.section}" not found in document.`
  }
  return 'No target specified. Provide a blockId, searchPhrase, or section.'
}

// =============================================================================
// MAIN EXECUTOR
// =============================================================================

/**
 * Execute a document tool on the TipTap editor.
 */
export function executeDocumentTool(
  editor: Editor,
  toolName: string,
  args: Record<string, unknown>
): ToolExecutionResult {
  console.log(`[ToolExecutor] Executing ${toolName}`)
  console.log(`[ToolExecutor] Args:`, JSON.stringify(args, null, 2))
  
  try {
    switch (toolName) {
      case 'insertContent':
        return executeInsertContent(editor, args)
      case 'replaceBlock':
        return executeReplaceBlock(editor, args)
      case 'replaceInSection':
        return executeReplaceInSection(editor, args)
      case 'rewriteSection':
        return executeRewriteSection(editor, args)
      case 'deleteContent':
        return executeDeleteContent(editor, args)
      case 'addCitation':
        return executeAddCitation(editor, args)
      case 'highlightText':
        return executeHighlightText(editor, args)
      case 'addComment':
        return executeAddComment(editor, args)
      default:
        return { success: false, message: `Unknown tool: ${toolName}` }
    }
  } catch (error) {
    console.error(`[ToolExecutor] Error in ${toolName}:`, error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    toast.error(`Edit failed: ${message}`)
    return { success: false, message }
  }
}

// =============================================================================
// TOOL IMPLEMENTATIONS
// =============================================================================

/**
 * Insert content at a specified location.
 * 
 * Supports:
 * 1. afterBlockId - Insert after a specific block
 * 2. afterPhrase - Insert after specific text
 * 3. location - General positioning (cursor, end, after:Section, start:Section)
 */
function executeInsertContent(
  editor: Editor,
  args: Record<string, unknown>
): ToolExecutionResult {
  const content = args.content as string
  const afterBlockId = args.afterBlockId as string | undefined || args.blockId as string | undefined
  const afterPhrase = args.afterPhrase as string | undefined
  const location = args.location as string | undefined

  if (!content) {
    return { success: false, message: 'No content provided' }
  }

  // Priority 1: Insert after specific phrase (most precise)
  if (afterPhrase) {
    const docText = editor.getText()
    const match = fuzzyFindPhrase(docText, afterPhrase)
    
    if (match.found) {
      const insertPos = findTipTapPosition(editor, match.endIndex)
      editor.chain()
        .focus()
        .setTextSelection(insertPos)
        .insertContent(' ' + content)
        .run()
      toast.success('Content inserted after phrase')
      return { success: true, message: 'Inserted after phrase' }
    }
    console.warn(`[ToolExecutor] Phrase not found: "${afterPhrase.slice(0, 30)}..."`)
  }

  // Priority 2: Insert after specific block
  if (afterBlockId) {
    const block = findBlockById(editor, afterBlockId)
    if (block) {
      const insertPos = block.pos + block.node.nodeSize
      editor.chain()
        .focus()
        .setTextSelection(insertPos)
        .insertContent('\n\n' + content)
        .run()
      toast.success('Content inserted')
      return { success: true, message: `Inserted after block ${afterBlockId}`, blockId: afterBlockId }
    }
    console.warn(`[ToolExecutor] Block ${afterBlockId} not found, using location fallback`)
  }

  // Priority 3: Use location string
  if (location === 'cursor' || !location) {
    editor.chain().focus().insertContent(content).run()
    toast.success('Content inserted at cursor')
    return { success: true, message: 'Inserted at cursor' }
  }

  if (location === 'end') {
    editor.chain()
      .focus()
      .setTextSelection(editor.state.doc.content.size)
      .insertContent('\n\n' + content)
      .run()
    toast.success('Content appended')
    return { success: true, message: 'Appended to document' }
  }

  // Handle "after:SectionName" or "start:SectionName"
  const afterMatch = location.match(/^after:(.+)$/i)
  const startMatch = location.match(/^start:(.+)$/i)

  if (afterMatch) {
    const sectionName = afterMatch[1]
    const docText = editor.getText()
    const section = findSection(docText, sectionName)
    
    if (!section.found) {
      toast.error(`Section "${sectionName}" not found`)
      return { success: false, message: `Section "${sectionName}" not found` }
    }

    const insertPos = findTipTapPosition(editor, section.contentEnd)
    editor.chain().focus().setTextSelection(insertPos).insertContent('\n\n' + content).run()
    toast.success(`Content added to ${sectionName}`)
    return { success: true, message: `Inserted at end of ${sectionName}` }
  }

  if (startMatch) {
    const sectionName = startMatch[1]
    const docText = editor.getText()
    const section = findSection(docText, sectionName)
    
    if (!section.found) {
      toast.error(`Section "${sectionName}" not found`)
      return { success: false, message: `Section "${sectionName}" not found` }
    }

    const insertPos = findTipTapPosition(editor, section.contentStart)
    editor.chain().focus().setTextSelection(insertPos).insertContent(content + '\n\n').run()
    toast.success(`Content added to ${sectionName}`)
    return { success: true, message: `Inserted at start of ${sectionName}` }
  }

  // Default fallback
  editor.chain().focus().insertContent(content).run()
  return { success: true, message: 'Inserted at cursor (unknown location)' }
}

/**
 * Replace content - supports both block-level and text-level replacement.
 * 
 * - blockId alone → replace entire block
 * - searchPhrase alone → replace specific text
 * - blockId + searchPhrase → replace text within that block
 */
function executeReplaceBlock(
  editor: Editor,
  args: Record<string, unknown>
): ToolExecutionResult {
  const blockId = args.blockId as string | undefined
  const section = args.section as string | undefined
  const searchPhrase = args.searchPhrase as string | undefined
  const newContent = args.newContent as string

  if (!newContent) {
    return { success: false, message: 'No new content provided' }
  }

  // If searchPhrase is provided, do text-level replacement
  if (searchPhrase) {
    const docText = editor.getText()
    const match = fuzzyFindPhrase(docText, searchPhrase)
    
    if (!match.found) {
      const message = `Could not find text: "${searchPhrase.slice(0, 50)}..."`
      toast.error(message)
      return { success: false, message }
    }

    // If blockId provided, log warning if match isn't in that block (but proceed)
    if (blockId) {
      const block = findBlockById(editor, blockId)
      if (block && !block.node.textContent.toLowerCase().includes(searchPhrase.toLowerCase().slice(0, 20))) {
        console.warn(`[ToolExecutor] Text found but not in specified block ${blockId}`)
      }
    }

    const from = findTipTapPosition(editor, match.startIndex)
    const to = findTipTapPosition(editor, match.endIndex)

    editor.chain()
      .focus()
      .setTextSelection({ from, to })
      .insertContent(newContent)
      .run()

    toast.success('Text replaced')
    return { 
      success: true, 
      message: `Replaced "${searchPhrase.slice(0, 30)}..."`,
      affectedRange: { from, to },
    }
  }

  // No searchPhrase → replace entire block
  const target = findTargetBlock(editor, { blockId, section })

  if (!target.found) {
    const message = getNotFoundMessage({ blockId, section, searchPhrase })
    toast.error(message)
    return { success: false, message }
  }

  editor.chain()
    .focus()
    .setTextSelection({ from: target.pos, to: target.endPos })
    .insertContent(newContent)
    .run()

  const methodNote = target.method === 'blockId' ? ' (entire block)' : ` (found via ${target.method})`
  toast.success(`Content replaced${methodNote}`)
  
  return { 
    success: true, 
    message: `Replaced content${methodNote}`,
    affectedRange: { from: target.pos, to: target.endPos },
    blockId: target.blockId,
  }
}

/**
 * Replace content within a section (legacy support).
 */
function executeReplaceInSection(
  editor: Editor,
  args: Record<string, unknown>
): ToolExecutionResult {
  const section = args.section as string
  const searchPhrase = args.searchPhrase as string
  const newContent = args.newContent as string

  if (!searchPhrase || !newContent) {
    return { success: false, message: 'Missing search phrase or new content' }
  }

  const target = findTargetBlock(editor, { section, searchPhrase })

  if (!target.found) {
    const message = getNotFoundMessage({ section, searchPhrase })
    toast.error(message)
    return { success: false, message }
  }

  editor.chain()
    .focus()
    .setTextSelection({ from: target.pos, to: target.endPos })
    .insertContent(newContent)
    .run()

  toast.success('Content replaced')
  return { 
    success: true, 
    message: 'Content replaced',
    affectedRange: { from: target.pos, to: target.endPos },
  }
}

/**
 * Rewrite an entire section.
 */
function executeRewriteSection(
  editor: Editor,
  args: Record<string, unknown>
): ToolExecutionResult {
  const sectionName = args.section as string
  const newContent = args.newContent as string

  if (!sectionName || !newContent) {
    return { success: false, message: 'Missing section name or new content' }
  }

  const docText = editor.getText()
  const section = findSection(docText, sectionName)

  if (!section.found) {
    toast.error(`Section "${sectionName}" not found`)
    return { success: false, message: `Section "${sectionName}" not found` }
  }

  const from = findTipTapPosition(editor, section.contentStart)
  const to = findTipTapPosition(editor, section.contentEnd)

  editor.chain()
    .focus()
    .setTextSelection({ from, to })
    .insertContent('\n\n' + newContent + '\n\n')
    .run()

  toast.success(`Rewrote ${sectionName}`)
  return { 
    success: true, 
    message: `Rewrote section "${sectionName}"`,
    affectedRange: { from, to },
  }
}

/**
 * Delete content from the document.
 * 
 * Supports two modes:
 * 1. Block deletion: blockId alone → delete entire block
 * 2. Partial deletion: searchPhrase → delete specific text (optionally scoped by blockId)
 */
function executeDeleteContent(
  editor: Editor,
  args: Record<string, unknown>
): ToolExecutionResult {
  const blockId = args.blockId as string | undefined
  const section = args.section as string | undefined
  const searchPhrase = args.searchPhrase as string | undefined

  // If searchPhrase is provided, do partial deletion (text-level)
  if (searchPhrase) {
    const docText = editor.getText()
    
    // Search in full document text, but optionally verify it's in the right scope
    const match = fuzzyFindPhrase(docText, searchPhrase)
    
    if (!match.found) {
      const message = `Could not find text: "${searchPhrase.slice(0, 50)}..."`
      toast.error(message)
      return { success: false, message }
    }

    // If blockId provided, verify the match is within that block
    if (blockId) {
      const block = findBlockById(editor, blockId)
      if (block) {
        const blockText = block.node.textContent.toLowerCase()
        if (!blockText.includes(searchPhrase.toLowerCase().slice(0, 20))) {
          // Match found but not in specified block - warn but proceed
          console.warn(`[ToolExecutor] Text found but not in specified block ${blockId}`)
        }
      }
    }

    // Calculate actual document positions
    const from = findTipTapPosition(editor, match.startIndex)
    const to = findTipTapPosition(editor, match.endIndex)

    editor.chain()
      .focus()
      .setTextSelection({ from, to })
      .deleteSelection()
      .run()

    toast.success('Text deleted')
    return { 
      success: true, 
      message: `Deleted "${searchPhrase.slice(0, 30)}..."`,
      affectedRange: { from, to },
    }
  }

  // No searchPhrase → delete entire block
  const target = findTargetBlock(editor, { blockId, section })

  if (!target.found) {
    const message = getNotFoundMessage({ blockId, section, searchPhrase })
    toast.error(message)
    return { success: false, message }
  }

  editor.chain()
    .focus()
    .setTextSelection({ from: target.pos, to: target.endPos })
    .deleteSelection()
    .run()

  const methodNote = target.method === 'blockId' ? ' (entire block)' : ` (found via ${target.method})`
  toast.success(`Content deleted${methodNote}`)
  
  return { 
    success: true, 
    message: `Deleted content${methodNote}`,
    affectedRange: { from: target.pos, to: target.endPos },
  }
}

/**
 * Add a citation marker.
 */
function executeAddCitation(
  editor: Editor,
  args: Record<string, unknown>
): ToolExecutionResult {
  const paperId = args.paperId as string
  const blockId = args.blockId as string | undefined
  const afterPhrase = args.afterPhrase as string | undefined
  const section = args.section as string | undefined

  if (!paperId) {
    return { success: false, message: 'Missing paper ID' }
  }

  const citationMarker = ` [CITE: ${paperId}]`

  // Priority 1: Add at end of specific block
  if (blockId) {
    const block = findBlockById(editor, blockId)
    if (block) {
      // Find the end of text content within the block
      const insertPos = block.pos + block.node.nodeSize - 1
      editor.chain()
        .focus()
        .setTextSelection(insertPos)
        .insertContent(citationMarker)
        .run()
      toast.success('Citation added')
      return { success: true, message: 'Citation added to block', blockId }
    }
  }

  // Priority 2: Find by text
  if (afterPhrase) {
    const docText = editor.getText()
    const match = section 
      ? findInSection(docText, section, afterPhrase)
      : fuzzyFindPhrase(docText, afterPhrase)

    if (match.found) {
      const insertPos = findTipTapPosition(editor, match.endIndex)
      editor.chain()
        .focus()
        .setTextSelection(insertPos)
        .insertContent(citationMarker)
        .run()
      toast.success('Citation added')
      return { success: true, message: 'Citation added' }
    }
  }

  // Fallback: Insert at cursor
  editor.chain().focus().insertContent(citationMarker).run()
  toast.warning('Could not find location, added at cursor')
  return { success: true, message: 'Citation added at cursor (location not found)' }
}

/**
 * Highlight text with a comment.
 * 
 * - blockId alone → highlight entire block
 * - searchPhrase → highlight specific text (optionally scoped by blockId)
 */
function executeHighlightText(
  editor: Editor,
  args: Record<string, unknown>
): ToolExecutionResult {
  const blockId = args.blockId as string | undefined
  const section = args.section as string | undefined
  const searchPhrase = args.searchPhrase as string | undefined
  const comment = args.comment as string
  const highlightType = (args.highlightType as string) || 'suggestion'

  let from: number
  let to: number

  // If searchPhrase provided, find and highlight that specific text
  if (searchPhrase) {
    const docText = editor.getText()
    const match = fuzzyFindPhrase(docText, searchPhrase)
    
    if (!match.found) {
      const message = `Could not find text to highlight: "${searchPhrase.slice(0, 50)}..."`
      toast.error(message)
      return { success: false, message }
    }

    from = findTipTapPosition(editor, match.startIndex)
    to = findTipTapPosition(editor, match.endIndex)
  } else {
    // No searchPhrase → highlight entire block
    const target = findTargetBlock(editor, { blockId, section })

    if (!target.found) {
      const message = getNotFoundMessage({ blockId, section, searchPhrase })
      toast.error(message)
      return { success: false, message }
    }

    from = target.pos
    to = target.endPos
  }

  // Color based on type
  const colors: Record<string, string> = {
    suggestion: '#fef08a', // yellow
    warning: '#fecaca',    // red
    info: '#bfdbfe',       // blue
  }

  const color = colors[highlightType] || colors.suggestion

  // Apply highlight if extension is available
  if (editor.can().setHighlight({ color })) {
    editor.chain()
      .focus()
      .setTextSelection({ from, to })
      .setHighlight({ color })
      .run()
  } else {
    // Fallback: just select the text
    editor.chain()
      .focus()
      .setTextSelection({ from, to })
      .run()
  }

  if (comment) {
    toast.info(comment, { duration: 5000 })
  } else {
    toast.success('Text highlighted')
  }

  return { 
    success: true, 
    message: comment || 'Text highlighted',
    affectedRange: { from, to },
  }
}

/**
 * Add a comment (shows as toast, could be extended to comment system).
 */
function executeAddComment(
  editor: Editor,
  args: Record<string, unknown>
): ToolExecutionResult {
  const blockId = args.blockId as string | undefined
  const section = args.section as string | undefined
  const nearPhrase = args.nearPhrase as string | undefined
  const comment = args.comment as string

  if (!comment) {
    return { success: false, message: 'Missing comment text' }
  }

  // Optionally select the relevant content
  const target = findTargetBlock(editor, { 
    blockId, 
    section, 
    searchPhrase: nearPhrase 
  })

  if (target.found) {
    editor.chain()
      .focus()
      .setTextSelection({ from: target.pos, to: target.endPos })
      .run()
  }

  toast.info(`AI Comment: ${comment}`, { duration: 8000 })
  return { success: true, message: 'Comment added' }
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Convert a plain text index to TipTap document position.
 */
function findTipTapPosition(editor: Editor, textIndex: number): number {
  let charCount = 0
  let position = 0
  let found = false

  editor.state.doc.descendants((node, pos) => {
    if (found) return false

    if (node.isText && node.text) {
      const nodeLength = node.text.length
      
      if (charCount + nodeLength >= textIndex) {
        position = pos + (textIndex - charCount)
        found = true
        return false
      }
      
      charCount += nodeLength
    } else if (node.isBlock && charCount > 0) {
      charCount += 1
    }

    return true
  })

  return found ? position : editor.state.doc.content.size
}
