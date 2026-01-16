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

Examples:
- Insert after block: { afterBlockId: "par_abc123", content: "New text" }
- Insert after phrase: { afterPhrase: "existing sentence.", content: "New text" }
- Insert at section end: { location: "after:Introduction", content: "New paragraph" }`,
  parameters: z.object({
    content: z.string().describe('The content to insert'),
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

Examples:
- Replace whole paragraph: { blockId: "par_abc123", newContent: "New paragraph text" }
- Replace specific sentence: { searchPhrase: "old sentence text", newContent: "new sentence text" }
- Replace text in specific block: { blockId: "par_abc123", searchPhrase: "old text", newContent: "new text" }`,
  parameters: z.object({
    blockId: z.string().optional().describe('Block ID - alone replaces entire block, with searchPhrase scopes the search'),
    section: z.string().optional().describe('Section name to scope the search'),
    searchPhrase: z.string().optional().describe('Specific text to find and replace'),
    newContent: z.string().describe('The replacement content'),
  }),
})

/**
 * Replace content in a specific section (legacy - kept for compatibility).
 */
export const replaceInSection = tool({
  description: `Replace specific text within a section. Use searchPhrase to find and replace.

This always does TEXT-LEVEL replacement (not block-level).`,
  parameters: z.object({
    section: z.string().describe('Section name (e.g., "Introduction", "Methods")'),
    searchPhrase: z.string().describe('The specific text to find and replace'),
    newContent: z.string().describe('The replacement text'),
  }),
})

/**
 * Rewrite an entire section.
 */
export const rewriteSection = tool({
  description: `Completely rewrite a section. Use for major restructuring.
  
WARNING: Replaces ALL content in the section. User will confirm.`,
  parameters: z.object({
    section: z.string().describe('Section name to rewrite'),
    newContent: z.string().describe('Complete new section content (excluding heading)'),
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

Examples:
- Delete whole paragraph: { blockId: "par_abc123", reason: "..." }
- Delete one sentence: { searchPhrase: "This sentence to delete.", reason: "..." }
- Delete text in specific block: { blockId: "par_abc123", searchPhrase: "text to delete", reason: "..." }

User will confirm deletions.`,
  parameters: z.object({
    blockId: z.string().optional().describe('Block ID - alone deletes entire block, with searchPhrase scopes the search'),
    section: z.string().optional().describe('Section name to scope the search'),
    searchPhrase: z.string().optional().describe('Specific text to delete (for partial deletion)'),
    reason: z.string().describe('Why this should be deleted'),
  }),
})

/**
 * Add a citation at a specific location.
 */
export const addCitationTool = tool({
  description: `Add a citation to support a claim.

Targeting (in order of preference):
1. afterPhrase - Insert citation right after specific text (most precise)
2. blockId - Add citation at end of block
3. Cursor position (fallback)

Examples:
- After specific claim: { paperId: "...", afterPhrase: "climate change impacts are significant" }
- At end of paragraph: { paperId: "...", blockId: "par_abc123" }`,
  parameters: z.object({
    paperId: z.string().describe('Paper ID from available sources'),
    afterPhrase: z.string().optional().describe('Insert citation after this text (preferred)'),
    blockId: z.string().optional().describe('Block to add citation to (adds at end)'),
    section: z.string().optional().describe('Section to scope the search'),
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
  parameters: z.object({
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
  description: `Add a comment without modifying text.

Attach to specific content using blockId or nearPhrase.`,
  parameters: z.object({
    blockId: z.string().optional().describe('Block to comment on'),
    section: z.string().optional().describe('Section for the comment'),
    nearPhrase: z.string().optional().describe('Place comment near this text'),
    comment: z.string().describe('The comment text'),
  }),
})

// =============================================================================
// TOOL COLLECTION
// =============================================================================

export const documentTools = {
  insertContent,
  replaceBlock,
  replaceInSection,
  rewriteSection,
  deleteContent,
  addCitation: addCitationTool,
  highlightText,
  addComment,
}

// =============================================================================
// CONFIRMATION REQUIREMENTS
// =============================================================================

export const toolConfirmationLevels: Record<keyof typeof documentTools, ToolConfirmationLevel> = {
  insertContent: 'none',
  replaceBlock: 'preview',
  replaceInSection: 'preview',
  rewriteSection: 'confirm',
  deleteContent: 'confirm',
  addCitation: 'none',
  highlightText: 'none',
  addComment: 'none',
}

export function requiresConfirmation(toolName: string): boolean {
  const level = toolConfirmationLevels[toolName as keyof typeof documentTools]
  return level === 'confirm' || level === 'preview'
}

export function getConfirmationLevel(toolName: string): ToolConfirmationLevel {
  return toolConfirmationLevels[toolName as keyof typeof documentTools] || 'none'
}
