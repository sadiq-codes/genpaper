/**
 * Content processor for TipTap editor
 * 
 * Uses AST-based markdown → TipTap JSON conversion for reliable
 * style preservation and first-class citation handling.
 */

import { markdownToTipTap, hasCitationMarkers, extractCitationIds } from './markdown-to-tiptap'
import type { CitationAttributes } from '../extensions/Citation'
import type { ProjectPaper } from '../types'

// Re-export utilities from the new module
export { hasCitationMarkers, extractCitationIds }

/**
 * Creates a paper lookup map for quick access
 */
export function createPaperLookup(papers: ProjectPaper[]): Record<string, ProjectPaper> {
  const lookup: Record<string, ProjectPaper> = {}
  for (const paper of papers) {
    lookup[paper.id] = paper
  }
  return lookup
}

/**
 * Extracts all citation markers from text and returns their paper IDs
 * @deprecated Use extractCitationIds instead
 */
export function extractCitationMarkers(text: string): string[] {
  return extractCitationIds(text)
}

/**
 * Converts a paper to citation attributes
 */
export function paperToCitationAttrs(paper: ProjectPaper): CitationAttributes {
  return {
    id: paper.id,
    authors: paper.authors || [],
    title: paper.title || 'Untitled',
    year: paper.year || new Date().getFullYear(),
    journal: paper.journal,
    doi: paper.doi,
  }
}



/**
 * Check if text contains markdown formatting
 */
export function hasMarkdownFormatting(text: string): boolean {
  const markdownPatterns = [
    /^#{1,6}\s+/m,           // Headers at line start
    /\n#{1,6}\s+/,           // Headers after newline
    /\*\*[^*]+\*\*/,         // Bold
    /__[^_]+__/,             // Bold (underscore style)
    /(?<!\*)\*[^*\n]+\*(?!\*)/,  // Italic (single asterisk, not bold)
    /(?<!_)_[^_\n]+_(?!_)/,      // Italic (underscore style, not bold)
    /`[^`]+`/,               // Inline code
    /```[\s\S]*?```/,        // Code blocks (non-greedy)
    /^\s*[-*+]\s+/m,         // Unordered lists
    /^\s*\d+\.\s+/m,         // Ordered lists
    /^\s*>/m,                // Blockquotes
    /\[([^\]]+)\]\([^)]+\)/, // Links
    /!\[([^\]]*)\]\([^)]+\)/, // Images
    /^---+$/m,               // Horizontal rules
    /^\*\*\*+$/m,            // Horizontal rules (asterisks)
    /\|.+\|/m,               // Tables (GFM)
  ]

  return markdownPatterns.some(pattern => pattern.test(text))
}

/**
 * Main processor: Convert markdown with citation markers to TipTap JSON
 * 
 * Uses the new AST-based pipeline:
 *   markdown → remark AST → TipTap JSON
 * 
 * This preserves styles and handles citations as first-class nodes.
 * 
 * @param markdown - Raw markdown text with [CONTEXT FROM: uuid] markers
 * @param papers - Array of papers for citation metadata lookup
 * @returns TipTap JSON document structure
 */
export function processAIContent(
  markdown: string,
  papers: ProjectPaper[]
): any {
  if (!markdown || markdown.trim() === '') {
    return {
      type: 'doc',
      content: [],
    }
  }

  try {
    // Use the new AST-based converter
    const doc = markdownToTipTap(markdown, papers)

    if (process.env.NODE_ENV === 'development') {
      console.log('[content-processor] processAIContent result:', {
        inputLength: markdown.length,
        outputType: doc.type,
        outputNodes: doc.content?.length || 0,
      })
    }

    return doc
  } catch (err) {
    console.error('[content-processor] Failed to process markdown:', err)
    // Fallback: return basic doc structure with raw content
    return {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: markdown }]
        }
      ]
    }
  }
}

/**
 * Process plain text (not markdown) with citation markers
 * Used for simpler cases like ghost text suggestions
 * 
 * @param text - Plain text with [CONTEXT FROM: uuid] markers
 * @param papers - Array of papers for citation metadata lookup
 * @returns TipTap JSON fragment (content array, not full doc)
 */
export function processPlainTextWithCitations(
  text: string,
  papers: ProjectPaper[]
): any[] {
  if (!text || text.trim() === '') {
    return []
  }

  const paperLookup = createPaperLookup(papers)
  // Match both [CITE: id] and [CONTEXT FROM: id] patterns
  const pattern = /\[(CITE|CONTEXT FROM):\s*([a-f0-9-]+)\]/gi
  const matches = [...text.matchAll(pattern)]

  if (matches.length === 0) {
    // No citations, return as simple text
    return [{ type: 'text', text }]
  }

  const result: any[] = []
  let lastIndex = 0

  for (const match of matches) {
    const paperId = match[2] // Group 2 is the UUID (group 1 is CITE|CONTEXT FROM)
    const matchStart = match.index!
    const matchEnd = matchStart + match[0].length

    // Add text before the marker
    if (matchStart > lastIndex) {
      const textBefore = text.slice(lastIndex, matchStart)
      if (textBefore) {
        result.push({ type: 'text', text: textBefore })
      }
    }

    // Add citation node with paper info if available
    const paper = paperLookup[paperId]
    result.push({
      type: 'citation',
      attrs: paper ? paperToCitationAttrs(paper) : { id: paperId },
    })

    lastIndex = matchEnd
  }

  // Add remaining text
  if (lastIndex < text.length) {
    result.push({ type: 'text', text: text.slice(lastIndex) })
  }

  return result
}

/**
 * Determine the best processing method and process content accordingly
 */
export function processContent(
  content: string,
  papers: ProjectPaper[]
): { json: any; isFullDoc: boolean } {
  const hasMarkdown = hasMarkdownFormatting(content)
  const hasCitations = hasCitationMarkers(content)

  if (hasMarkdown) {
    // Full markdown processing via AST
    return {
      json: processAIContent(content, papers),
      isFullDoc: true,
    }
  } else if (hasCitations) {
    // Plain text with citations only
    return {
      json: processPlainTextWithCitations(content, papers),
      isFullDoc: false,
    }
  } else {
    // Plain text, no special processing needed
    return {
      json: [{ type: 'text', text: content }],
      isFullDoc: false,
    }
  }
}
