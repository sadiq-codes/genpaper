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
import { canJoin } from '@tiptap/pm/transform'
import type { Mark as ProseMirrorMark } from '@tiptap/pm/model'
import { findBlockById } from '../extensions/BlockId'
import { toast } from 'sonner'
import { hasMarkdownFormatting, processAIContent, hasCitationMarkers, processPlainTextWithCitations } from '../utils/content-processor'
import { validatePositions } from '../utils/position-utils'
import { 
  findTextInStructure, 
  findSectionBounds, 
  matchToRange 
} from '../utils/structure-search'
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
  /** If true, suppresses individual undo history entries so this edit
   *  can be grouped with other AI edits into a single undo step. 
   *  Call finalizeUndoGroup(editor) after the last edit to commit the group. */
  groupUndo?: boolean
}

/** Citation instance for saving to database */
interface ExtractedCitationInstance {
  instanceId: string      // UUID for this specific citation instance
  paperId: string         // UUID of the paper being cited
  quote: string           // The exact quote/context for this citation
}

/** Citation entry from tool arguments (matches CitationEntry in document-tools.ts) */
interface CitationInput {
  index: number
  paperId: string
  quote: string
}

interface BlockTarget {
  found: boolean
  pos: number
  endPos: number
  blockId?: string
  method: 'blockId' | 'text' | 'section'
}

const MAX_SEARCH_REPLACE_MATCHES = 500
const SEARCH_REPLACE_BATCH_SIZE = 100

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

  // Strategy 2: Fall back to text search (structure-aware)
  if (args.searchPhrase) {
    const match = findTextInStructure(editor, args.searchPhrase, { 
      section: args.section 
    })

    if (match.found) {
      const range = matchToRange(match)
      if (range) {
        return {
          found: true,
          pos: range.from,
          endPos: range.to,
          method: 'text',
        }
      }
    }
  }

  // Strategy 3: Section-level targeting
  if (args.section) {
    const sectionBounds = findSectionBounds(editor, args.section)
    if (sectionBounds.found) {
      return {
        found: true,
        pos: sectionBounds.contentStartPos,
        endPos: sectionBounds.contentEndPos,
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

/**
 * Count exact text occurrences in a scoped range.
 * Used to detect ambiguous replace/delete/format targets.
 */
function countSearchPhraseMatchesInScope(
  editor: Editor,
  searchPhrase: string,
  options: { blockId?: string; section?: string } = {}
): number {
  const needle = searchPhrase.trim()
  if (!needle) return 0

  let from = 0
  let to = editor.state.doc.content.size

  if (options.blockId) {
    const block = findBlockById(editor, options.blockId)
    if (!block) return 0
    from = block.pos
    to = block.pos + block.node.nodeSize
  } else if (options.section) {
    const sectionBounds = findSectionBounds(editor, options.section)
    if (!sectionBounds.found) return 0
    from = sectionBounds.contentStartPos
    to = sectionBounds.contentEndPos
  }

  let count = 0
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText || !node.text) return
    let idx = 0
    while (true) {
      const found = node.text.indexOf(needle, idx)
      if (found === -1) break
      count += 1
      idx = found + 1
    }
  })
  return count
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
    let result: ToolExecutionResult

    // If we have a ghost edit ID, wrap execution to set the meta
    if (options.ghostEditId) {
      result = executeWithGhostMeta(editor, toolName, args, options.ghostEditId, papers, projectId)
    } else {
      result = dispatchTool(editor, toolName, args, papers, projectId)
    }

    return result
  } catch (error) {
    console.error(`[ToolExecutor] Error in ${toolName}:`, error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    toast.error(`Edit failed: ${message}`)
    return { success: false, message }
  }
}

/**
 * Execute multiple tool calls as a single undo group.
 * All edits will be undone/redone together with one Cmd+Z.
 * 
 * @param editor - TipTap editor instance
 * @param toolCalls - Array of { toolName, args } to execute
 * @param options - Shared execution options
 * @returns Array of results, one per tool call
 */
export function executeToolsAsUndoGroup(
  editor: Editor,
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
  options: ToolExecutionOptions = {}
): ToolExecutionResult[] {
  if (toolCalls.length === 0) return []
  if (toolCalls.length === 1) {
    return [executeDocumentTool(editor, toolCalls[0].toolName, toolCalls[0].args, options)]
  }

  const results: ToolExecutionResult[] = []
  const originalDispatch = editor.view.dispatch.bind(editor.view)

  // Wrap dispatch to suppress individual undo entries for all but the last edit
  let editIndex = 0
  const totalEdits = toolCalls.length

  editor.view.dispatch = (tr) => {
    if (tr.docChanged && editIndex < totalEdits - 1) {
      // Suppress intermediate history entries — they'll be grouped with the final one
      tr.setMeta('addToHistory', false)
    }
    // Ghost edit meta if applicable
    if (tr.docChanged && options.ghostEditId) {
      tr.setMeta('ghostEditAccepted', options.ghostEditId)
    }
    return originalDispatch(tr)
  }

  try {
    const papers = options.papers || _globalPapersContext
    const projectId = options.projectId || _globalProjectId

    for (const call of toolCalls) {
      const result = dispatchTool(editor, call.toolName, call.args, papers, projectId)
      results.push(result)
      editIndex++
    }
  } finally {
    editor.view.dispatch = originalDispatch
  }

  return results
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
    case 'replaceInSection': // Legacy fallback — routes to replaceBlock
      return executeReplaceBlock(editor, args, papers, projectId)
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
    case 'moveBlock':
      return executeMoveBlock(editor, args)
    case 'mergeBlocks':
      return executeMergeBlocks(editor, args)
    case 'splitBlock':
      return executeSplitBlock(editor, args)
    case 'formatText':
      return executeFormatText(editor, args)
    case 'insertTable':
      return executeInsertTable(editor, args)
    case 'searchAndReplace':
      return executeSearchAndReplace(editor, args)
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
 * Uses the citations array from tool arguments to map numbers to paper IDs
 * 
 * Each citation occurrence gets a unique instanceId for tracking the specific quote used.
 * 
 * STRICT MODE: If content has [N] markers but no citations array, markers are STRIPPED.
 */
function convertNumberedCitations(
  content: string, 
  citations?: CitationInput[]
): { content: string; instances: ExtractedCitationInstance[] } {
  // Check if content has numbered markers [1], [2], etc. (but not things like [E1], [M1])
  const numberedMarkerPattern = /\[(\d+)\]/g
  const numberedMarkers = content.match(numberedMarkerPattern)
  const hasNumberedMarkers = numberedMarkers && numberedMarkers.length > 0
  
  if (!hasNumberedMarkers) {
    // No numbered markers - nothing to convert
    return { content, instances: [] }
  }
  
  if (!citations || citations.length === 0) {
    // STRICT: Content has [N] markers but NO citations array
    const uniqueMarkers = [...new Set(numberedMarkers)]
    console.warn('[ToolExecutor] ⚠️ CITATION FORMAT ERROR: Content has numbered markers but NO citations array!')
    console.warn(`[ToolExecutor] Found markers: ${uniqueMarkers.join(', ')}`)
    console.warn('[ToolExecutor] These markers will be STRIPPED. AI must include citations parameter.')
    
    // Strip all numbered markers since we can't map them to papers
    const stripped = content.replace(numberedMarkerPattern, '')
    return { content: stripped, instances: [] }
  }
  
  // UUID format pattern for validation
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  
  // Build map from index to citation data, validating UUIDs
  const citationsMap = new Map<number, { paperId: string; quote: string }>()
  const invalidCitations: Array<{ index: number; paperId: string; reason: string }> = []
  
  for (const citation of citations) {
    if (!UUID_PATTERN.test(citation.paperId)) {
      invalidCitations.push({ index: citation.index, paperId: citation.paperId, reason: 'malformed UUID format' })
      continue
    }
    citationsMap.set(citation.index, { paperId: citation.paperId, quote: citation.quote || '' })
  }
  
  // Log invalid citations
  if (invalidCitations.length > 0) {
    console.warn(`[ToolExecutor] ⚠️ Rejected ${invalidCitations.length} citation(s) with invalid paper_id format:`)
    for (const { index, paperId, reason } of invalidCitations) {
      console.warn(`  [${index}] paper_id: "${paperId}" - ${reason}`)
    }
  }
  
  if (citationsMap.size === 0) {
    console.log('[ToolExecutor] All citations rejected - stripping markers')
    return { content: content.replace(numberedMarkerPattern, ''), instances: [] }
  }
  
  console.log(`[ToolExecutor] Converting ${citationsMap.size} citation types:`, 
    Array.from(citationsMap.entries()).map(([i, c]) => `[${i}] -> ${c.paperId}`)
  )
  
  let result = content
  const instances: ExtractedCitationInstance[] = []
  
  // Replace each [N] marker with [@paperId#instanceId]
  // Each occurrence gets a unique instanceId
  for (const [index, { paperId, quote }] of citationsMap) {
    const pattern = new RegExp(`\\[${index}\\]`, 'g')
    
    result = result.replace(pattern, () => {
      const instanceId = uuidv4()
      
      // Track this instance for DB insertion
      instances.push({
        instanceId,
        paperId,
        quote,
      })
      
      return `[@${paperId}#${instanceId}]`
    })
  }
  
  // Strip any orphaned [N] markers that weren't in the citations array
  result = result.replace(/\[(\d+)\]/g, '')
  
  console.log(`[ToolExecutor] Converted to ${instances.length} instances with [@paperId#instanceId] format`)
  
  return { content: result, instances }
}

/**
 * Result of preparing content for insertion
 * content can be:
 * - string: raw text content
 * - Record<string, unknown>: TipTap doc content object
 * - unknown[]: array of TipTap nodes (from processPlainTextWithCitations)
 */
interface PreparedContent {
  content: string | Record<string, unknown> | unknown[]
  instances: ExtractedCitationInstance[]
}

/**
 * Prepare content for insertion - converts markdown to TipTap JSON if needed
 * @param content - Raw content string
 * @param papers - Papers context for citation resolution
 * @param citations - Structured citations from tool arguments
 */
function prepareContent(
  content: string, 
  papers: ProjectPaper[] = [],
  citations?: CitationInput[]
): PreparedContent {
  // First, convert numbered [1], [2] citations to [@paperId#instanceId] format
  const { content: contentWithCitations, instances } = convertNumberedCitations(content, citations)
  
  // Use provided papers or fall back to global context
  const papersContext = papers.length > 0 ? papers : _globalPapersContext

  if (hasMarkdownFormatting(contentWithCitations)) {
    // Convert markdown to TipTap JSON for proper rendering (tables, lists, etc.)
    const doc = processAIContent(contentWithCitations, papersContext)
    // Return the content array, not the full doc wrapper
    return { content: doc.content || contentWithCitations, instances }
  }

  // If the content isn't markdown but includes citation markers like [@paperId#...],
  // convert those markers into proper TipTap citation nodes so they render consistently
  // (and get numbered for numeric styles).
  if (hasCitationMarkers(contentWithCitations)) {
    const fragment = processPlainTextWithCitations(contentWithCitations, papersContext)
    return { content: fragment, instances }
  }

  return { content: contentWithCitations, instances }
}

// =============================================================================
// INLINE-AWARE CONTENT HELPERS
// =============================================================================

/**
 * Check if a position is inside a paragraph (inline context) vs. at a block boundary.
 * If from/to are within the same paragraph, the edit is inline.
 */
function isInlineContext(editor: Editor, from: number, to: number): boolean {
  const $from = editor.state.doc.resolve(from)
  const $to = editor.state.doc.resolve(to)

  // Both positions inside the same paragraph = inline edit
  if ($from.parent.type.name === 'paragraph' && $from.parent === $to.parent) {
    return true
  }

  // Selection doesn't span the full parent node = inline edit
  if ($from.parent.type.name === 'paragraph') {
    const parentStart = $from.start($from.depth)
    const parentEnd = $from.end($from.depth)
    if (from > parentStart || to < parentEnd) {
      return true
    }
  }

  return false
}

/**
 * Flatten block-level TipTap JSON content to inline nodes.
 * Strips paragraph/heading wrappers and returns just the inline content array.
 * 
 * For a single paragraph like { type: 'paragraph', content: [{ type: 'text', text: '...' }] },
 * returns [{ type: 'text', text: '...' }].
 * 
 * For multiple paragraphs, joins their inline content with space separators.
 * Preserves non-paragraph blocks as-is (lists, tables, etc.) — those are truly block-level.
 */
function flattenToInline(content: unknown): unknown {
  if (!content) return content
  if (typeof content === 'string') return content

  const nodes = Array.isArray(content) ? content : [content]
  
  // Check if all nodes are paragraph/heading (pure text blocks)
  const allParagraphLike = nodes.every(
    (n: any) => n.type === 'paragraph' || n.type === 'heading'
  )

  if (!allParagraphLike) {
    // Has real block content (lists, tables, etc.) — can't flatten, return as-is
    return content
  }

  // Extract inline content from each paragraph, join with spaces
  const inlineNodes: any[] = []

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as any
    if (node.content && Array.isArray(node.content)) {
      if (inlineNodes.length > 0) {
        // Add space separator between paragraphs
        inlineNodes.push({ type: 'text', text: ' ' })
      }
      inlineNodes.push(...node.content)
    }
  }

  return inlineNodes.length > 0 ? inlineNodes : content
}

/**
 * Prepare content with inline awareness.
 * If the target is mid-paragraph, strips paragraph wrappers to prevent sentence breaks.
 */
function prepareContentForContext(
  editor: Editor,
  rawContent: string,
  from: number,
  to: number,
  papers: ProjectPaper[],
  citations?: CitationInput[]
): PreparedContent {
  const prepared = prepareContent(rawContent, papers, citations)
  const inline = isInlineContext(editor, from, to)

  if (inline && typeof prepared.content !== 'string') {
    prepared.content = flattenToInline(prepared.content) as any
  }

  return prepared
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
  
  // Notify user of failure
  toast.error('Failed to save citation data', {
    description: 'Your citations are preserved in the document but metadata may be incomplete.',
    duration: 5000,
  })
  
  // Store failed instances in localStorage for recovery on next page load
  if (typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem('failedCitationInstances')
      const failedQueue = stored ? JSON.parse(stored) : []
      failedQueue.push({ projectId, instances, timestamp: Date.now() })
      // Keep only last 50 failed saves to prevent localStorage bloat
      if (failedQueue.length > 50) failedQueue.shift()
      localStorage.setItem('failedCitationInstances', JSON.stringify(failedQueue))
      console.log('[ToolExecutor] Queued failed citation instances for recovery')
    } catch {
      // localStorage not available or corrupted data, silently fail
    }
  }
}

/**
 * Process failed citation saves from localStorage queue.
 * Called on editor mount to recover from previous failures.
 * 
 * - Retries each failed batch once
 * - Removes successful or expired entries (>24h old)
 * - Keeps failed entries for next attempt
 */
export async function processFailedCitationQueue(): Promise<void> {
  if (typeof localStorage === 'undefined') return
  
  try {
    const failedQueue = JSON.parse(localStorage.getItem('failedCitationInstances') || '[]') as Array<{
      projectId: string
      instances: ExtractedCitationInstance[]
      timestamp: number
    }>
    
    if (failedQueue.length === 0) return
    
    console.log(`[ToolExecutor] Processing ${failedQueue.length} failed citation batches from queue`)
    
    const now = Date.now()
    const ONE_DAY = 24 * 60 * 60 * 1000
    const remainingQueue: typeof failedQueue = []
    
    for (const entry of failedQueue) {
      // Skip entries older than 24 hours - they're likely stale
      if (now - entry.timestamp > ONE_DAY) {
        console.log(`[ToolExecutor] Dropping expired citation batch (${Math.round((now - entry.timestamp) / 3600000)}h old)`)
        continue
      }
      
      // Attempt to save
      try {
        const response = await fetch('/api/citation-instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: entry.projectId,
            instances: entry.instances.map(inst => ({
              id: inst.instanceId,
              paperId: inst.paperId,
              quote: inst.quote,
            }))
          })
        })
        
        if (response.ok) {
          console.log(`[ToolExecutor] Successfully recovered ${entry.instances.length} citation instances`)
        } else {
          // Keep for next attempt
          remainingQueue.push(entry)
        }
      } catch {
        // Network error - keep for next attempt
        remainingQueue.push(entry)
      }
    }
    
    // Update queue with remaining entries
    if (remainingQueue.length > 0) {
      localStorage.setItem('failedCitationInstances', JSON.stringify(remainingQueue))
      console.log(`[ToolExecutor] ${remainingQueue.length} citation batches still pending recovery`)
    } else {
      localStorage.removeItem('failedCitationInstances')
      console.log('[ToolExecutor] Citation recovery queue cleared')
    }
  } catch (error) {
    console.warn('[ToolExecutor] Error processing citation recovery queue:', error)
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
  const citations = args.citations as CitationInput[] | undefined
  const afterBlockId = args.afterBlockId as string | undefined || args.blockId as string | undefined
  const afterPhrase = args.afterPhrase as string | undefined
  const location = args.location as string | undefined

  if (!rawContent) {
    return { success: false, message: 'No content provided' }
  }

  const effectiveProjectId = projectId || _globalProjectId
  const persistCitationInstances = (instances: ExtractedCitationInstance[]) => {
    if (effectiveProjectId && instances.length > 0) {
      saveCitationInstancesToDatabase(effectiveProjectId, instances)
    }
  }

  // Priority 1: Insert after specific phrase (most precise)
  if (afterPhrase) {
    const match = findTextInStructure(editor, afterPhrase)

    if (!match.found) {
      const message = `Could not find phrase for insertion: "${afterPhrase.slice(0, 50)}..."`
      toast.error(message)
      return { success: false, message }
    }

    const range = matchToRange(match)
    if (!range) {
      return { success: false, message: 'Failed to calculate insertion range' }
    }

    const insertPos = range.to

    // Prepare content with inline awareness for phrase insertions
    const { content, instances } = prepareContentForContext(
      editor, rawContent, insertPos, insertPos, papers, citations
    )
    const isMarkdown = typeof content !== 'string'

    // Determine if we need a space before/after inline content
    let contentToInsert = content
    if (!isMarkdown && typeof content === 'string' && match.node) {
      const nodeContentSize = match.node.content.size
      const charBefore = match.endOffset > 0
        ? match.node.textBetween(Math.max(0, match.endOffset - 1), match.endOffset)
        : ''
      const charAfter = match.endOffset < nodeContentSize
        ? match.node.textBetween(match.endOffset, Math.min(match.endOffset + 1, nodeContentSize))
        : ''
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

    persistCitationInstances(instances)
    toast.success('Content inserted after phrase')
    return { success: true, message: 'Inserted after phrase' }
  }

  // Prepare content for non-inline insertion paths
  const { content, instances } = prepareContent(rawContent, papers, citations)

  // Priority 2: Insert after specific block
  if (afterBlockId) {
    const block = findBlockById(editor, afterBlockId)
    if (!block) {
      const message = `Block not found for insertion: ${afterBlockId}`
      toast.error(message)
      return { success: false, message }
    }

    const insertPos = block.pos + block.node.nodeSize
    editor.chain()
      .focus()
      .setTextSelection(insertPos)
      .insertContent(content)
      .run()

    persistCitationInstances(instances)
    toast.success('Content inserted')
    return { success: true, message: `Inserted after block ${afterBlockId}`, blockId: afterBlockId }
  }

  // Priority 3: Explicit location targeting
  if (location) {
    if (location === 'cursor') {
      editor.chain().focus().insertContent(content).run()
      persistCitationInstances(instances)
      toast.success('Content inserted at cursor')
      return { success: true, message: 'Inserted at cursor' }
    }

    if (location === 'end') {
      editor.chain()
        .focus()
        .setTextSelection(editor.state.doc.content.size)
        .insertContent(content)
        .run()
      persistCitationInstances(instances)
      toast.success('Content appended')
      return { success: true, message: 'Appended to document' }
    }

    const afterMatch = location.match(/^after:(.+)$/i)
    const startMatch = location.match(/^start:(.+)$/i)

    if (afterMatch) {
      const sectionName = afterMatch[1]
      const sectionBounds = findSectionBounds(editor, sectionName)

      if (!sectionBounds.found) {
        const message = `Section "${sectionName}" not found`
        toast.error(message)
        return { success: false, message }
      }

      const insertPos = sectionBounds.contentEndPos
      editor.chain().focus().setTextSelection(insertPos).insertContent(content).run()
      persistCitationInstances(instances)
      toast.success(`Content added to ${sectionName}`)
      return { success: true, message: `Inserted at end of ${sectionName}` }
    }

    if (startMatch) {
      const sectionName = startMatch[1]
      const sectionBounds = findSectionBounds(editor, sectionName)

      if (!sectionBounds.found) {
        const message = `Section "${sectionName}" not found`
        toast.error(message)
        return { success: false, message }
      }

      const insertPos = sectionBounds.contentStartPos
      editor.chain().focus().setTextSelection(insertPos).insertContent(content).run()
      persistCitationInstances(instances)
      toast.success(`Content added to ${sectionName}`)
      return { success: true, message: `Inserted at start of ${sectionName}` }
    }

    const message = `Invalid insert location: ${location}`
    toast.error(message)
    return { success: false, message }
  }

  // No explicit target: insert at cursor
  editor.chain().focus().insertContent(content).run()
  persistCitationInstances(instances)
  toast.success('Content inserted at cursor')
  return { success: true, message: 'Inserted at cursor' }
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
  const citations = args.citations as CitationInput[] | undefined

  if (!rawContent) {
    return { success: false, message: 'No new content provided' }
  }

  // If searchPhrase is provided, do text-level replacement
  if (searchPhrase) {
    if (!blockId) {
      const matchCount = countSearchPhraseMatchesInScope(editor, searchPhrase, { section })
      if (matchCount > 1) {
        const message = `Multiple matches found for "${searchPhrase.slice(0, 50)}...". Provide blockId for precise replacement.`
        toast.error(message)
        return { success: false, message }
      }
    }

    // Use structure-aware search - can scope to blockId if provided
    const match = findTextInStructure(editor, searchPhrase, { blockId, section })
    
    if (!match.found) {
      const message = `Could not find text: "${searchPhrase.slice(0, 50)}..."`
      toast.error(message)
      return { success: false, message }
    }

    // Log if we found it but in a different block than specified
    if (blockId && match.blockId && match.blockId !== blockId) {
      console.warn(`[ToolExecutor] Text found in block ${match.blockId}, not specified block ${blockId}`)
    }

    const range = matchToRange(match)
    if (!range) {
      return { success: false, message: 'Failed to calculate edit range' }
    }
    const rawFrom = range.from
    const rawTo = range.to

    // Validate positions before edit
    const validated = validateEditRange(editor, rawFrom, rawTo)
    if ('error' in validated) {
      toast.error(validated.error)
      return { success: false, message: validated.error }
    }
    const { from, to } = validated

    // Prepare content with inline awareness — prevents mid-sentence paragraph splits
    const { content: newContent, instances } = prepareContentForContext(
      editor, rawContent, from, to, papers, citations
    )

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

  // No searchPhrase → replace entire block (block-level, no inline flattening)
  const { content: blockContent, instances: blockInstances } = prepareContent(rawContent, papers, citations)

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
    .insertContent(blockContent)
    .run()
  
  // Save citation instances (async, don't block)
  const effectiveProjectId2 = projectId || _globalProjectId
  if (blockInstances.length > 0 && effectiveProjectId2) {
    saveCitationInstancesToDatabase(effectiveProjectId2, blockInstances)
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
function _executeReplaceInSection(
  editor: Editor,
  args: Record<string, unknown>,
  papers: ProjectPaper[] = [],
  projectId?: string
): ToolExecutionResult {
  const section = args.section as string
  const searchPhrase = args.searchPhrase as string
  const rawContent = args.newContent as string
  const citations = args.citations as CitationInput[] | undefined

  if (!searchPhrase || !rawContent) {
    return { success: false, message: 'Missing search phrase or new content' }
  }

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

  // Prepare content with inline awareness — prevents mid-sentence paragraph splits
  const { content: newContent, instances } = prepareContentForContext(
    editor, rawContent, validated.from, validated.to, papers, citations
  )

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
  const citations = args.citations as CitationInput[] | undefined

  if (!sectionName || !rawContent) {
    return { success: false, message: 'Missing section name or new content' }
  }

  // Prepare content - convert markdown to TipTap JSON if needed
  const { content: newContent, instances } = prepareContent(rawContent, papers, citations)

  const sectionBounds = findSectionBounds(editor, sectionName)

  if (!sectionBounds.found) {
    toast.error(`Section "${sectionName}" not found`)
    return { success: false, message: `Section "${sectionName}" not found` }
  }

  const rawFrom = sectionBounds.contentStartPos
  const rawTo = sectionBounds.contentEndPos

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
    if (!blockId) {
      const matchCount = countSearchPhraseMatchesInScope(editor, searchPhrase, { section })
      if (matchCount > 1) {
        const message = `Multiple matches found for "${searchPhrase.slice(0, 50)}...". Provide blockId for precise deletion.`
        toast.error(message)
        return { success: false, message }
      }
    }

    // Use structure-aware search - can scope to blockId if provided
    const match = findTextInStructure(editor, searchPhrase, { blockId, section })
    
    if (!match.found) {
      const message = `Could not find text: "${searchPhrase.slice(0, 50)}..."`
      toast.error(message)
      return { success: false, message }
    }

    // Log if we found it but in a different block than specified
    if (blockId && match.blockId && match.blockId !== blockId) {
      console.warn(`[ToolExecutor] Text found in block ${match.blockId}, not specified block ${blockId}`)
    }

    // Calculate actual document positions
    const range = matchToRange(match)
    if (!range) {
      return { success: false, message: 'Failed to calculate edit range' }
    }
    const rawFrom = range.from
    const rawTo = range.to

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
  
  if (!quote || !quote.trim()) {
    return { success: false, message: 'Missing quote - addCitation requires an exact supporting quote' }
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
    
    // Use structure-aware search scoped to the block (handles citation atoms correctly)
    const match = findTextInStructure(editor, afterPhrase, { blockId })
    if (!match.found) {
      const preview = afterPhrase.slice(0, 50)
      toast.error(`Could not find text in block: "${preview}..."`)
      return { success: false, message: `Could not find text in block: "${preview}..."` }
    }
    
    const range = matchToRange(match)
    if (!range) {
      return { success: false, message: 'Failed to calculate citation position' }
    }
    insertPos = range.to
  } else {
    // No blockId, search entire document using structure-aware search
    const match = findTextInStructure(editor, afterPhrase)
    
    if (!match.found) {
      const preview = afterPhrase.slice(0, 50)
      toast.error(`Could not find text: "${preview}..."`)
      return { success: false, message: `Could not find text: "${preview}..."` }
    }
    
    const range = matchToRange(match)
    if (!range) {
      return { success: false, message: 'Failed to calculate citation position' }
    }
    insertPos = range.to
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

  // Avoid repeating the same paper citation in the same block.
  let textBlockDepth = resolvedPos.depth
  while (textBlockDepth > 0 && !resolvedPos.node(textBlockDepth).isTextblock) {
    textBlockDepth -= 1
  }
  if (textBlockDepth > 0) {
    const blockPos = resolvedPos.before(textBlockDepth)
    const blockNode = editor.state.doc.nodeAt(blockPos)
    let hasSamePaperCitationInBlock = false
    blockNode?.descendants((node) => {
      if (node.type.name === 'citation' && node.attrs.id === paperId) {
        hasSamePaperCitationInBlock = true
        return false
      }
      return true
    })
    if (hasSamePaperCitationInBlock) {
      const message = 'Citation to this paper already exists in this block'
      toast.warning(message)
      return { success: false, message }
    }
  }

  // Generate instanceId for this citation occurrence
  const instanceId = uuidv4()
  
  // Build citation node content (TipTap JSON format)
  const citationNode = {
    type: 'citation',
    attrs: {
      id: paperId,
      instanceId,
      citedContent: quote.trim(),
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
      quote: quote.trim(),
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
    const match = findTextInStructure(editor, searchPhrase, { blockId, section })
    
    if (!match.found) {
      const message = `Could not find text to highlight: "${searchPhrase.slice(0, 50)}..."`
      toast.error(message)
      return { success: false, message }
    }

    const range = matchToRange(match)
    if (!range) {
      return { success: false, message: 'Failed to calculate highlight range' }
    }
    from = range.from
    to = range.to
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

  let usedSelectionFallback = false
  // Apply highlight if extension is available
  if (editor.can().setHighlight({ color })) {
    editor.chain()
      .focus()
      .setTextSelection({ from, to })
      .setHighlight({ color })
      .run()
  } else {
    // Fallback: just select the text
    usedSelectionFallback = true
    editor.chain()
      .focus()
      .setTextSelection({ from, to })
      .run()
  }

  if (usedSelectionFallback) {
    toast.warning('Highlight extension unavailable - selected text only')
  } else if (comment) {
    toast.info(comment, { duration: 5000 })
  } else {
    toast.success('Text highlighted')
  }

  return { 
    success: true, 
    message: usedSelectionFallback
      ? 'Highlight unavailable; selected target text only'
      : (comment || 'Text highlighted'),
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

  toast.info(`AI note (not saved): ${comment}`, { duration: 8000 })
  return { success: true, message: 'Temporary note shown (not persisted)' }
}

// =============================================================================
// NEW TOOL IMPLEMENTATIONS
// =============================================================================

/**
 * Move a block from one location to another atomically.
 * Extracts the content first, then deletes + inserts in one chain.
 */
function executeMoveBlock(
  editor: Editor,
  args: Record<string, unknown>
): ToolExecutionResult {
  const blockId = args.blockId as string | undefined
  const searchPhrase = args.searchPhrase as string | undefined
  const section = args.section as string | undefined
  const targetLocation = args.targetLocation as string

  if (!targetLocation) {
    return { success: false, message: 'No target location specified' }
  }

  // Resolve source as a full block (never a partial text range).
  let source: { pos: number; endPos: number } | null = null
  if (blockId) {
    const block = findBlockById(editor, blockId)
    if (!block) {
      const message = `Block not found: ${blockId}`
      toast.error(message)
      return { success: false, message }
    }
    source = { pos: block.pos, endPos: block.pos + block.node.nodeSize }
  } else if (searchPhrase) {
    const match = findTextInStructure(editor, searchPhrase, { section })
    if (!match.found) {
      const message = `Could not find text: "${searchPhrase.slice(0, 50)}..."`
      toast.error(message)
      return { success: false, message }
    }

    if (match.blockId) {
      const block = findBlockById(editor, match.blockId)
      if (block) {
        source = { pos: block.pos, endPos: block.pos + block.node.nodeSize }
      }
    }

    if (!source) {
      const range = matchToRange(match)
      if (!range) {
        return { success: false, message: 'Failed to resolve source block for move' }
      }

      const $from = editor.state.doc.resolve(range.from)
      let textBlockDepth = $from.depth
      while (textBlockDepth > 0 && !$from.node(textBlockDepth).isTextblock) {
        textBlockDepth -= 1
      }
      if (textBlockDepth <= 0) {
        return { success: false, message: 'Could not resolve source block for move' }
      }
      const sourcePos = $from.before(textBlockDepth)
      const sourceNode = editor.state.doc.nodeAt(sourcePos)
      if (!sourceNode) {
        return { success: false, message: 'Could not resolve source block for move' }
      }
      source = { pos: sourcePos, endPos: sourcePos + sourceNode.nodeSize }
    }
  } else {
    return { success: false, message: 'moveBlock requires blockId or searchPhrase' }
  }

  // Extract the content before deleting
  const sourceSlice = editor.state.doc.slice(source.pos, source.endPos)

  // Determine target insertion position
  let insertPos: number | null = null

  const afterBlockMatch = targetLocation.match(/^after:(.+)$/i)
  const endOfSectionMatch = targetLocation.match(/^endOfSection:(.+)$/i)
  const startOfSectionMatch = targetLocation.match(/^startOfSection:(.+)$/i)

  if (afterBlockMatch) {
    const targetBlockId = afterBlockMatch[1]
    const targetBlock = findBlockById(editor, targetBlockId)
    if (targetBlock) {
      insertPos = targetBlock.pos + targetBlock.node.nodeSize
    } else {
      toast.error(`Target block not found: ${targetBlockId}`)
      return { success: false, message: `Target block not found: ${targetBlockId}` }
    }
  } else if (endOfSectionMatch) {
    const sectionBounds = findSectionBounds(editor, endOfSectionMatch[1])
    if (sectionBounds.found) {
      insertPos = sectionBounds.contentEndPos
    } else {
      toast.error(`Section not found: ${endOfSectionMatch[1]}`)
      return { success: false, message: `Section not found: ${endOfSectionMatch[1]}` }
    }
  } else if (startOfSectionMatch) {
    const sectionBounds = findSectionBounds(editor, startOfSectionMatch[1])
    if (sectionBounds.found) {
      insertPos = sectionBounds.contentStartPos
    } else {
      toast.error(`Section not found: ${startOfSectionMatch[1]}`)
      return { success: false, message: `Section not found: ${startOfSectionMatch[1]}` }
    }
  } else if (targetLocation === 'end') {
    insertPos = editor.state.doc.content.size
  }

  if (insertPos === null) {
    toast.error(`Invalid target location: ${targetLocation}`)
    return { success: false, message: `Invalid target location: ${targetLocation}` }
  }

  // Atomic move: delete source, then insert at target
  // If target is after source, adjust position for the deletion
  const adjustedInsertPos = insertPos > source.endPos
    ? insertPos - (source.endPos - source.pos)
    : insertPos

  const { state, view } = editor
  const tr = state.tr

  // Delete the source block first
  tr.delete(source.pos, source.endPos)
  // Insert the content at the adjusted position
  tr.insert(adjustedInsertPos, sourceSlice.content)

  view.dispatch(tr)

  toast.success('Content moved')
  return { success: true, message: `Moved content to ${targetLocation}` }
}

/**
 * Merge two adjacent blocks into a single block.
 */
function executeMergeBlocks(
  editor: Editor,
  args: Record<string, unknown>
): ToolExecutionResult {
  const firstBlockId = args.firstBlockId as string | undefined
  const secondBlockId = args.secondBlockId as string | undefined
  const searchPhrase = args.searchPhrase as string | undefined
  const section = args.section as string | undefined

  const mergeAtBoundary = (boundaryPos: number, message: string): ToolExecutionResult => {
    if (!canJoin(editor.state.doc, boundaryPos)) {
      toast.error('Selected blocks cannot be structurally merged')
      return { success: false, message: 'Blocks are not mergeable in current document structure' }
    }

    const tr = editor.state.tr.join(boundaryPos)
    editor.view.dispatch(tr)
    toast.success('Blocks merged')
    return { success: true, message }
  }

  if (firstBlockId && secondBlockId) {
    const firstBlock = findBlockById(editor, firstBlockId)
    const secondBlock = findBlockById(editor, secondBlockId)

    if (!firstBlock) {
      const message = `First block not found: ${firstBlockId}`
      toast.error(message)
      return { success: false, message }
    }
    if (!secondBlock) {
      const message = `Second block not found: ${secondBlockId}`
      toast.error(message)
      return { success: false, message }
    }

    const [left, right] = firstBlock.pos <= secondBlock.pos
      ? [firstBlock, secondBlock]
      : [secondBlock, firstBlock]

    const boundaryPos = left.pos + left.node.nodeSize
    if (right.pos !== boundaryPos) {
      toast.error('Blocks are not adjacent')
      return { success: false, message: 'Blocks are not adjacent — they must be consecutive to merge' }
    }

    return mergeAtBoundary(boundaryPos, 'Merged two adjacent blocks')
  }

  if (searchPhrase) {
    const match = findTextInStructure(editor, searchPhrase, { section })
    if (!match.found) {
      const message = `Could not find text: "${searchPhrase.slice(0, 50)}..."`
      toast.error(message)
      return { success: false, message }
    }

    let sourcePos: number | null = null
    let sourceNodeSize: number | null = null

    if (match.blockId) {
      const block = findBlockById(editor, match.blockId)
      if (block) {
        sourcePos = block.pos
        sourceNodeSize = block.node.nodeSize
      }
    }

    if (sourcePos === null || sourceNodeSize === null) {
      const range = matchToRange(match)
      if (!range) {
        return { success: false, message: 'Failed to calculate merge range' }
      }

      const $from = editor.state.doc.resolve(range.from)
      let textBlockDepth = $from.depth
      while (textBlockDepth > 0 && !$from.node(textBlockDepth).isTextblock) {
        textBlockDepth -= 1
      }

      if (textBlockDepth <= 0) {
        return { success: false, message: 'Could not locate a text block to merge' }
      }

      sourcePos = $from.before(textBlockDepth)
      const sourceNode = editor.state.doc.nodeAt(sourcePos)
      if (!sourceNode) {
        return { success: false, message: 'Could not resolve source block for merge' }
      }
      sourceNodeSize = sourceNode.nodeSize
    }

    const boundaryPos = sourcePos + sourceNodeSize
    const nextNode = editor.state.doc.nodeAt(boundaryPos)
    if (!nextNode) {
      return { success: false, message: 'No block after this one to merge with' }
    }

    return mergeAtBoundary(boundaryPos, 'Merged source block with next block')
  }

  return { success: false, message: 'Provide firstBlockId+secondBlockId or searchPhrase' }
}


/**
 * Split a block into two at a specified phrase.
 */
function executeSplitBlock(
  editor: Editor,
  args: Record<string, unknown>
): ToolExecutionResult {
  const blockId = args.blockId as string | undefined
  const splitAfterPhrase = args.splitAfterPhrase as string
  const section = args.section as string | undefined

  if (!splitAfterPhrase) {
    return { success: false, message: 'Missing splitAfterPhrase' }
  }

  // Find the phrase in the document
  const match = findTextInStructure(editor, splitAfterPhrase, { blockId, section })
  if (!match.found) {
    toast.error(`Could not find text: "${splitAfterPhrase.slice(0, 50)}..."`)
    return { success: false, message: `Could not find text: "${splitAfterPhrase.slice(0, 50)}..."` }
  }

  const range = matchToRange(match)
  if (!range) {
    return { success: false, message: 'Failed to calculate split position' }
  }

  const resolved = editor.state.doc.resolve(range.to)
  if (!resolved.parent.isTextblock || resolved.parent.type.name !== 'paragraph') {
    return { success: false, message: 'splitBlock is only supported for paragraph text blocks' }
  }
  const parentStart = resolved.start(resolved.depth)
  const parentEnd = resolved.end(resolved.depth)
  if (range.to <= parentStart || range.to >= parentEnd) {
    return { success: false, message: 'Split position must be inside paragraph content' }
  }

  // Set cursor at the end of the phrase, then split the block
  editor.chain()
    .focus()
    .setTextSelection(range.to)
    .splitBlock()
    .run()

  toast.success('Block split into two')
  return { success: true, message: 'Split block into two paragraphs', affectedRange: { from: range.to, to: range.to } }
}

/**
 * Apply inline formatting to specific text.
 */
function executeFormatText(
  editor: Editor,
  args: Record<string, unknown>
): ToolExecutionResult {
  const searchPhrase = args.searchPhrase as string
  const blockId = args.blockId as string | undefined
  const section = args.section as string | undefined
  const format = args.format as string
  const remove = args.remove as boolean | undefined

  if (!searchPhrase || !format) {
    return { success: false, message: 'Missing searchPhrase or format' }
  }

  // Find the text
  const match = findTextInStructure(editor, searchPhrase, { blockId, section })
  if (!match.found) {
    toast.error(`Could not find text: "${searchPhrase.slice(0, 50)}..."`)
    return { success: false, message: `Could not find text: "${searchPhrase.slice(0, 50)}..."` }
  }

  const range = matchToRange(match)
  if (!range) {
    return { success: false, message: 'Failed to calculate format range' }
  }

  const matchCount = countSearchPhraseMatchesInScope(editor, searchPhrase, { blockId, section })
  const firstOnlyWarning = matchCount > 1

  // Map format name to TipTap command
  const chain = editor.chain().focus().setTextSelection({ from: range.from, to: range.to })

  if (remove) {
    switch (format) {
      case 'bold': chain.unsetBold(); break
      case 'italic': chain.unsetItalic(); break
      case 'underline': chain.unsetUnderline(); break
      case 'strikethrough': chain.unsetStrike(); break
      case 'code': chain.unsetCode(); break
      default:
        return { success: false, message: `Unknown format: ${format}` }
    }
  } else {
    switch (format) {
      case 'bold': chain.setBold(); break
      case 'italic': chain.setItalic(); break
      case 'underline': chain.setUnderline(); break
      case 'strikethrough': chain.setStrike(); break
      case 'code': chain.setCode(); break
      default:
        return { success: false, message: `Unknown format: ${format}` }
    }
  }

  chain.run()

  const action = remove ? 'Removed' : 'Applied'
  const message = firstOnlyWarning
    ? `${action} ${format} (first match only; ${matchCount} matches found)`
    : `${action} ${format}`
  if (firstOnlyWarning) {
    toast.warning(message)
  } else {
    toast.success(`${action} ${format} formatting`)
  }
  return { success: true, message, affectedRange: { from: range.from, to: range.to } }
}

/**
 * Insert a structured table.
 */
function executeInsertTable(
  editor: Editor,
  args: Record<string, unknown>
): ToolExecutionResult {
  const headers = args.headers as string[]
  const rows = args.rows as string[][]
  const caption = args.caption as string | undefined
  const afterBlockId = args.afterBlockId as string | undefined
  const location = args.location as string | undefined

  if (!headers || headers.length === 0) {
    return { success: false, message: 'No headers provided' }
  }

  if (!Array.isArray(rows)) {
    return { success: false, message: 'Rows must be an array' }
  }

  const mismatchedRow = rows.findIndex(row => !Array.isArray(row) || row.length !== headers.length)
  if (mismatchedRow !== -1) {
    const message = `Row ${mismatchedRow + 1} has ${rows[mismatchedRow]?.length || 0} cells; expected ${headers.length}`
    toast.error(message)
    return { success: false, message }
  }

  // Build TipTap table JSON
  const headerCells = headers.map(h => ({
    type: 'tableHeader',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: h }] }]
  }))

  const bodyRows = rows.map(row => ({
    type: 'tableRow',
    content: headers.map((_, colIdx) => ({
      type: 'tableCell',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: row[colIdx] || '' }] }]
    }))
  }))

  const tableContent: unknown[] = [
    { type: 'tableRow', content: headerCells },
    ...bodyRows,
  ]

  const contentToInsert: unknown[] = []

  if (caption) {
    contentToInsert.push({
      type: 'paragraph',
      content: [{ type: 'text', text: caption, marks: [{ type: 'bold' }] }]
    })
  }

  contentToInsert.push({ type: 'table', content: tableContent })

  if (afterBlockId) {
    const block = findBlockById(editor, afterBlockId)
    if (!block) {
      const message = `Block not found for table insertion: ${afterBlockId}`
      toast.error(message)
      return { success: false, message }
    }

    editor.chain()
      .focus()
      .setTextSelection(block.pos + block.node.nodeSize)
      .insertContent(contentToInsert)
      .run()
    toast.success('Table inserted')
    return { success: true, message: 'Table inserted', blockId: afterBlockId }
  }

  if (location) {
    const afterMatch = location.match(/^after:(.+)$/i)
    if (afterMatch) {
      const sectionBounds = findSectionBounds(editor, afterMatch[1])
      if (!sectionBounds.found) {
        const message = `Section not found: ${afterMatch[1]}`
        toast.error(message)
        return { success: false, message }
      }

      editor.chain()
        .focus()
        .setTextSelection(sectionBounds.contentEndPos)
        .insertContent(contentToInsert)
        .run()
      toast.success('Table inserted')
      return { success: true, message: `Table inserted in ${afterMatch[1]}` }
    }

    if (location === 'end') {
      editor.chain()
        .focus()
        .setTextSelection(editor.state.doc.content.size)
        .insertContent(contentToInsert)
        .run()
      toast.success('Table appended')
      return { success: true, message: 'Table appended to document' }
    }

    const message = `Invalid table location: ${location}`
    toast.error(message)
    return { success: false, message }
  }

  // No explicit target provided
  editor.chain().focus().insertContent(contentToInsert).run()
  toast.success('Table inserted at cursor')
  return { success: true, message: 'Table inserted at cursor' }
}


/**
 * Search and replace across the document (or within a section).
 */
function executeSearchAndReplace(
  editor: Editor,
  args: Record<string, unknown>
): ToolExecutionResult {
  const findText = args.find as string
  const replaceWith = args.replaceWith as string
  const section = args.section as string | undefined
  const matchCase = args.matchCase !== false // default true

  if (!findText) {
    return { success: false, message: 'No search text provided' }
  }

  // Determine the search range
  let searchFrom = 0
  let searchTo = editor.state.doc.content.size

  if (section) {
    const sectionBounds = findSectionBounds(editor, section)
    if (!sectionBounds.found) {
      toast.error(`Section not found: ${section}`)
      return { success: false, message: `Section not found: ${section}` }
    }
    searchFrom = sectionBounds.contentStartPos
    searchTo = sectionBounds.contentEndPos
  }

  // Collect all matches with source marks to preserve formatting
  const matches: { from: number; to: number; marks: readonly ProseMirrorMark[] }[] = []

  editor.state.doc.nodesBetween(searchFrom, searchTo, (node, pos) => {
    if (!node.isText || !node.text) return
    if (matches.length > MAX_SEARCH_REPLACE_MATCHES) return

    const textValue = node.text
    const searchStr = matchCase ? findText : findText.toLowerCase()
    const nodeText = matchCase ? textValue : textValue.toLowerCase()

    let idx = 0
    while (idx <= nodeText.length) {
      if (matches.length > MAX_SEARCH_REPLACE_MATCHES) break
      const found = nodeText.indexOf(searchStr, idx)
      if (found === -1) break

      const matchFrom = pos + found
      const matchTo = matchFrom + findText.length

      if (matchFrom >= searchFrom && matchTo <= searchTo) {
        matches.push({ from: matchFrom, to: matchTo, marks: node.marks })
      }

      idx = found + 1
    }
  })

  if (matches.length === 0) {
    toast.info(`No matches found for "${findText}"`)
    return { success: false, message: `No matches found for "${findText}"` }
  }

  if (matches.length > MAX_SEARCH_REPLACE_MATCHES) {
    const scopeMsg = section ? ` in ${section}` : ''
    const message = `Too many matches${scopeMsg} (>${MAX_SEARCH_REPLACE_MATCHES}). Narrow the search before replacing.`
    toast.error(message)
    return { success: false, message }
  }

  // Apply replacements in descending order and in bounded batches
  const sortedMatches = [...matches].sort((a, b) => b.from - a.from)

  for (let i = 0; i < sortedMatches.length; i += SEARCH_REPLACE_BATCH_SIZE) {
    const batch = sortedMatches.slice(i, i + SEARCH_REPLACE_BATCH_SIZE)
    let tr = editor.state.tr

    for (const match of batch) {
      if (replaceWith.length === 0) {
        tr = tr.delete(match.from, match.to)
      } else {
        const replacementNode = editor.state.schema.text(replaceWith, match.marks)
        tr = tr.replaceWith(match.from, match.to, replacementNode)
      }
    }

    if (tr.docChanged) {
      editor.view.dispatch(tr)
    }
  }

  const scopeMsg = section ? ` in ${section}` : ''
  toast.success(`Replaced ${matches.length} occurrence${matches.length > 1 ? 's' : ''}${scopeMsg}`)
  return {
    success: true,
    message: `Replaced ${matches.length} occurrence${matches.length > 1 ? 's' : ''} of "${findText}" with "${replaceWith}"${scopeMsg}`,
  }
}


// =============================================================================
// HELPERS
// =============================================================================

// Note: findTipTapPosition removed - now using structure-aware search via 
// findTextInStructure() which returns document positions directly
