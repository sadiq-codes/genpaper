/**
 * Document editing tools for AI-powered chat in the editor.
 * 
 * Targeting Strategy:
 * - blockId alone → targets entire block
 * - searchPhrase alone → finds and targets specific text anywhere
 * - blockId + searchPhrase → finds text within that specific block
 * - section + searchPhrase → finds text within that section
 * 
 * This allows both block-level and text-level operations.
 */

import { z } from 'zod'
import { tool } from 'ai'

// =============================================================================
// CITATION SCHEMA
// =============================================================================

/**
 * Schema for structured citations in tool calls.
 * Each entry maps a [N] marker in content to a paper and quote.
 */
const citationEntrySchema = z.object({
  index: z.number().describe('The citation marker number [N] this entry corresponds to'),
  paperId: z.string().describe('The paper_id from INTERNAL REFERENCE section'),
  quote: z.string().describe('The exact supporting sentence from the source'),
})

export type CitationEntry = z.infer<typeof citationEntrySchema>

// =============================================================================
// TYPES
// =============================================================================

export type ToolConfirmationLevel = 'none' | 'confirm' | 'preview'

export interface ToolInstruction {
  toolName: string
  args: Record<string, unknown>
  requiresConfirmation: boolean
  preview?: string
}

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

/**
 * Insert content at a specific location in the document.
 */
export const insertContent = tool({
  description: `Insert new content into the document.

Targeting (in order of preference):
1. afterBlockId - Insert after a specific block
2. afterPhrase - Insert after specific text
3. location - General positioning: "cursor", "end", "after:SectionName", "start:SectionName"

CITATIONS: If content has [1], [2], [3] markers, include citations array.
Each marker MUST have a corresponding entry with index, paperId, and quote.

Examples:
- Simple insert: { content: "New text without citations" }
- With citations: { 
    content: "Research shows X [1] and Y [2].", 
    citations: [
      { index: 1, paperId: "uuid-here", quote: "exact quote" },
      { index: 2, paperId: "uuid-here", quote: "exact quote" }
    ]
  }`,
  inputSchema: z.object({
    content: z.string().describe('The content to insert (use [1], [2], [3] for citations)'),
    citations: z.array(citationEntrySchema).optional().describe('Citation data for each [N] marker'),
    afterBlockId: z.string().optional().describe('Insert after this block ID'),
    afterPhrase: z.string().optional().describe('Insert after this specific text'),
    location: z.string().optional().describe('General location: "cursor", "end", "after:SectionName", "start:SectionName"'),
  }),
})

/**
 * Replace content - supports both block-level and text-level replacement.
 */
export const replaceBlock = tool({
  description: `Replace content in the document. Only replaces the FIRST match found.

For ENTIRE BLOCK replacement: Use blockId alone
For PARTIAL replacement (specific text): Use searchPhrase (with optional blockId to scope)

⚠️ IMPORTANT: This tool replaces only ONE occurrence. Do NOT call replaceBlock multiple times for the same text. If the same text appears in multiple places and all need changing, use searchAndReplace instead.

CITATIONS: If newContent has [1], [2], [3] markers, include citations array.
PRESERVE existing [@...] markers when editing - they are existing citations.

Examples:
- Replace whole paragraph: { blockId: "par_abc123", newContent: "New paragraph text" }
- With citations: { 
    blockId: "par_abc123", 
    newContent: "Updated claim [1].", 
    citations: [{ index: 1, paperId: "uuid", quote: "quote" }]
  }
- Preserve existing: { blockId: "par_abc123", newContent: "Edited text [@existing-id#inst-id] with new [1].", citations: [...] }`,
  inputSchema: z.object({
    blockId: z.string().optional().describe('Block ID - alone replaces entire block, with searchPhrase scopes the search'),
    section: z.string().optional().describe('Section name to scope the search'),
    searchPhrase: z.string().optional().describe('Specific text to find and replace'),
    newContent: z.string().describe('The replacement content (use [1], [2], [3] for new citations)'),
    citations: z.array(citationEntrySchema).optional().describe('Citation data for each [N] marker'),
  }),
})

/**
 * Rewrite an entire section.
 */
export const rewriteSection = tool({
  description: `Completely rewrite a section. Use for major restructuring.
  
WARNING: Replaces ALL content in the section. User will confirm.
If newContent has [1], [2], [3] markers, include citations array.`,
  inputSchema: z.object({
    section: z.string().describe('Section name to rewrite'),
    newContent: z.string().describe('Complete new section content (use [1], [2], [3] for citations)'),
    citations: z.array(citationEntrySchema).optional().describe('Citation data for each [N] marker'),
    reason: z.string().describe('Why rewriting is needed'),
  }),
})

/**
 * Delete content - supports both block-level and text-level deletion.
 */
export const deleteContent = tool({
  description: `Delete content from the document. Only deletes the FIRST match found.

For ENTIRE BLOCK deletion: Use blockId alone
For PARTIAL deletion (sentence/phrase): Use searchPhrase (with optional blockId to scope)

⚠️ Do NOT call deleteContent multiple times for the same text. If the same text appears in multiple places, use searchAndReplace with an empty replaceWith string instead.

Examples:
- Delete whole paragraph: { blockId: "par_abc123", reason: "..." }
- Delete one sentence: { searchPhrase: "This sentence to delete.", reason: "..." }
- Delete text in specific block: { blockId: "par_abc123", searchPhrase: "text to delete", reason: "..." }

User will confirm deletions.`,
  inputSchema: z.object({
    blockId: z.string().optional().describe('Block ID - alone deletes entire block, with searchPhrase scopes the search'),
    section: z.string().optional().describe('Section name to scope the search'),
    searchPhrase: z.string().optional().describe('Specific text to delete (for partial deletion)'),
    reason: z.string().describe('Why this should be deleted'),
  }),
})

/**
 * Add a citation to existing text WITHOUT modifying the text.
 * 
 * Use this tool when:
 * - Adding a citation to a claim that doesn't have one yet
 * - The surrounding text should NOT be changed
 * 
 * Do NOT use this tool when:
 * - You need to rewrite/edit the text (use replaceBlock with markers instead)
 * - You're writing new content (use insertContent with markers instead)
 * - The claim already has a citation (check for [@...] markers in the document)
 */
export const addCitationTool = tool({
  description: `Add a citation to existing text WITHOUT changing the text itself.

⚠️ IMPORTANT: Check the document first - if the text already has a citation marker ([@...]), do NOT add another one.

When to use addCitation:
- Single citation to existing claim that has NO citation
- You want to preserve the exact text, just add a reference

When to use insertContent/replaceBlock with [N] markers instead:
- Writing new text with citations
- Editing text AND adding citations
- Adding multiple citations at once

Required parameters:
- paperId: From INTERNAL REFERENCE section
- afterPhrase: The exact text to insert citation after (REQUIRED for precision)
- quote: The exact supporting quote from the source (REQUIRED for research tracking)

Example:
{ 
  "paperId": "abc-123", 
  "afterPhrase": "climate change impacts are significant", 
  "quote": "Global temperatures have risen by 1.1°C since pre-industrial times"
}`,
  inputSchema: z.object({
    paperId: z.string().describe('Paper ID from INTERNAL REFERENCE section'),
    afterPhrase: z.string().describe('Insert citation immediately after this exact text'),
    quote: z.string().describe('Exact quote from source that supports this claim'),
    blockId: z.string().optional().describe('Block ID to scope the search (optional but recommended)'),
  }),
})

/**
 * Highlight text for user review.
 */
export const highlightText = tool({
  description: `Highlight text for user attention.

For ENTIRE BLOCK highlight: Use blockId alone
For PARTIAL highlight (specific text): Use searchPhrase

Examples:
- Highlight paragraph: { blockId: "par_abc123", comment: "Needs citation" }
- Highlight sentence: { searchPhrase: "This claim needs support", comment: "Add evidence" }`,
  inputSchema: z.object({
    blockId: z.string().optional().describe('Block ID - alone highlights entire block'),
    section: z.string().optional().describe('Section to scope the search'),
    searchPhrase: z.string().optional().describe('Specific text to highlight'),
    comment: z.string().describe('Why this is highlighted'),
    highlightType: z.enum(['suggestion', 'warning', 'info']).default('suggestion'),
  }),
})

/**
 * Add a comment to the document.
 */
export const addComment = tool({
  description: `Add a comment without modifying text. Shows as a temporary notification to the user (not a persistent annotation).

Attach to specific content using blockId or nearPhrase.`,
  inputSchema: z.object({
    blockId: z.string().optional().describe('Block to comment on'),
    section: z.string().optional().describe('Section for the comment'),
    nearPhrase: z.string().optional().describe('Place comment near this text'),
    comment: z.string().describe('The comment text'),
  }),
})

/**
 * Move a block from one location to another in a single atomic operation.
 */
export const moveBlock = tool({
  description: `Move a block from one location to another. This is atomic — content won't be lost if something fails.

The block is identified by blockId or searchPhrase.
The destination is specified by targetLocation.

Examples:
- Move paragraph after another: { blockId: "par_abc", targetLocation: "after:par_xyz" }
- Move to end of section: { blockId: "par_abc", targetLocation: "endOfSection:Methods" }
- Move to start of section: { blockId: "par_abc", targetLocation: "startOfSection:Introduction" }
- Move to end of document: { blockId: "par_abc", targetLocation: "end" }`,
  inputSchema: z.object({
    blockId: z.string().optional().describe('Block ID of the content to move'),
    searchPhrase: z.string().optional().describe('Text to find the block to move'),
    section: z.string().optional().describe('Section to scope the search'),
    targetLocation: z.string().describe('Where to move: "after:blockId", "endOfSection:Name", "startOfSection:Name", "end"'),
    reason: z.string().describe('Why this content should be moved'),
  }),
})

/**
 * Merge two adjacent blocks into one.
 */
export const mergeBlocks = tool({
  description: `Merge two adjacent paragraphs into a single paragraph. Use when content is fragmented into too many short paragraphs.

Specify either two block IDs or a searchPhrase that spans the boundary.

Examples:
- Merge by IDs: { firstBlockId: "par_abc", secondBlockId: "par_def" }
- Merge by text: { searchPhrase: "end of first paragraph", section: "Introduction" }`,
  inputSchema: z.object({
    firstBlockId: z.string().optional().describe('Block ID of the first block'),
    secondBlockId: z.string().optional().describe('Block ID of the second block (must be adjacent)'),
    searchPhrase: z.string().optional().describe('Text at the boundary of the two blocks to merge'),
    section: z.string().optional().describe('Section to scope the search'),
  }),
})

/**
 * Split a block into two at a specified point.
 */
export const splitBlock = tool({
  description: `Split a paragraph into two at a specific point. Use when a paragraph is too long and should be broken into separate paragraphs.

Specify where to split using splitAfterPhrase — the text before this phrase stays in the first paragraph, the rest becomes a new paragraph.

Example:
- { blockId: "par_abc", splitAfterPhrase: "first topic conclusion." }`,
  inputSchema: z.object({
    blockId: z.string().optional().describe('Block ID of the block to split'),
    splitAfterPhrase: z.string().describe('Split the block after this exact text'),
    section: z.string().optional().describe('Section to scope the search'),
  }),
})

/**
 * Apply inline formatting to specific text.
 */
export const formatText = tool({
  description: `Apply or remove inline formatting (bold, italic, underline, strikethrough, code) on specific text WITHOUT changing the text itself.

Examples:
- Bold a term: { searchPhrase: "important finding", format: "bold" }
- Italicize: { searchPhrase: "p < 0.05", format: "italic" }
- Remove bold: { searchPhrase: "not important", format: "bold", remove: true }`,
  inputSchema: z.object({
    searchPhrase: z.string().describe('The exact text to format'),
    blockId: z.string().optional().describe('Block ID to scope the search'),
    section: z.string().optional().describe('Section to scope the search'),
    format: z.enum(['bold', 'italic', 'underline', 'strikethrough', 'code']).describe('The formatting to apply'),
    remove: z.boolean().optional().describe('If true, removes the formatting instead of applying it'),
  }),
})

/**
 * Insert a structured table.
 */
export const insertTable = tool({
  description: `Insert a table into the document with specified headers and rows. More reliable than inserting markdown tables.

Example:
{
  "headers": ["Method", "Accuracy", "F1 Score"],
  "rows": [
    ["Baseline", "0.82", "0.79"],
    ["Our model", "0.91", "0.88"]
  ],
  "caption": "Table 1: Model comparison results",
  "afterBlockId": "par_abc"
}`,
  inputSchema: z.object({
    headers: z.array(z.string()).describe('Column header labels'),
    rows: z.array(z.array(z.string())).describe('Table rows, each an array of cell values'),
    caption: z.string().optional().describe('Optional table caption'),
    afterBlockId: z.string().optional().describe('Insert table after this block'),
    location: z.string().optional().describe('General location: "cursor", "end", "after:SectionName"'),
  }),
})

/**
 * Find and replace across the entire document.
 */
export const searchAndReplace = tool({
  description: `Find and replace text across the entire document (or within a section). Replaces ALL occurrences.

Use this when the user asks to rename a term, fix a typo everywhere, or change terminology consistently.

Examples:
- Global rename: { find: "machine learning", replaceWith: "ML", matchCase: false }
- Section-scoped: { find: "Fig.", replaceWith: "Figure", section: "Results" }
- Case-sensitive: { find: "CNN", replaceWith: "convolutional neural network", matchCase: true }`,
  inputSchema: z.object({
    find: z.string().describe('The text to search for'),
    replaceWith: z.string().describe('The replacement text'),
    section: z.string().optional().describe('Limit replacement to this section'),
    matchCase: z.boolean().optional().describe('Case-sensitive matching (default: true)'),
  }),
})

// =============================================================================
// TOOL COLLECTION
// =============================================================================

/**
 * Active document tools exposed to AI.
 * 
 * Citation tools:
 * - addCitation: Add a single citation to existing text (no text modification)
 * - insertContent/replaceBlock with [N] markers: Write/edit text with citations
 * 
 * Best practices:
 * - Use addCitation when ONLY adding a citation (text stays the same)
 * - Use marker-based approach when writing new content or editing text
 */
export const documentTools = {
  insertContent,
  replaceBlock,
  rewriteSection,
  deleteContent,
  addCitation: addCitationTool,
  highlightText,
  addComment,
  moveBlock,
  mergeBlocks,
  splitBlock,
  formatText,
  insertTable,
  searchAndReplace,
}

// =============================================================================
// CONFIRMATION REQUIREMENTS
// =============================================================================

export const toolConfirmationLevels: Record<string, ToolConfirmationLevel> = {
  insertContent: 'preview',  // Show ghost preview before inserting
  replaceBlock: 'preview',
  rewriteSection: 'confirm',
  deleteContent: 'confirm',
  addCitation: 'none',
  highlightText: 'none',
  addComment: 'none',
  moveBlock: 'confirm',
  mergeBlocks: 'preview',
  splitBlock: 'preview',
  formatText: 'none',
  insertTable: 'preview',
  searchAndReplace: 'confirm',
}

export function requiresConfirmation(toolName: string): boolean {
  const level = toolConfirmationLevels[toolName as keyof typeof documentTools]
  return level === 'confirm' || level === 'preview'
}

export function getConfirmationLevel(toolName: string): ToolConfirmationLevel {
  return toolConfirmationLevels[toolName as keyof typeof documentTools] || 'none'
}

// =============================================================================
// TOOL VALIDATION
// =============================================================================

/**
 * Check if content has numbered citation markers but no citations array.
 * Returns a warning message if format is invalid, null otherwise.
 */
function checkCitationFormat(content: string, citations?: CitationEntry[]): string | null {
  // Check if content has numbered markers [1], [2], etc. (but not things like [E1], [M1])
  const numberedMarkerPattern = /\[(\d+)\]/g
  const matches = content.match(numberedMarkerPattern)
  const hasNumberedMarkers = matches && matches.length > 0
  
  if (hasNumberedMarkers && (!citations || citations.length === 0)) {
    const uniqueMarkers = [...new Set(matches)]
    return `Content has citation markers (${uniqueMarkers.join(', ')}) but NO citations array. ` +
           `These will be STRIPPED. Include citations parameter with index, paperId, and quote for each marker.`
  }
  
  // Check that all markers have corresponding citations
  if (hasNumberedMarkers && citations && citations.length > 0) {
    const markerIndices = new Set(matches!.map(m => parseInt(m.slice(1, -1), 10)))
    const citationIndices = new Set(citations.map(c => c.index))
    
    const missingCitations = [...markerIndices].filter(i => !citationIndices.has(i))
    if (missingCitations.length > 0) {
      return `Content has markers ${missingCitations.map(i => `[${i}]`).join(', ')} without corresponding citation entries.`
    }
  }
  
  return null
}

/**
 * Validate that a tool call has the required arguments.
 * Returns { valid: true } or { valid: false, error: string }
 * Also logs warnings for citation format issues.
 */
export function validateToolCall(
  toolName: string, 
  args: Record<string, unknown>
): { valid: true } | { valid: false; error: string } {
  // Check if tool exists
  if (!(toolName in documentTools)) {
    return { valid: false, error: `Unknown tool: ${toolName}` }
  }

  // Validate required args based on tool type
  const citations = args.citations as CitationEntry[] | undefined
  
  switch (toolName) {
    case 'insertContent':
      if (!args.content || typeof args.content !== 'string' || args.content.trim() === '') {
        return { valid: false, error: 'insertContent requires non-empty content' }
      }
      // Check citation format
      const insertCitationWarning = checkCitationFormat(args.content, citations)
      if (insertCitationWarning) {
        return { valid: false, error: insertCitationWarning }
      }
      break
      
    case 'replaceBlock':
      if (!args.newContent || typeof args.newContent !== 'string') {
        return { valid: false, error: 'replaceBlock requires newContent' }
      }
      // Need at least one targeting method
      if (!args.blockId && !args.searchPhrase && !args.section) {
        return { valid: false, error: 'replaceBlock requires blockId, searchPhrase, or section' }
      }
      // Check citation format
      const replaceCitationWarning = checkCitationFormat(args.newContent as string, citations)
      if (replaceCitationWarning) {
        return { valid: false, error: replaceCitationWarning }
      }
      break
      
    case 'rewriteSection':
      if (!args.section || typeof args.section !== 'string') {
        return { valid: false, error: 'rewriteSection requires section name' }
      }
      if (!args.newContent || typeof args.newContent !== 'string') {
        return { valid: false, error: 'rewriteSection requires newContent' }
      }
      // Check citation format
      const rewriteWarning = checkCitationFormat(args.newContent, citations)
      if (rewriteWarning) {
        return { valid: false, error: rewriteWarning }
      }
      break
      
    case 'deleteContent':
      // Need at least one targeting method
      if (!args.blockId && !args.searchPhrase && !args.section) {
        return { valid: false, error: 'deleteContent requires blockId, searchPhrase, or section' }
      }
      break
      
    case 'addCitation':
      if (!args.paperId || typeof args.paperId !== 'string') {
        return { valid: false, error: 'addCitation requires paperId' }
      }
      // afterPhrase is required to locate where to insert the citation
      if (!args.afterPhrase || typeof args.afterPhrase !== 'string') {
        return { valid: false, error: 'addCitation requires afterPhrase to locate insertion point' }
      }
      // quote is optional - useful for verification but not required for targeting
      break
      
    case 'highlightText':
      // Accept blockId OR searchPhrase (schema says blockId alone is valid for entire block highlight)
      if (!args.blockId && !args.searchPhrase) {
        return { valid: false, error: 'highlightText requires blockId or searchPhrase' }
      }
      break
      
    case 'addComment':
      if (!args.comment || typeof args.comment !== 'string') {
        return { valid: false, error: 'addComment requires comment text' }
      }
      break

    case 'moveBlock':
      if (!args.blockId && !args.searchPhrase) {
        return { valid: false, error: 'moveBlock requires blockId or searchPhrase' }
      }
      if (!args.targetLocation || typeof args.targetLocation !== 'string') {
        return { valid: false, error: 'moveBlock requires targetLocation' }
      }
      break

    case 'mergeBlocks':
      if (!args.firstBlockId && !args.searchPhrase) {
        return { valid: false, error: 'mergeBlocks requires firstBlockId+secondBlockId or searchPhrase' }
      }
      if (args.firstBlockId && !args.secondBlockId) {
        return { valid: false, error: 'mergeBlocks requires secondBlockId when firstBlockId is provided' }
      }
      break

    case 'splitBlock':
      if (!args.splitAfterPhrase || typeof args.splitAfterPhrase !== 'string') {
        return { valid: false, error: 'splitBlock requires splitAfterPhrase' }
      }
      break

    case 'formatText':
      if (!args.searchPhrase || typeof args.searchPhrase !== 'string') {
        return { valid: false, error: 'formatText requires searchPhrase' }
      }
      if (!args.format || typeof args.format !== 'string') {
        return { valid: false, error: 'formatText requires format' }
      }
      break

    case 'insertTable':
      if (!Array.isArray(args.headers) || args.headers.length === 0) {
        return { valid: false, error: 'insertTable requires non-empty headers array' }
      }
      if (!Array.isArray(args.rows)) {
        return { valid: false, error: 'insertTable requires rows array' }
      }
      break

    case 'searchAndReplace':
      if (!args.find || typeof args.find !== 'string') {
        return { valid: false, error: 'searchAndReplace requires find text' }
      }
      if (typeof args.replaceWith !== 'string') {
        return { valid: false, error: 'searchAndReplace requires replaceWith text' }
      }
      break
  }
  
  return { valid: true }
}
