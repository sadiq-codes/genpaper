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
import { hasMarkdownFormatting, processAIContent } from '../utils/content-processor'
import { textIndexToDocPosition, validatePositions } from '../utils/position-utils'
import type { ProjectPaper } from '../types'

// Papers context for citation resolution
// Note: This is a fallback. Prefer passing papers via options when possible.
let _globalPapersContext: ProjectPaper[] = []

/**
 * Set the global papers context for markdown processing.
 * This is a fallback mechanism - prefer passing papers via ToolExecutionOptions.
 * @deprecated Use ToolExecutionOptions.papers instead when possible
 */
export function setToolExecutorPapers(papers: ProjectPaper[]): void {
  _globalPapersContext = papers
}

// =============================================================================
// TYPES
// =============================================================================

export interface ToolExecutionResult {
  success: boolean
  message: string
  affectedRange?: { from: number; to: number }
  blockId?: string
}

export interface ToolExecutionOptions {
  /** If set, this edit ID will be attached to the transaction as 'ghostEditAccepted' meta
   *  to prevent clearing other ghost previews when this edit modifies the document */
  ghostEditId?: string
  /** Papers context for citation resolution in markdown content */
  papers?: ProjectPaper[]
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

/**
 * Validate and clamp positions to document bounds.
 * Returns validated positions or null with error message if invalid.
 */
function validateEditRange(
  editor: Editor,
  from: number,
  to: number
): { from: number; to: number } | { error: string } {
  const validation = validatePositions(editor, from, to)
  
  if (!validation.valid) {
    console.warn(`[ToolExecutor] Position validation failed: ${validation.error}`)
    // Try to clamp to valid range
    const docSize = editor.state.doc.content.size
    const clampedFrom = Math.max(0, Math.min(from, docSize))
    const clampedTo = Math.max(clampedFrom, Math.min(to, docSize))
    
    if (clampedFrom === clampedTo && from !== to) {
      return { error: validation.error || 'Invalid position range' }
    }
    
    console.log(`[ToolExecutor] Clamped positions: ${from}->${clampedFrom}, ${to}->${clampedTo}`)
    return { from: clampedFrom, to: clampedTo }
  }
  
  return { from, to }
}

// =============================================================================
// MAIN EXECUTOR
// =============================================================================

/**
 * Execute a document tool on the TipTap editor.
 * 
 * @param editor - TipTap editor instance
 * @param toolName - Name of the tool to execute
 * @param args - Tool arguments
 * @param options - Execution options (e.g., ghostEditId to preserve other previews, papers for citations)
 */
export function executeDocumentTool(
  editor: Editor,
  toolName: string,
  args: Record<string, unknown>,
  options: ToolExecutionOptions = {}
): ToolExecutionResult {
  console.log(`[ToolExecutor] Executing ${toolName}`)
  console.log(`[ToolExecutor] Args:`, JSON.stringify(args, null, 2))
  
  // Get papers context (from options or global fallback)
  const papers = options.papers || _globalPapersContext
  
  try {
    // If we have a ghost edit ID, wrap execution to set the meta
    if (options.ghostEditId) {
      // Use a chain to ensure the meta is set on the same transaction
      return executeWithGhostMeta(editor, toolName, args, options.ghostEditId, papers)
    }
    
    switch (toolName) {
      case 'insertContent':
        return executeInsertContent(editor, args, papers)
      case 'replaceBlock':
        return executeReplaceBlock(editor, args, papers)
      case 'replaceInSection':
        return executeReplaceInSection(editor, args, papers)
      case 'rewriteSection':
        return executeRewriteSection(editor, args, papers)
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

/**
 * Execute a tool while setting ghostEditAccepted meta to preserve other ghost previews.
 * This wraps the normal execution to ensure the meta is set on the modifying transaction.
 */
function executeWithGhostMeta(
  editor: Editor,
  toolName: string,
  args: Record<string, unknown>,
  ghostEditId: string,
  papers: ProjectPaper[] = []
): ToolExecutionResult {
  // We need to intercept the transaction and add our meta
  // Use appendTransaction-style approach via editor.view.dispatch wrapper
  const originalDispatch = editor.view.dispatch.bind(editor.view)
  let result: ToolExecutionResult = { success: false, message: 'Not executed' }
  
  // Temporarily wrap dispatch to add our meta
  editor.view.dispatch = (tr) => {
    if (tr.docChanged) {
      tr.setMeta('ghostEditAccepted', ghostEditId)
    }
    return originalDispatch(tr)
  }
  
  try {
    switch (toolName) {
      case 'insertContent':
        result = executeInsertContent(editor, args, papers)
        break
      case 'replaceBlock':
        result = executeReplaceBlock(editor, args, papers)
        break
      case 'replaceInSection':
        result = executeReplaceInSection(editor, args, papers)
        break
      case 'rewriteSection':
        result = executeRewriteSection(editor, args, papers)
        break
      case 'deleteContent':
        result = executeDeleteContent(editor, args)
        break
      case 'addCitation':
        result = executeAddCitation(editor, args)
        break
      case 'highlightText':
        result = executeHighlightText(editor, args)
        break
      case 'addComment':
        result = executeAddComment(editor, args)
        break
      default:
        result = { success: false, message: `Unknown tool: ${toolName}` }
    }
  } finally {
    // Restore original dispatch
    editor.view.dispatch = originalDispatch
  }
  
  return result
}

// =============================================================================
// TOOL IMPLEMENTATIONS
// =============================================================================

/**
 * Prepare content for insertion - converts markdown to TipTap JSON if needed
 * @param content - Raw content string
 * @param papers - Papers context for citation resolution
 */
function prepareContent(content: string, papers: ProjectPaper[] = []): string | Record<string, unknown> {
  if (hasMarkdownFormatting(content)) {
    // Convert markdown to TipTap JSON for proper rendering (tables, lists, etc.)
    // Use provided papers or fall back to global context
    const papersContext = papers.length > 0 ? papers : _globalPapersContext
    const doc = processAIContent(content, papersContext)
    // Return the content array, not the full doc wrapper
    return doc.content || content
  }
  return content
}

/**
 * Insert content at a specified location.
 * 
 * Supports:
 * 1. afterBlockId - Insert after a specific block
 * 2. afterPhrase - Insert after specific text
 * 3. location - General positioning (cursor, end, after:Section, start:Section)
 * 
 * Automatically detects and converts markdown (tables, lists, etc.) to TipTap nodes.
 */
function executeInsertContent(
  editor: Editor,
  args: Record<string, unknown>,
  papers: ProjectPaper[] = []
): ToolExecutionResult {
  const rawContent = args.content as string
  const afterBlockId = args.afterBlockId as string | undefined || args.blockId as string | undefined
  const afterPhrase = args.afterPhrase as string | undefined
  const location = args.location as string | undefined

  if (!rawContent) {
    return { success: false, message: 'No content provided' }
  }

  // Prepare content - convert markdown to TipTap JSON if needed
  const content = prepareContent(rawContent, papers)
  const isMarkdown = typeof content !== 'string'
  
  if (isMarkdown) {
    console.log('[ToolExecutor] Detected markdown content, converted to TipTap JSON')
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
        .insertContent(isMarkdown ? content : ' ' + content)
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
        .insertContent(isMarkdown ? content : '\n\n' + content)
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
      .insertContent(isMarkdown ? content : '\n\n' + content)
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
    editor.chain().focus().setTextSelection(insertPos).insertContent(isMarkdown ? content : '\n\n' + content).run()
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
    editor.chain().focus().setTextSelection(insertPos).insertContent(isMarkdown ? content : content + '\n\n').run()
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
 * 
 * Automatically detects and converts markdown (tables, lists, etc.) to TipTap nodes.
 */
function executeReplaceBlock(
  editor: Editor,
  args: Record<string, unknown>,
  papers: ProjectPaper[] = []
): ToolExecutionResult {
  const blockId = args.blockId as string | undefined
  const section = args.section as string | undefined
  const searchPhrase = args.searchPhrase as string | undefined
  const rawContent = args.newContent as string

  if (!rawContent) {
    return { success: false, message: 'No new content provided' }
  }

  // Prepare content - convert markdown to TipTap JSON if needed
  const newContent = prepareContent(rawContent, papers)
  // Note: isMarkdown available for future logging/debugging
  const _isMarkdown = typeof newContent !== 'string'

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

    const rawFrom = findTipTapPosition(editor, match.startIndex)
    const rawTo = findTipTapPosition(editor, match.endIndex)

    // Validate positions before edit
    const validated = validateEditRange(editor, rawFrom, rawTo)
    if ('error' in validated) {
      toast.error(validated.error)
      return { success: false, message: validated.error }
    }
    const { from, to } = validated

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

  // Validate positions before edit
  const validated = validateEditRange(editor, target.pos, target.endPos)
  if ('error' in validated) {
    toast.error(validated.error)
    return { success: false, message: validated.error }
  }

  editor.chain()
    .focus()
    .setTextSelection({ from: validated.from, to: validated.to })
    .insertContent(newContent)
    .run()

  const methodNote = target.method === 'blockId' ? ' (entire block)' : ` (found via ${target.method})`
  toast.success(`Content replaced${methodNote}`)
  
  return { 
    success: true, 
    message: `Replaced content${methodNote}`,
    affectedRange: { from: validated.from, to: validated.to },
    blockId: target.blockId,
  }
}

/**
 * Replace content within a section (legacy support).
 * Automatically detects and converts markdown to TipTap nodes.
 */
function executeReplaceInSection(
  editor: Editor,
  args: Record<string, unknown>,
  papers: ProjectPaper[] = []
): ToolExecutionResult {
  const section = args.section as string
  const searchPhrase = args.searchPhrase as string
  const rawContent = args.newContent as string

  if (!searchPhrase || !rawContent) {
    return { success: false, message: 'Missing search phrase or new content' }
  }

  // Prepare content - convert markdown to TipTap JSON if needed
  const newContent = prepareContent(rawContent, papers)

  const target = findTargetBlock(editor, { section, searchPhrase })

  if (!target.found) {
    const message = getNotFoundMessage({ section, searchPhrase })
    toast.error(message)
    return { success: false, message }
  }

  // Validate positions before edit
  const validated = validateEditRange(editor, target.pos, target.endPos)
  if ('error' in validated) {
    toast.error(validated.error)
    return { success: false, message: validated.error }
  }

  editor.chain()
    .focus()
    .setTextSelection({ from: validated.from, to: validated.to })
    .insertContent(newContent)
    .run()

  toast.success('Content replaced')
  return { 
    success: true, 
    message: 'Content replaced',
    affectedRange: { from: validated.from, to: validated.to },
  }
}

/**
 * Rewrite an entire section.
 * Automatically detects and converts markdown to TipTap nodes.
 */
function executeRewriteSection(
  editor: Editor,
  args: Record<string, unknown>,
  papers: ProjectPaper[] = []
): ToolExecutionResult {
  const sectionName = args.section as string
  const rawContent = args.newContent as string

  if (!sectionName || !rawContent) {
    return { success: false, message: 'Missing section name or new content' }
  }

  // Prepare content - convert markdown to TipTap JSON if needed
  const newContent = prepareContent(rawContent, papers)
  const isMarkdown = typeof newContent !== 'string'

  const docText = editor.getText()
  const section = findSection(docText, sectionName)

  if (!section.found) {
    toast.error(`Section "${sectionName}" not found`)
    return { success: false, message: `Section "${sectionName}" not found` }
  }

  const rawFrom = findTipTapPosition(editor, section.contentStart)
  const rawTo = findTipTapPosition(editor, section.contentEnd)

  // Validate positions before edit
  const validated = validateEditRange(editor, rawFrom, rawTo)
  if ('error' in validated) {
    toast.error(validated.error)
    return { success: false, message: validated.error }
  }
  const { from, to } = validated

  editor.chain()
    .focus()
    .setTextSelection({ from, to })
    .insertContent(isMarkdown ? newContent : '\n\n' + newContent + '\n\n')
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
    const rawFrom = findTipTapPosition(editor, match.startIndex)
    const rawTo = findTipTapPosition(editor, match.endIndex)

    // Validate positions before edit
    const validated = validateEditRange(editor, rawFrom, rawTo)
    if ('error' in validated) {
      toast.error(validated.error)
      return { success: false, message: validated.error }
    }
    const { from, to } = validated

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

  // Validate positions before edit
  const validated = validateEditRange(editor, target.pos, target.endPos)
  if ('error' in validated) {
    toast.error(validated.error)
    return { success: false, message: validated.error }
  }

  editor.chain()
    .focus()
    .setTextSelection({ from: validated.from, to: validated.to })
    .deleteSelection()
    .run()

  const methodNote = target.method === 'blockId' ? ' (entire block)' : ` (found via ${target.method})`
  toast.success(`Content deleted${methodNote}`)
  
  return { 
    success: true, 
    message: `Deleted content${methodNote}`,
    affectedRange: { from: validated.from, to: validated.to },
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

// Alias for backward compatibility - uses shared utility
const findTipTapPosition = textIndexToDocPosition
