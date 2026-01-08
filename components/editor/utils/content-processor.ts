import { generateJSON } from '@tiptap/core'
import { marked } from 'marked'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import { Citation, type CitationAttributes } from '../extensions/Citation'
import type { ProjectPaper } from '../types'

// Citation marker pattern: [CONTEXT FROM: uuid]
// Note: Create new regex instances in functions to avoid global state issues
function createCitationPattern(): RegExp {
  return /\[CONTEXT FROM:\s*([a-f0-9-]+)\]/gi
}

// Extensions needed for parsing (subset of full editor extensions)
const parserExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
  }),
  Underline,
  Link,
  Highlight,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Citation,
]

interface PaperLookup {
  [paperId: string]: ProjectPaper
}

/**
 * Extracts all citation markers from text and returns their paper IDs
 */
export function extractCitationMarkers(text: string): string[] {
  const pattern = createCitationPattern()
  const markers: string[] = []
  let match
  while ((match = pattern.exec(text)) !== null) {
    markers.push(match[1])
  }
  return markers
}

/**
 * Creates a paper lookup map for quick access
 */
export function createPaperLookup(papers: ProjectPaper[]): PaperLookup {
  const lookup: PaperLookup = {}
  for (const paper of papers) {
    lookup[paper.id] = paper
  }
  return lookup
}

/**
 * Converts a paper to citation attributes
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
 * Process a TipTap JSON node tree and replace citation markers with citation nodes
 */
function processTipTapNode(
  node: any,
  paperLookup: PaperLookup
): any {
  // If it's a text node, check for citation markers
  if (node.type === 'text' && node.text) {
    const text = node.text as string
    const pattern = createCitationPattern()
    const matches = [...text.matchAll(pattern)]
    
    if (matches.length === 0) {
      return node
    }

    // Split text by citation markers and create mixed content
    const result: any[] = []
    let lastIndex = 0

    for (const match of matches) {
      const paperId = match[1]
      const matchStart = match.index!
      const matchEnd = matchStart + match[0].length

      // Add text before the marker
      if (matchStart > lastIndex) {
        const textBefore = text.slice(lastIndex, matchStart)
        if (textBefore) {
          result.push({
            type: 'text',
            text: textBefore,
            ...(node.marks ? { marks: node.marks } : {}),
          })
        }
      }

      // Add citation node if paper exists
      const paper = paperLookup[paperId]
      if (paper) {
        result.push({
          type: 'citation',
          attrs: paperToCitationAttrs(paper),
        })
      } else {
        // Paper not found - keep as text but format nicely
        result.push({
          type: 'text',
          text: `[Citation: ${paperId.slice(0, 8)}...]`,
          ...(node.marks ? { marks: node.marks } : {}),
        })
      }

      lastIndex = matchEnd
    }

    // Add remaining text after last marker
    if (lastIndex < text.length) {
      result.push({
        type: 'text',
        text: text.slice(lastIndex),
        ...(node.marks ? { marks: node.marks } : {}),
      })
    }

    return result
  }

  // If node has content (children), process them recursively
  if (node.content && Array.isArray(node.content)) {
    const processedContent: any[] = []
    
    for (const child of node.content) {
      const processed = processTipTapNode(child, paperLookup)
      if (Array.isArray(processed)) {
        processedContent.push(...processed)
      } else {
        processedContent.push(processed)
      }
    }
    
    return {
      ...node,
      content: processedContent,
    }
  }

  return node
}

/**
 * Configure marked for safe HTML output
 */
function configureMarked() {
  marked.setOptions({
    gfm: true,
    breaks: false,
  })
}

/**
 * Main processor: Convert markdown with citation markers to TipTap JSON
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

  // Step 1: Configure marked
  configureMarked()

  // Step 2: Convert markdown to HTML
  // First, temporarily replace citation markers with placeholders that won't be escaped
  const placeholders: Map<string, string> = new Map()
  let placeholderIndex = 0
  
  const citationPattern = createCitationPattern()
  const markdownWithPlaceholders = markdown.replace(
    citationPattern,
    (match, paperId) => {
      const placeholder = `__CITATION_${placeholderIndex}__`
      placeholders.set(placeholder, paperId)
      placeholderIndex++
      return placeholder
    }
  )

  // Parse markdown to HTML
  let html = marked.parse(markdownWithPlaceholders) as string

  // Restore citation markers in HTML
  for (const [placeholder, paperId] of placeholders) {
    html = html.replace(placeholder, `[CONTEXT FROM: ${paperId}]`)
  }

  // Step 3: Convert HTML to TipTap JSON
  const json = generateJSON(html, parserExtensions)

  // Step 4: Process the JSON tree to replace citation markers with nodes
  const paperLookup = createPaperLookup(papers)
  const processedJson = processTipTapNode(json, paperLookup)

  return processedJson
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
  const pattern = createCitationPattern()
  const matches = [...text.matchAll(pattern)]

  if (matches.length === 0) {
    // No citations, return as simple text
    return [{ type: 'text', text }]
  }

  const result: any[] = []
  let lastIndex = 0

  for (const match of matches) {
    const paperId = match[1]
    const matchStart = match.index!
    const matchEnd = matchStart + match[0].length

    // Add text before the marker
    if (matchStart > lastIndex) {
      const textBefore = text.slice(lastIndex, matchStart)
      if (textBefore) {
        result.push({ type: 'text', text: textBefore })
      }
    }

    // Add citation node if paper exists
    const paper = paperLookup[paperId]
    if (paper) {
      result.push({
        type: 'citation',
        attrs: paperToCitationAttrs(paper),
      })
    } else {
      // Paper not found - format as text
      result.push({
        type: 'text',
        text: `[Citation: ${paperId.slice(0, 8)}...]`,
      })
    }

    lastIndex = matchEnd
  }

  // Add remaining text
  if (lastIndex < text.length) {
    result.push({ type: 'text', text: text.slice(lastIndex) })
  }

  return result
}

/**
 * Check if text contains any citation markers
 */
export function hasCitationMarkers(text: string): boolean {
  const pattern = createCitationPattern()
  return pattern.test(text)
}

/**
 * Check if text contains markdown formatting
 */
export function hasMarkdownFormatting(text: string): boolean {
  // Check for common markdown patterns
  const markdownPatterns = [
    /^#{1,6}\s+/m,           // Headers
    /\*\*[^*]+\*\*/,         // Bold
    /\*[^*]+\*/,             // Italic
    /`[^`]+`/,               // Inline code
    /```[\s\S]*```/,         // Code blocks
    /^\s*[-*+]\s+/m,         // Unordered lists
    /^\s*\d+\.\s+/m,         // Ordered lists
    /^\s*>/m,                // Blockquotes
    /\[([^\]]+)\]\([^)]+\)/, // Links
  ]

  return markdownPatterns.some(pattern => pattern.test(text))
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
    // Full markdown processing
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
