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
import { v4 as uuidv4 } from 'uuid'
import { findBlockById } from '../extensions/BlockId'
import { fuzzyFindPhrase, findSection, findInSection } from '@/lib/utils/fuzzy-match'
import { toast } from 'sonner'
import { hasMarkdownFormatting, processAIContent } from '../utils/content-processor'
import { textIndexToDocPosition, validatePositions } from '../utils/position-utils'
import type { ProjectPaper } from '../types'

// Papers context for citation resolution
// Note: This is a fallback. Prefer passing papers via options when possible.
let _globalPapersContext: ProjectPaper[] = []
let _globalProjectId: string | undefined

/**
 * Set the global papers context for markdown processing.
 * This is a fallback mechanism - prefer passing papers via ToolExecutionOptions.
 * @deprecated Use ToolExecutionOptions.papers instead when possible
 */
export function setToolExecutorPapers(papers: ProjectPaper[]): void {
  _globalPapersContext = papers
}

/**
 * Set the global project ID for citation saving.
 */
export function setToolExecutorProjectId(projectId: string): void {
  _globalProjectId = projectId
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
  /** Project ID for saving citations to database */
  projectId?: string
}

/** Citation instance extracted from CITATIONS block */
interface ExtractedCitationInstance {
  instanceId: string      // UUID for this specific citation instance
  paperId: string         // UUID of the paper being cited
  quote: string           // The exact quote/context for this citation
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
  
  // Get context (from options or global fallback)
  const papers = options.papers || _globalPapersContext
  const projectId = options.projectId || _globalProjectId
  
  try {
    // If we have a ghost edit ID, wrap execution to set the meta
    if (options.ghostEditId) {
      // Use a chain to ensure the meta is set on the same transaction
      return executeWithGhostMeta(editor, toolName, args, options.ghostEditId, papers, projectId)
    }
    
    return dispatchTool(editor, toolName, args, papers, projectId)
  } catch (error) {
    console.error(`[ToolExecutor] Error in ${toolName}:`, error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    toast.error(`Edit failed: ${message}`)
    return { success: false, message }
  }
}

/**
 * Dispatch a tool call to the appropriate executor.
 * Extracted to avoid code duplication between normal and ghost-meta paths.
 */
function dispatchTool(
  editor: Editor,
  toolName: string,
  args: Record<string, unknown>,
  papers: ProjectPaper[],
  projectId?: string
): ToolExecutionResult {
  switch (toolName) {
    case 'insertContent':
      return executeInsertContent(editor, args, papers, projectId)
    case 'replaceBlock':
      return executeReplaceBlock(editor, args, papers, projectId)
    case 'replaceInSection':
      return executeReplaceInSection(editor, args, papers, projectId)
    case 'rewriteSection':
      return executeRewriteSection(editor, args, papers, projectId)
    case 'deleteContent':
      return executeDeleteContent(editor, args)
    case 'addCitation':
      return executeAddCitation(editor, args, projectId)
    case 'highlightText':
      return executeHighlightText(editor, args)
    case 'addComment':
      return executeAddComment(editor, args)
    default:
      return { success: false, message: `Unknown tool: ${toolName}` }
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
  papers: ProjectPaper[] = [],
  projectId?: string
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
    // Use shared dispatch function to avoid code duplication
    result = dispatchTool(editor, toolName, args, papers, projectId)
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
 * Convert numbered citation markers [1], [2] to [@paperId#instanceId] format
 * Uses the CITATIONS block at the end of content to map numbers to paper IDs
 * Also extracts citation instances with their quotes for saving to database
 * 
 * Each citation occurrence gets a unique instanceId for tracking the specific quote used.
 */
function convertNumberedCitations(content: string): { content: string; instances: ExtractedCitationInstance[] } {
  // Pattern to extract the CITATIONS block
  const citationsBlockPattern = /<!--\s*CITATIONS\s*([\s\S]*?)-->/i
  const blockMatch = content.match(citationsBlockPattern)
  
  if (!blockMatch) {
    // No CITATIONS block, return as-is
    console.log('[ToolExecutor] No CITATIONS block found in content')
    return { content, instances: [] }
  }
  
  console.log('[ToolExecutor] Found CITATIONS block, parsing...')
  
  // Parse citation entries: [N] paper_id: xxx | quote: "yyy"
  const entryPattern = /\[(\d+)\]\s*paper_id:\s*([a-f0-9-]+)(?:\s*\|\s*quote:\s*"([^"]*)")?/gi
  const citationsMap = new Map<number, { paperId: string; quote?: string }>()
  
  for (const match of blockMatch[1].matchAll(entryPattern)) {
    citationsMap.set(parseInt(match[1], 10), {
      paperId: match[2],
      quote: match[3] || undefined
    })
  }
  
  if (citationsMap.size === 0) {
    console.log('[ToolExecutor] CITATIONS block found but no valid entries parsed')
    return { content: content.replace(citationsBlockPattern, '').trim(), instances: [] }
  }
  
  console.log(`[ToolExecutor] Parsed ${citationsMap.size} citations from block:`, 
    Array.from(citationsMap.entries()).map(([i, c]) => `[${i}] -> ${c.paperId}`)
  )
  
  let result = content
  const instances: ExtractedCitationInstance[] = []
  
  // Replace each [N] marker with [@paperId#instanceId]
  // Each occurrence gets a unique instanceId
  for (const [index, { paperId, quote }] of citationsMap) {
    const pattern = new RegExp(`\\[${index}\\]`, 'g')
    
    // Replace each occurrence with a unique instanceId
    result = result.replace(pattern, () => {
      const instanceId = uuidv4()
      
      // Track this instance for DB insertion
      instances.push({
        instanceId,
        paperId,
        quote: quote || '',
      })
      
      return `[@${paperId}#${instanceId}]`
    })
  }
  
  // Remove the CITATIONS block
  result = result.replace(citationsBlockPattern, '').trim()
  
  // Strip any orphaned [N] markers that weren't in the CITATIONS block
  result = result.replace(/\[(\d+)\]/g, '')
  
  console.log(`[ToolExecutor] Converted ${citationsMap.size} citation types to ${instances.length} instances with [@paperId#instanceId] format`)
  
  return { content: result, instances }
}

/**
 * Result of preparing content for insertion
 */
interface PreparedContent {
  content: string | Record<string, unknown>
  instances: ExtractedCitationInstance[]
}

/**
 * Prepare content for insertion - converts markdown to TipTap JSON if needed
 * @param content - Raw content string
 * @param papers - Papers context for citation resolution
 */
function prepareContent(content: string, papers: ProjectPaper[] = []): PreparedContent {
  // First, convert numbered [1], [2] citations to [@paperId#instanceId] format
  const { content: contentWithCitations, instances } = convertNumberedCitations(content)
  
  if (hasMarkdownFormatting(contentWithCitations)) {
    // Convert markdown to TipTap JSON for proper rendering (tables, lists, etc.)
    // Use provided papers or fall back to global context
    const papersContext = papers.length > 0 ? papers : _globalPapersContext
    const doc = processAIContent(contentWithCitations, papersContext)
    // Return the content array, not the full doc wrapper
    return { content: doc.content || contentWithCitations, instances }
  }
  return { content: contentWithCitations, instances }
}

/**
 * Save citation instances to database with retry logic
 * Uses exponential backoff for network failures
 */
async function saveCitationInstancesToDatabase(
  projectId: string,
  instances: ExtractedCitationInstance[],
  maxRetries: number = 3
): Promise<void> {
  if (!projectId || instances.length === 0) return

  const payload = {
    projectId,
    instances: instances.map(inst => ({
      id: inst.instanceId,
      paperId: inst.paperId,
      quote: inst.quote,
    }))
  }

  let lastError: Error | null = null
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch('/api/citation-instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      console.log(`[ToolExecutor] Saved ${instances.length} citation instances to database`)
      return // Success
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      console.warn(`[ToolExecutor] Citation save attempt ${attempt + 1}/${maxRetries} failed:`, lastError.message)
      
      if (attempt < maxRetries - 1) {
        // Exponential backoff: 500ms, 1000ms, 2000ms
        const delay = 500 * Math.pow(2, attempt)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  
  // All retries failed - queue for later or log
  console.error(`[ToolExecutor] Failed to save citation instances after ${maxRetries} attempts:`, lastError)
  
  // Store failed instances in localStorage for potential recovery
  try {
    const failedQueue = JSON.parse(localStorage.getItem('failedCitationInstances') || '[]')
    failedQueue.push({ projectId, instances, timestamp: Date.now() })
    // Keep only last 50 failed saves to prevent localStorage bloat
    if (failedQueue.length > 50) failedQueue.shift()
    localStorage.setItem('failedCitationInstances', JSON.stringify(failedQueue))
    console.log('[ToolExecutor] Queued failed citation instances for later retry')
  } catch {
    // localStorage not available, silently fail
  }
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
  papers: ProjectPaper[] = [],
  projectId?: string
): ToolExecutionResult {
  const rawContent = args.content as string
  const afterBlockId = args.afterBlockId as string | undefined || args.blockId as string | undefined
  const afterPhrase = args.afterPhrase as string | undefined
  const location = args.location as string | undefined

  if (!rawContent) {
    return { success: false, message: 'No content provided' }
  }

  // Prepare content - convert markdown to TipTap JSON if needed
  const { content, instances } = prepareContent(rawContent, papers)
  const isMarkdown = typeof content !== 'string'
  
  if (isMarkdown) {
    console.log('[ToolExecutor] Detected markdown content, converted to TipTap JSON')
  }
  
  // Save citation instances to database (async, don't block)
  const effectiveProjectId = projectId || _globalProjectId
  if (effectiveProjectId && instances.length > 0) {
    saveCitationInstancesToDatabase(effectiveProjectId, instances)
  }

  // Priority 1: Insert after specific phrase (most precise)
  if (afterPhrase) {
    const docText = editor.getText()
    const match = fuzzyFindPhrase(docText, afterPhrase)
    
    if (match.found) {
      const insertPos = findTipTapPosition(editor, match.endIndex)
      
      // Determine if we need a space before the content
      // Don't add space if:
      // - Content is markdown (TipTap handles spacing)
      // - Previous char is whitespace
      // - We're at start of document
      let contentToInsert = content
      if (!isMarkdown && typeof content === 'string') {
        const charBefore = match.endIndex > 0 ? docText[match.endIndex - 1] : ''
        const charAfter = match.endIndex < docText.length ? docText[match.endIndex] : ''
        const needsSpaceBefore = charBefore && !/\s/.test(charBefore) && !/\s/.test(content[0] || '')
        const needsSpaceAfter = charAfter && !/\s/.test(charAfter) && !/\s/.test(content[content.length - 1] || '')
        
        if (needsSpaceBefore) contentToInsert = ' ' + contentToInsert
        if (needsSpaceAfter) contentToInsert = contentToInsert + ' '
      }
      
      editor.chain()
        .focus()
        .setTextSelection(insertPos)
        .insertContent(contentToInsert)
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
        .insertContent(content)  // TipTap handles paragraph spacing automatically
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
      .insertContent(content)  // TipTap handles paragraph spacing automatically
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
    editor.chain().focus().setTextSelection(insertPos).insertContent(content).run()
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
    editor.chain().focus().setTextSelection(insertPos).insertContent(content).run()
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
  papers: ProjectPaper[] = [],
  projectId?: string
): ToolExecutionResult {
  const blockId = args.blockId as string | undefined
  const section = args.section as string | undefined
  const searchPhrase = args.searchPhrase as string | undefined
  const rawContent = args.newContent as string

  if (!rawContent) {
    return { success: false, message: 'No new content provided' }
  }

  // Prepare content - convert markdown to TipTap JSON if needed
  const { content: newContent, instances } = prepareContent(rawContent, papers)
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

    // Save citation instances (async, don't block)
    const effectiveProjectId = projectId || _globalProjectId
    if (instances.length > 0 && effectiveProjectId) {
      saveCitationInstancesToDatabase(effectiveProjectId, instances)
    }

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
  
  // Save citation instances (async, don't block)
  const effectiveProjectId2 = projectId || _globalProjectId
  if (instances.length > 0 && effectiveProjectId2) {
    saveCitationInstancesToDatabase(effectiveProjectId2, instances)
  }

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
  papers: ProjectPaper[] = [],
  projectId?: string
): ToolExecutionResult {
  const section = args.section as string
  const searchPhrase = args.searchPhrase as string
  const rawContent = args.newContent as string

  if (!searchPhrase || !rawContent) {
    return { success: false, message: 'Missing search phrase or new content' }
  }

  // Prepare content - convert markdown to TipTap JSON if needed
  const { content: newContent, instances } = prepareContent(rawContent, papers)

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

  // Save citation instances (async, don't block)
  const effectiveProjectId = projectId || _globalProjectId
  if (instances.length > 0 && effectiveProjectId) {
    saveCitationInstancesToDatabase(effectiveProjectId, instances)
  }

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
  papers: ProjectPaper[] = [],
  projectId?: string
): ToolExecutionResult {
  const sectionName = args.section as string
  const rawContent = args.newContent as string

  if (!sectionName || !rawContent) {
    return { success: false, message: 'Missing section name or new content' }
  }

  // Prepare content - convert markdown to TipTap JSON if needed
  const { content: newContent, instances } = prepareContent(rawContent, papers)
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

  // Save citation instances (async, don't block)
  const effectiveProjectId = projectId || _globalProjectId
  if (instances.length > 0 && effectiveProjectId) {
    saveCitationInstancesToDatabase(effectiveProjectId, instances)
  }

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
 * Add a citation to existing text WITHOUT modifying the text.
 * 
 * This tool is for adding a single citation to a claim that doesn't have one.
 * For writing new content or editing text with citations, use insertContent/replaceBlock
 * with [N] markers and CITATIONS block.
 * 
 * Features:
 * - Checks for existing citations at the target position (prevents duplicates)
 * - Requires afterPhrase for precise placement
 * - Requires quote for research tracking
 */
function executeAddCitation(
  editor: Editor,
  args: Record<string, unknown>,
  projectId?: string
): ToolExecutionResult {
  const paperId = args.paperId as string
  const blockId = args.blockId as string | undefined
  const afterPhrase = args.afterPhrase as string | undefined
  const quote = args.quote as string | undefined

  // Validation
  if (!paperId) {
    return { success: false, message: 'Missing paper ID' }
  }
  
  if (!afterPhrase) {
    return { success: false, message: 'Missing afterPhrase - specify where to insert the citation' }
  }
  
  if (!quote) {
    console.warn('[ToolExecutor] addCitation called without quote - citation will have no supporting evidence')
  }

  // Find the target location
  let insertPos: number
  
  if (blockId) {
    // If blockId provided, search within that specific block
    const block = findBlockById(editor, blockId)
    if (!block) {
      toast.error(`Block not found: ${blockId}`)
      return { success: false, message: `Block not found: ${blockId}` }
    }
    
    // Get text content of the block and search within it
    const blockText = block.node.textContent
    const phraseIndex = blockText.toLowerCase().indexOf(afterPhrase.toLowerCase())
    
    if (phraseIndex === -1) {
      const preview = afterPhrase.slice(0, 50)
      toast.error(`Could not find text in block: "${preview}..."`)
      return { success: false, message: `Could not find text in block: "${preview}..."` }
    }
    
    // Calculate position within the block
    // block.pos is the start of the block, +1 for the opening tag
    // Then add the phrase index + phrase length to get end position
    insertPos = block.pos + 1 + phraseIndex + afterPhrase.length
  } else {
    // No blockId, search entire document
    const docText = editor.getText()
    const match = fuzzyFindPhrase(docText, afterPhrase)
    
    if (!match.found) {
      const preview = afterPhrase.slice(0, 50)
      toast.error(`Could not find text: "${preview}..."`)
      return { success: false, message: `Could not find text: "${preview}..."` }
    }
    
    insertPos = findTipTapPosition(editor, match.endIndex)
  }
  
  // Check if there's already a citation near this position
  // Scan a short range (up to 5 nodes) after the insertion point
  const resolvedPos = editor.state.doc.resolve(insertPos)
  const nodeAfter = resolvedPos.nodeAfter
  const nodeBefore = resolvedPos.nodeBefore
  
  // Check immediate neighbor nodes
  if (nodeAfter?.type.name === 'citation') {
    toast.warning('Citation already exists at this location')
    return { 
      success: false, 
      message: 'Citation already exists at this location - skipping to prevent duplicate' 
    }
  }
  
  if (nodeBefore?.type.name === 'citation') {
    toast.warning('Citation already exists before this text')
    return { 
      success: false, 
      message: 'Citation already exists before this text - skipping to prevent duplicate' 
    }
  }
  
  // Scan a few nodes ahead (whitespace, punctuation, then citation)
  // This catches cases like "claim. [citation]" where there's punctuation/space between
  let scanPos = insertPos
  const maxScanDistance = 10 // characters
  const endScanPos = Math.min(insertPos + maxScanDistance, editor.state.doc.content.size)
  
  while (scanPos < endScanPos) {
    const scanResolved = editor.state.doc.resolve(scanPos)
    const scanNode = scanResolved.nodeAfter
    
    if (!scanNode) break
    
    if (scanNode.type.name === 'citation') {
      toast.warning('Citation already exists shortly after this location')
      return { 
        success: false, 
        message: 'Citation already exists shortly after this location - skipping to prevent duplicate' 
      }
    }
    
    // If we hit actual text content (not just whitespace/punctuation), stop scanning
    if (scanNode.isText && scanNode.text && /[a-zA-Z0-9]/.test(scanNode.text)) {
      break
    }
    
    scanPos += scanNode.nodeSize
  }

  // Generate instanceId for this citation occurrence
  const instanceId = uuidv4()
  
  // Build citation node content (TipTap JSON format)
  const citationNode = {
    type: 'citation',
    attrs: {
      id: paperId,
      instanceId,
      citedContent: quote || undefined,
    }
  }
  
  // Include a space before the citation for readability
  const contentToInsert = [
    { type: 'text', text: ' ' },
    citationNode
  ]
  
  // Save citation instance to database (async, don't block)
  const effectiveProjectId = projectId || _globalProjectId
  if (effectiveProjectId) {
    saveCitationInstancesToDatabase(effectiveProjectId, [{
      instanceId,
      paperId,
      quote: quote || '',
    }])
  }

  // Insert the citation
  editor.chain()
    .focus()
    .setTextSelection(insertPos)
    .insertContent(contentToInsert)
    .run()
  
  toast.success('Citation added')
  return { 
    success: true, 
    message: 'Citation added',
    affectedRange: { from: insertPos, to: insertPos + 2 }, // Approximate range
  }
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
