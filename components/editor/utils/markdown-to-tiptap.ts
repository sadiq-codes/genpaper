/**
 * AST-based Markdown to TipTap JSON converter
 * 
 * This replaces the lossy markdown → HTML → TipTap pipeline with a direct
 * markdown AST → TipTap JSON conversion that preserves styles and handles
 * citations as first-class nodes during parsing (not post-processing).
 */

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { Root, Content, PhrasingContent, Text, Emphasis, Strong, InlineCode, Link, Delete, Image } from 'mdast'
import type { CitationAttributes } from '../extensions/Citation'
import type { ProjectPaper } from '../types'

// Citation marker patterns - supports all formats:
// - [@uuid] - Pandoc style (preferred, new format)
// - [CITE: uuid] - AI generated citations (legacy)
// - [CONTEXT FROM: uuid] - Legacy context format
const PANDOC_CITATION_PATTERN = /\[@([a-f0-9-]+)\]/gi
const LEGACY_CITATION_PATTERN = /\[(CITE|CONTEXT FROM):\s*([a-f0-9-]+)\]/gi

// Combined pattern for detection (non-capturing for test only)
const ANY_CITATION_PATTERN = /(?:\[@[a-f0-9-]+\]|\[(?:CITE|CONTEXT FROM):\s*[a-f0-9-]+\])/gi

interface PaperLookup {
  [paperId: string]: ProjectPaper
}

interface TipTapNode {
  type: string
  attrs?: Record<string, any>
  marks?: Array<{ type: string; attrs?: Record<string, any> }>
  content?: TipTapNode[]
  text?: string
}

interface Mark {
  type: string
  attrs?: Record<string, any>
}

/**
 * Parse markdown string into mdast AST
 */
function parseMarkdown(markdown: string): Root {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .parse(markdown)
}

/**
 * Create paper lookup map for O(1) access
 */
function createPaperLookup(papers: ProjectPaper[]): PaperLookup {
  const lookup: PaperLookup = {}
  for (const paper of papers) {
    lookup[paper.id] = paper
  }
  return lookup
}

/**
 * Convert paper to citation node attributes
 */
function paperToCitationAttrs(paper: ProjectPaper): CitationAttributes {
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
 * Extract paper ID from a citation match
 * Handles both Pandoc [@uuid] and legacy [CITE: uuid] formats
 */
function extractPaperIdFromMatch(match: RegExpMatchArray): string | null {
  const fullMatch = match[0]
  
  // Pandoc format: [@uuid] - capture group 1
  if (fullMatch.startsWith('[@')) {
    return match[1] || null
  }
  
  // Legacy format: [CITE: uuid] or [CONTEXT FROM: uuid] - capture group 2
  return match[2] || null
}

/**
 * Split text containing citation markers into text nodes and citation nodes
 * Citation nodes only store the paper ID - the UI fetches and displays paper details
 * Supports both [@uuid] (Pandoc) and [CITE: uuid] (legacy) formats
 */
function splitTextWithCitations(
  text: string,
  marks: Mark[],
  lookup: PaperLookup
): TipTapNode[] {
  // Combined pattern to match both formats in order
  // Group 1 = Pandoc UUID, Group 2 = legacy type (CITE|CONTEXT FROM), Group 3 = legacy UUID
  const combinedPattern = /\[@([a-f0-9-]+)\]|\[(CITE|CONTEXT FROM):\s*([a-f0-9-]+)\]/gi
  
  const parts: TipTapNode[] = []
  let lastIndex = 0

  for (const match of text.matchAll(combinedPattern)) {
    const start = match.index!
    const end = start + match[0].length
    
    // Extract paper ID from either format
    const paperId = match[1] || match[3] // Group 1 for Pandoc, Group 3 for legacy

    if (!paperId) {
      continue // Skip if no paper ID found
    }

    // Add text before the citation marker
    if (start > lastIndex) {
      const textBefore = text.slice(lastIndex, start)
      if (textBefore) {
        parts.push({
          type: 'text',
          text: textBefore,
          ...(marks.length > 0 ? { marks: [...marks] } : {}),
        })
      }
    }

    // Add citation node with paper info if available
    const paper = lookup[paperId]
    
    // Debug logging for missing papers
    if (!paper && process.env.NODE_ENV === 'development') {
      console.warn('[Citation] Paper not found in lookup:', {
        paperId,
        availableIds: Object.keys(lookup).slice(0, 10), // First 10 IDs
        lookupSize: Object.keys(lookup).length,
        markerFound: match[0]
      })
    }
    
    parts.push({
      type: 'citation',
      attrs: paper ? paperToCitationAttrs(paper) : { id: paperId },
    })

    lastIndex = end
  }

  // Add remaining text after last marker
  if (lastIndex < text.length) {
    parts.push({
      type: 'text',
      text: text.slice(lastIndex),
      ...(marks.length > 0 ? { marks: [...marks] } : {}),
    })
  }

  // If no citations found, return original text with marks
  if (parts.length === 0) {
    return [{
      type: 'text',
      text,
      ...(marks.length > 0 ? { marks: [...marks] } : {}),
    }]
  }

  return parts
}

/**
 * Convert mdast phrasing content (inline) to TipTap nodes
 * Handles text, bold, italic, code, links, etc.
 */
function phrasingToTipTap(
  node: PhrasingContent,
  marks: Mark[],
  lookup: PaperLookup
): TipTapNode[] {
  switch (node.type) {
    case 'text': {
      const textNode = node as Text
      // Check for citation markers in text (either Pandoc or legacy format)
      ANY_CITATION_PATTERN.lastIndex = 0
      if (ANY_CITATION_PATTERN.test(textNode.value)) {
        return splitTextWithCitations(textNode.value, marks, lookup)
      }
      return [{
        type: 'text',
        text: textNode.value,
        ...(marks.length > 0 ? { marks: [...marks] } : {}),
      }]
    }

    case 'strong': {
      const strongNode = node as Strong
      const newMarks = [...marks, { type: 'bold' }]
      return strongNode.children.flatMap(child => 
        phrasingToTipTap(child, newMarks, lookup)
      )
    }

    case 'emphasis': {
      const emphasisNode = node as Emphasis
      const newMarks = [...marks, { type: 'italic' }]
      return emphasisNode.children.flatMap(child => 
        phrasingToTipTap(child, newMarks, lookup)
      )
    }

    case 'inlineCode': {
      const codeNode = node as InlineCode
      return [{
        type: 'text',
        text: codeNode.value,
        marks: [...marks, { type: 'code' }],
      }]
    }

    case 'link': {
      const linkNode = node as Link
      const linkMark: Mark = {
        type: 'link',
        attrs: {
          href: linkNode.url,
          target: '_blank',
          ...(linkNode.title ? { title: linkNode.title } : {}),
        },
      }
      const newMarks = [...marks, linkMark]
      return linkNode.children.flatMap(child =>
        phrasingToTipTap(child, newMarks, lookup)
      )
    }

    case 'delete': {
      // Strikethrough (GFM)
      const deleteNode = node as Delete
      const newMarks = [...marks, { type: 'strike' }]
      return deleteNode.children.flatMap(child =>
        phrasingToTipTap(child, newMarks, lookup)
      )
    }

    case 'break': {
      // Hard line break
      return [{ type: 'hardBreak' }]
    }

    case 'image': {
      // Images in markdown are inline elements
      const imageNode = node as Image
      return [{
        type: 'image',
        attrs: {
          src: imageNode.url,
          alt: imageNode.alt || '',
          title: imageNode.title || null,
        },
      }]
    }

    case 'inlineMath': {
      // Inline math: $...$
      const mathNode = node as { type: 'inlineMath'; value: string }
      return [{
        type: 'mathematics',
        attrs: {
          latex: mathNode.value,
          displayMode: false,
        },
      }]
    }

    default:
      // For unsupported inline types, try to extract text
      if ('value' in node && typeof node.value === 'string') {
        return [{
          type: 'text',
          text: node.value,
          ...(marks.length > 0 ? { marks: [...marks] } : {}),
        }]
      }
      if ('children' in node && Array.isArray(node.children)) {
        return (node.children as PhrasingContent[]).flatMap(child =>
          phrasingToTipTap(child, marks, lookup)
        )
      }
      return []
  }
}

/**
 * Convert mdast block/flow content to TipTap nodes
 */
function contentToTipTap(
  node: Content,
  lookup: PaperLookup
): TipTapNode | TipTapNode[] | null {
  switch (node.type) {
    case 'paragraph': {
      const content = node.children.flatMap(child =>
        phrasingToTipTap(child, [], lookup)
      )
      // Filter out empty text nodes
      const filteredContent = content.filter(n => 
        n.type !== 'text' || (n.text && n.text.length > 0)
      )
      if (filteredContent.length === 0) {
        return { type: 'paragraph' }
      }
      return {
        type: 'paragraph',
        content: filteredContent,
      }
    }

    case 'heading': {
      const content = node.children.flatMap(child =>
        phrasingToTipTap(child, [], lookup)
      )
      return {
        type: 'heading',
        attrs: { level: node.depth },
        ...(content.length > 0 ? { content } : {}),
      }
    }

    case 'blockquote': {
      const content = node.children
        .map(child => contentToTipTap(child, lookup))
        .flat()
        .filter((n): n is TipTapNode => n !== null)
      return {
        type: 'blockquote',
        content,
      }
    }

    case 'list': {
      const listType = node.ordered ? 'orderedList' : 'bulletList'
      const content = node.children
        .map(child => contentToTipTap(child, lookup))
        .flat()
        .filter((n): n is TipTapNode => n !== null)
      return {
        type: listType,
        ...(node.ordered && node.start && node.start !== 1
          ? { attrs: { start: node.start } }
          : {}),
        content,
      }
    }

    case 'listItem': {
      // List items contain block content (usually paragraphs)
      const content = node.children
        .map(child => contentToTipTap(child, lookup))
        .flat()
        .filter((n): n is TipTapNode => n !== null)
      
      // Handle task list items (GFM)
      if (node.checked !== null && node.checked !== undefined) {
        return {
          type: 'taskItem',
          attrs: { checked: node.checked },
          content,
        }
      }
      
      return {
        type: 'listItem',
        content,
      }
    }

    case 'code': {
      // Fenced code block
      return {
        type: 'codeBlock',
        attrs: {
          language: node.lang || null,
        },
        content: [{
          type: 'text',
          text: node.value,
        }],
      }
    }

    case 'thematicBreak': {
      return { type: 'horizontalRule' }
    }

    case 'math': {
      // Block math: $$...$$
      const mathNode = node as unknown as { type: 'math'; value: string }
      return {
        type: 'paragraph',
        content: [{
          type: 'mathematics',
          attrs: {
            latex: mathNode.value,
            displayMode: true,
          },
        }],
      }
    }

    case 'table': {
      // GFM table support
      const rows = node.children.map((row, rowIndex) => {
        const cells = row.children.map((cell) => {
          const cellContent = cell.children.flatMap(child =>
            phrasingToTipTap(child as PhrasingContent, [], lookup)
          )
          return {
            type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
            content: cellContent.length > 0
              ? [{ type: 'paragraph', content: cellContent }]
              : [{ type: 'paragraph' }],
          }
        })
        return {
          type: 'tableRow',
          content: cells,
        }
      })
      return {
        type: 'table',
        content: rows,
      }
    }

    case 'html': {
      // Raw HTML - try to preserve as paragraph with text
      // TipTap doesn't have a raw HTML node, so we convert to text
      if (node.value.trim()) {
        return {
          type: 'paragraph',
          content: [{
            type: 'text',
            text: node.value,
          }],
        }
      }
      return null
    }

    case 'definition':
    case 'footnoteDefinition':
      // These are reference definitions, skip them
      return null

    default:
      // For any unhandled types, try to recurse into children
      if ('children' in node && Array.isArray(node.children)) {
        return node.children
          .map((child: Content) => contentToTipTap(child, lookup))
          .flat()
          .filter((n): n is TipTapNode => n !== null)
      }
      return null
  }
}

/**
 * Convert mdast Root to TipTap document JSON
 */
function rootToTipTap(root: Root, lookup: PaperLookup): TipTapNode {
  const content = root.children
    .map(child => contentToTipTap(child, lookup))
    .flat()
    .filter((n): n is TipTapNode => n !== null)

  return {
    type: 'doc',
    content: content.length > 0 ? content : [{ type: 'paragraph' }],
  }
}

/**
 * Main entry point: Convert markdown to TipTap JSON
 * 
 * This is the better pipeline:
 *   markdown → remark AST → TipTap JSON
 * 
 * Instead of the lossy:
 *   markdown → HTML → TipTap JSON → post-process citations
 * 
 * @param markdown - Raw markdown text (may contain [CONTEXT FROM: uuid] markers)
 * @param papers - Array of papers for citation metadata
 * @returns TipTap JSON document
 */
export function markdownToTipTap(
  markdown: string,
  papers: ProjectPaper[] = []
): TipTapNode {
  if (!markdown || markdown.trim() === '') {
    return {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    }
  }

  try {
    // Step 1: Parse markdown to AST
    const ast = parseMarkdown(markdown)

    // Step 2: Create paper lookup for citations
    const lookup = createPaperLookup(papers)

    // Step 3: Convert AST to TipTap JSON (citations handled during conversion)
    const doc = rootToTipTap(ast, lookup)

    if (process.env.NODE_ENV === 'development') {
      console.log('[markdown-to-tiptap] Conversion complete:', {
        inputLength: markdown.length,
        astNodes: ast.children.length,
        outputNodes: doc.content?.length || 0,
        papersAvailable: papers.length,
      })
    }

    return doc
  } catch (err) {
    console.error('[markdown-to-tiptap] Failed to convert:', err)
    // Fallback: return markdown as plain text paragraph
    return {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: markdown }],
      }],
    }
  }
}

/**
 * Check if text contains citation markers (either Pandoc or legacy format)
 */
export function hasCitationMarkers(text: string): boolean {
  ANY_CITATION_PATTERN.lastIndex = 0
  return ANY_CITATION_PATTERN.test(text)
}

/**
 * Extract citation paper IDs from text
 * Supports both [@uuid] (Pandoc) and [CITE: uuid] (legacy) formats
 */
export function extractCitationIds(text: string): string[] {
  // Combined pattern: Group 1 = Pandoc UUID, Group 3 = legacy UUID
  const combinedPattern = /\[@([a-f0-9-]+)\]|\[(CITE|CONTEXT FROM):\s*([a-f0-9-]+)\]/gi
  const ids: string[] = []
  for (const match of text.matchAll(combinedPattern)) {
    const paperId = match[1] || match[3] // Group 1 for Pandoc, Group 3 for legacy
    if (paperId) {
      ids.push(paperId)
    }
  }
  return ids
}
