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

export interface ToolInstruction {
  toolName: string
  args: Record<string, unknown>
  requiresReview: boolean
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

Examples (illustrative, not exhaustive):
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
  description: `Replace content in the document.

For ENTIRE BLOCK replacement: Use blockId alone
For PARTIAL replacement (specific text): Use searchPhrase (with optional blockId to scope)

When searchPhrase has multiple matches, use occurrenceIndex (1-based) to select which one.

CITATIONS: If newContent has [1], [2], [3] markers, include citations array.
PRESERVE existing [@...] markers when editing - they are existing citations.

Examples (illustrative, not exhaustive):
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
    occurrenceIndex: z.number().int().min(1).optional().describe('Which match to replace when searchPhrase appears multiple times (1-based)'),
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
  description: `Delete content from the document.

For ENTIRE BLOCK deletion: Use blockId alone
For PARTIAL deletion (sentence/phrase): Use searchPhrase (with optional blockId to scope)

When searchPhrase has multiple matches, use occurrenceIndex (1-based) to pick one match.

Examples (illustrative, not exhaustive):
- Delete whole paragraph: { blockId: "par_abc123", reason: "..." }
- Delete one sentence: { searchPhrase: "This sentence to delete.", reason: "..." }
- Delete text in specific block: { blockId: "par_abc123", searchPhrase: "text to delete", reason: "..." }

User will confirm deletions.`,
  inputSchema: z.object({
    blockId: z.string().optional().describe('Block ID - alone deletes entire block, with searchPhrase scopes the search'),
    section: z.string().optional().describe('Section name to scope the search'),
    searchPhrase: z.string().optional().describe('Specific text to delete (for partial deletion)'),
    occurrenceIndex: z.number().int().min(1).optional().describe('Which match to delete when searchPhrase appears multiple times (1-based)'),
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
Optional disambiguation:
- blockId / section to scope where matching happens
- occurrenceIndex to pick a specific match (1-based)

Example (illustrative, not exhaustive):
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
    section: z.string().optional().describe('Section name to scope the search'),
    occurrenceIndex: z.number().int().min(1).optional().describe('Which match to cite when afterPhrase appears multiple times (1-based)'),
  }),
})

/**
 * Highlight text for user review.
 */
export const highlightText = tool({
  description: `Highlight text for user attention.

For ENTIRE BLOCK highlight: Use blockId alone
For PARTIAL highlight (specific text): Use searchPhrase

Examples (illustrative, not exhaustive):
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

The source is identified by blockId, blockIds, or searchPhrase.
The destination is specified by targetLocation.

Examples (illustrative, not exhaustive):
- Move paragraph after another: { blockId: "par_abc", targetLocation: "after:par_xyz" }
- Move to end of section: { blockId: "par_abc", targetLocation: "endOfSection:Methods" }
- Move to start of section: { blockId: "par_abc", targetLocation: "startOfSection:Introduction" }
- Move to end of document: { blockId: "par_abc", targetLocation: "end" }`,
  inputSchema: z.object({
    blockId: z.string().optional().describe('Block ID of the content to move'),
    blockIds: z.array(z.string()).optional().describe('Move multiple block IDs together (preserves provided order)'),
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

Examples (illustrative, not exhaustive):
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

Example (illustrative, not exhaustive):
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

Examples (illustrative, not exhaustive):
- Bold a term: { searchPhrase: "important finding", format: "bold" }
- Italicize: { searchPhrase: "p < 0.05", format: "italic" }
- Remove bold: { searchPhrase: "not important", format: "bold", remove: true }`,
  inputSchema: z.object({
    searchPhrase: z.string().describe('The exact text to format'),
    blockId: z.string().optional().describe('Block ID to scope the search'),
    section: z.string().optional().describe('Section to scope the search'),
    occurrenceIndex: z.number().int().min(1).optional().describe('Which match to format when searchPhrase appears multiple times (1-based)'),
    applyToAll: z.boolean().optional().describe('Apply formatting to all matches in scope (default: false)'),
    format: z.enum(['bold', 'italic', 'underline', 'strikethrough', 'code']).describe('The formatting to apply'),
    remove: z.boolean().optional().describe('If true, removes the formatting instead of applying it'),
  }),
})

/**
 * Insert a structured table.
 */
export const insertTable = tool({
  description: `Insert a table into the document with specified headers and rows. More reliable than inserting markdown tables.

CITATIONS: Cell values can use [1], [2], [3] markers. Include citations array to map them.

Example (illustrative, not exhaustive):
{
  "headers": ["Theme", "Evidence", "Source"],
  "rows": [
    ["Safety", "Strong evidence [1]", "(Mtenga et al., 2023)"],
    ["Misinformation", "Moderate [2]", "(Smith, 2024)"]
  ],
  "citations": [
    { "index": 1, "paperId": "uuid-here", "quote": "exact quote" },
    { "index": 2, "paperId": "uuid-here", "quote": "exact quote" }
  ],
  "caption": "Table 1: Key findings",
  "afterBlockId": "par_abc"
}`,
  inputSchema: z.object({
    headers: z.array(z.string()).describe('Column header labels'),
    rows: z.array(z.array(z.string())).describe('Table rows, each an array of cell values (use [1], [2] for citations)'),
    citations: z.array(citationEntrySchema).optional().describe('Citation data for each [N] marker in cell values'),
    caption: z.string().optional().describe('Optional table caption'),
    afterBlockId: z.string().optional().describe('Insert table after this block'),
    location: z.string().optional().describe('General location: "cursor", "end", "after:SectionName"'),
  }),
})

/**
 * Edit an existing table in-place.
 */
export const editTable = tool({
  description: `Edit an existing table without recreating it.

Supported actions:
- appendRow: add a new data row
- updateCell: update a specific data cell
- renameColumn: rename a column header

Targeting:
- tableIndex (0-based) selects which table to edit in scope
- section can limit scope when there are many tables`,
  inputSchema: z.object({
    action: z.enum(['appendRow', 'updateCell', 'renameColumn']).describe('Table edit action'),
    tableIndex: z.number().int().min(0).optional().describe('Which table to edit in scope (0-based, default: 0)'),
    section: z.string().optional().describe('Limit table search to this section'),
    row: z.array(z.string()).optional().describe('Row values for appendRow'),
    rowIndex: z.number().int().min(0).optional().describe('Data row index for updateCell (0-based, excludes header row)'),
    colIndex: z.number().int().min(0).optional().describe('Column index for updateCell/renameColumn (0-based)'),
    value: z.string().optional().describe('New cell value for updateCell'),
    header: z.string().optional().describe('New header text for renameColumn'),
    citations: z.array(citationEntrySchema).optional().describe('Citation data for [N] markers in row/value/header'),
  }),
})

/**
 * Search the document (read-only) and return match count + locations/snippets.
 */
export const searchDocument = tool({
  description: `Search the full document for a word or phrase and return count, section breakdown, and context snippets. Read-only — does not modify the document.

This is the default tool for read-only verification.
Use it to confirm existence, count, and location before answering factual questions or before mutation tools that rely on text targeting.
Examples include (not limited to): "how many times do I use X?", "where do I mention Y?", "find all occurrences of Z".

Disambiguation rule:
- If a planned edit depends on searchPhrase and target is ambiguous (no blockId/occurrenceIndex), call searchDocument first.
- If target is already explicit (blockId, table coordinates, exact section-bound location), you may skip searchDocument.

Examples (illustrative, not exhaustive):
- { query: "impact", matchCase: false, wholeWord: true }
- { query: "p < 0.05", section: "Results", maxSnippets: 5 }
- { query: "hesitancy", contextChars: 60 }`,
  inputSchema: z.object({
    query: z.string().describe('The word or phrase to search for'),
    section: z.string().optional().describe('Limit search to this section'),
    matchCase: z.boolean().optional().describe('Case-sensitive matching (default: false)'),
    wholeWord: z.boolean().optional().describe('Match whole words only (default: false)'),
    maxSnippets: z.number().int().min(0).max(50).optional().describe('Max snippets to return (default: 10)'),
    contextChars: z.number().int().min(10).max(200).optional().describe('Characters before/after each match in snippets (default: 40)'),
  }),
})

/**
 * Find and replace across the entire document.
 */
export const searchAndReplace = tool({
  description: `Find and replace text across the entire document (or within a section). Replaces ALL occurrences.

Use this when the user asks to rename a term, fix a typo everywhere, or change terminology consistently.
Use wholeWord: true to avoid partial matches (e.g. "citation 1" won't match "citation 10").
Use maxReplacements to cap the number of replacements when needed.

Examples (illustrative, not exhaustive):
- Global rename: { find: "machine learning", replaceWith: "ML", matchCase: false }
- Section-scoped: { find: "Fig.", replaceWith: "Figure", section: "Results" }
- Case-sensitive: { find: "CNN", replaceWith: "convolutional neural network", matchCase: true }
- Boundary-safe: { find: "citation 1", replaceWith: "citation 4", wholeWord: true }`,
  inputSchema: z.object({
    find: z.string().describe('The text to search for'),
    replaceWith: z.string().describe('The replacement text'),
    section: z.string().optional().describe('Limit replacement to this section'),
    matchCase: z.boolean().optional().describe('Case-sensitive matching (default: true)'),
    wholeWord: z.boolean().optional().describe('Match whole words only — avoids partial matches like "1" matching "10" (default: false)'),
    maxReplacements: z.number().int().min(1).max(500).optional().describe('Maximum number of matches to replace (default: all matches in scope)'),
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
  editTable,
  searchDocument,
  searchAndReplace,
}

// =============================================================================
// CONFIRMATION REQUIREMENTS
// =============================================================================

export const toolReviewRequirements: Record<string, boolean> = {
  insertContent: true,
  replaceBlock: true,
  rewriteSection: true,
  deleteContent: true,
  addCitation: true,
  highlightText: true,
  addComment: true,
  moveBlock: true,
  mergeBlocks: true,
  splitBlock: true,
  formatText: true,
  insertTable: true,
  editTable: true,
  searchDocument: false,
  searchAndReplace: true,
}

export function requiresReview(toolName: string): boolean {
  return toolReviewRequirements[toolName as keyof typeof documentTools] ?? false
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
      if (args.occurrenceIndex !== undefined && (typeof args.occurrenceIndex !== 'number' || !Number.isInteger(args.occurrenceIndex) || args.occurrenceIndex < 1)) {
        return { valid: false, error: 'replaceBlock occurrenceIndex must be a positive integer' }
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
      if (args.occurrenceIndex !== undefined && (typeof args.occurrenceIndex !== 'number' || !Number.isInteger(args.occurrenceIndex) || args.occurrenceIndex < 1)) {
        return { valid: false, error: 'deleteContent occurrenceIndex must be a positive integer' }
      }
      // Need at least one targeting method
      if (!args.blockId && !args.searchPhrase && !args.section) {
        return { valid: false, error: 'deleteContent requires blockId, searchPhrase, or section' }
      }
      break
      
    case 'addCitation':
      if (!args.paperId || typeof args.paperId !== 'string') {
        return { valid: false, error: 'addCitation requires paperId' }
      }
      if (args.occurrenceIndex !== undefined && (typeof args.occurrenceIndex !== 'number' || !Number.isInteger(args.occurrenceIndex) || args.occurrenceIndex < 1)) {
        return { valid: false, error: 'addCitation occurrenceIndex must be a positive integer' }
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
      if (!args.blockId && !args.searchPhrase && !args.blockIds) {
        return { valid: false, error: 'moveBlock requires blockId, blockIds, or searchPhrase' }
      }
      if (!args.targetLocation || typeof args.targetLocation !== 'string') {
        return { valid: false, error: 'moveBlock requires targetLocation' }
      }
      if (args.blockIds && (!Array.isArray(args.blockIds) || (args.blockIds as unknown[]).length === 0)) {
        return { valid: false, error: 'moveBlock blockIds must be a non-empty array when provided' }
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
      if (args.occurrenceIndex !== undefined && (typeof args.occurrenceIndex !== 'number' || !Number.isInteger(args.occurrenceIndex) || args.occurrenceIndex < 1)) {
        return { valid: false, error: 'formatText occurrenceIndex must be a positive integer' }
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

    case 'editTable':
      if (!args.action || typeof args.action !== 'string') {
        return { valid: false, error: 'editTable requires action' }
      }
      if (!['appendRow', 'updateCell', 'renameColumn'].includes(args.action)) {
        return { valid: false, error: 'editTable action must be appendRow, updateCell, or renameColumn' }
      }
      if (args.action === 'appendRow' && !Array.isArray(args.row)) {
        return { valid: false, error: 'editTable appendRow requires row array' }
      }
      if (args.action === 'updateCell') {
        if (typeof args.rowIndex !== 'number' || typeof args.colIndex !== 'number') {
          return { valid: false, error: 'editTable updateCell requires rowIndex and colIndex' }
        }
        if (typeof args.value !== 'string') {
          return { valid: false, error: 'editTable updateCell requires value' }
        }
      }
      if (args.action === 'renameColumn') {
        if (typeof args.colIndex !== 'number') {
          return { valid: false, error: 'editTable renameColumn requires colIndex' }
        }
        if (typeof args.header !== 'string') {
          return { valid: false, error: 'editTable renameColumn requires header' }
        }
      }
      if (args.action === 'appendRow' && Array.isArray(args.row)) {
        for (const cell of args.row) {
          if (typeof cell === 'string') {
            const rowCitationWarning = checkCitationFormat(cell, citations)
            if (rowCitationWarning) return { valid: false, error: rowCitationWarning }
          }
        }
      }
      if (args.action === 'updateCell' && typeof args.value === 'string') {
        const valueCitationWarning = checkCitationFormat(args.value, citations)
        if (valueCitationWarning) return { valid: false, error: valueCitationWarning }
      }
      if (args.action === 'renameColumn' && typeof args.header === 'string') {
        const headerCitationWarning = checkCitationFormat(args.header, citations)
        if (headerCitationWarning) return { valid: false, error: headerCitationWarning }
      }
      break

    case 'searchDocument':
      if (!args.query || typeof args.query !== 'string') {
        return { valid: false, error: 'searchDocument requires query' }
      }
      break

    case 'searchAndReplace':
      if (!args.find || typeof args.find !== 'string') {
        return { valid: false, error: 'searchAndReplace requires find text' }
      }
      if (typeof args.replaceWith !== 'string') {
        return { valid: false, error: 'searchAndReplace requires replaceWith text' }
      }
      if (args.maxReplacements !== undefined) {
        if (typeof args.maxReplacements !== 'number' || !Number.isInteger(args.maxReplacements) || args.maxReplacements < 1) {
          return { valid: false, error: 'searchAndReplace maxReplacements must be a positive integer' }
        }
      }
      break
  }
  
  return { valid: true }
}
