/**
 * Document Parser
 * 
 * Parses TipTap JSON into a structured format for export.
 * Handles all node types and extracts citations in order of appearance.
 */

import type {
  TipTapDocument,
  TipTapNode,
  TipTapMark,
  ParsedDocument,
  DocumentSection,
  DocumentContent,
  CitationInstance,
  TextChunk,
  CitationRef,
} from './types'

// =============================================================================
// MAIN PARSER
// =============================================================================

export function parseDocument(
  doc: TipTapDocument,
  title: string,
  authors: string[] = [],
  abstract: string = ''
): ParsedDocument {
  const citations: CitationInstance[] = []
  const citedPaperIds = new Set<string>()
  const citationNumbers = new Map<string, number>()
  let citationPosition = 0

  // Helper to track citations
  const trackCitation = (paperId: string, instanceId?: string): number => {
    // Assign citation number based on first appearance
    if (!citationNumbers.has(paperId)) {
      citationNumbers.set(paperId, citationNumbers.size + 1)
    }
    
    const citationNumber = citationNumbers.get(paperId)!
    citedPaperIds.add(paperId)
    
    citations.push({
      paperId,
      instanceId,
      citationNumber,
      position: citationPosition++,
    })
    
    return citationNumber
  }

  // Parse all top-level nodes
  const sections: DocumentSection[] = []
  
  for (const node of doc.content || []) {
    // Skip references block - we generate our own
    if (node.type === 'referencesBlock') {
      continue
    }
    
    const section = parseNode(node, trackCitation)
    if (section) {
      sections.push(section)
    }
  }

  return {
    title,
    authors,
    abstract,
    sections,
    citations,
    citedPaperIds,
    citationNumbers,
  }
}

// =============================================================================
// NODE PARSERS
// =============================================================================

type CitationTracker = (paperId: string, instanceId?: string) => number

function parseNode(
  node: TipTapNode,
  trackCitation: CitationTracker
): DocumentSection | null {
  switch (node.type) {
    case 'paragraph':
      return parseParagraph(node, trackCitation)
    
    case 'heading':
      return parseHeading(node, trackCitation)
    
    case 'bulletList':
      return parseBulletList(node, trackCitation)
    
    case 'orderedList':
      return parseOrderedList(node, trackCitation)
    
    case 'blockquote':
      return parseBlockquote(node, trackCitation)
    
    case 'codeBlock':
      return parseCodeBlock(node)
    
    case 'table':
      return parseTable(node, trackCitation)
    
    case 'horizontalRule':
      return { type: 'horizontalRule', content: [] }
    
    // Skip these
    case 'referencesBlock':
      return null
    
    default:
      // Try to extract content from unknown nodes
      if (node.content) {
        return parseParagraph(node, trackCitation)
      }
      return null
  }
}

function parseParagraph(
  node: TipTapNode,
  trackCitation: CitationTracker
): DocumentSection {
  return {
    type: 'paragraph',
    content: parseInlineContent(node.content || [], trackCitation),
  }
}

function parseHeading(
  node: TipTapNode,
  trackCitation: CitationTracker
): DocumentSection {
  const level = (node.attrs?.level as number) || 1
  return {
    type: 'heading',
    level,
    content: parseInlineContent(node.content || [], trackCitation),
  }
}

function parseBulletList(
  node: TipTapNode,
  trackCitation: CitationTracker
): DocumentSection {
  const items: DocumentSection[][] = []
  
  for (const item of node.content || []) {
    if (item.type === 'listItem') {
      const itemContent: DocumentSection[] = []
      for (const child of item.content || []) {
        const section = parseNode(child, trackCitation)
        if (section) {
          itemContent.push(section)
        }
      }
      items.push(itemContent)
    }
  }
  
  return {
    type: 'bulletList',
    content: [],
    items,
  }
}

function parseOrderedList(
  node: TipTapNode,
  trackCitation: CitationTracker
): DocumentSection {
  const items: DocumentSection[][] = []
  
  for (const item of node.content || []) {
    if (item.type === 'listItem') {
      const itemContent: DocumentSection[] = []
      for (const child of item.content || []) {
        const section = parseNode(child, trackCitation)
        if (section) {
          itemContent.push(section)
        }
      }
      items.push(itemContent)
    }
  }
  
  return {
    type: 'orderedList',
    content: [],
    items,
  }
}

function parseBlockquote(
  node: TipTapNode,
  trackCitation: CitationTracker
): DocumentSection {
  const items: DocumentSection[][] = [[]]
  
  for (const child of node.content || []) {
    const section = parseNode(child, trackCitation)
    if (section) {
      items[0].push(section)
    }
  }
  
  return {
    type: 'blockquote',
    content: [],
    items,
  }
}

function parseCodeBlock(node: TipTapNode): DocumentSection {
  const language = (node.attrs?.language as string) || ''
  const text = node.content?.[0]?.text || ''
  
  return {
    type: 'codeBlock',
    content: [{ type: 'text', text }],
    language,
  }
}

function parseTable(
  node: TipTapNode,
  trackCitation: CitationTracker
): DocumentSection {
  const rows: DocumentSection[][][] = []
  
  for (const row of node.content || []) {
    if (row.type === 'tableRow') {
      const rowCells: DocumentSection[][] = []
      
      for (const cell of row.content || []) {
        if (cell.type === 'tableCell' || cell.type === 'tableHeader') {
          const cellContent: DocumentSection[] = []
          for (const child of cell.content || []) {
            const section = parseNode(child, trackCitation)
            if (section) {
              cellContent.push(section)
            }
          }
          rowCells.push(cellContent)
        }
      }
      
      rows.push(rowCells)
    }
  }
  
  return {
    type: 'table',
    content: [],
    rows,
  }
}

// =============================================================================
// INLINE CONTENT PARSER
// =============================================================================

function parseInlineContent(
  nodes: TipTapNode[],
  trackCitation: CitationTracker
): DocumentContent[] {
  const content: DocumentContent[] = []
  
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        content.push(parseTextNode(node))
        break
      
      case 'citation':
        content.push(parseCitationNode(node, trackCitation))
        break
      
      case 'hardBreak':
        content.push({ type: 'hardBreak' })
        break
      
      default:
        // Try to extract text from unknown inline nodes
        if (node.text) {
          content.push(parseTextNode(node))
        }
        break
    }
  }
  
  return content
}

function parseTextNode(node: TipTapNode): TextChunk {
  const chunk: TextChunk = {
    type: 'text',
    text: node.text || '',
  }
  
  // Apply marks
  if (node.marks) {
    for (const mark of node.marks) {
      switch (mark.type) {
        case 'bold':
          chunk.bold = true
          break
        case 'italic':
          chunk.italic = true
          break
        case 'underline':
          chunk.underline = true
          break
        case 'strike':
          chunk.strikethrough = true
          break
        case 'link':
          // Convert to link type
          return {
            type: 'link',
            text: node.text || '',
            href: (mark.attrs?.href as string) || '',
          } as unknown as TextChunk
        case 'code':
          return {
            type: 'code',
            text: node.text || '',
          } as unknown as TextChunk
      }
    }
  }
  
  return chunk
}

function parseCitationNode(
  node: TipTapNode,
  trackCitation: CitationTracker
): CitationRef {
  const paperId = (node.attrs?.id as string) || ''
  const instanceId = node.attrs?.instanceId as string | undefined
  
  const citationNumber = trackCitation(paperId, instanceId)
  
  return {
    type: 'citation',
    paperId,
    instanceId,
    citationNumber,
  }
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Extract plain text from parsed document (for debugging/preview)
 */
export function documentToPlainText(doc: ParsedDocument): string {
  const lines: string[] = []
  
  if (doc.title) {
    lines.push(doc.title, '')
  }
  
  if (doc.authors.length > 0) {
    lines.push(doc.authors.join(', '), '')
  }
  
  if (doc.abstract) {
    lines.push('Abstract', doc.abstract, '')
  }
  
  for (const section of doc.sections) {
    lines.push(sectionToPlainText(section))
  }
  
  return lines.join('\n')
}

function sectionToPlainText(section: DocumentSection): string {
  switch (section.type) {
    case 'heading':
      return '\n' + contentToPlainText(section.content) + '\n'
    
    case 'paragraph':
      return contentToPlainText(section.content) + '\n'
    
    case 'bulletList':
    case 'orderedList':
      return (section.items || [])
        .map((item, i) => {
          const prefix = section.type === 'orderedList' ? `${i + 1}. ` : '• '
          return prefix + item.map(s => sectionToPlainText(s)).join('')
        })
        .join('\n') + '\n'
    
    case 'blockquote':
      return '> ' + (section.items?.[0] || [])
        .map(s => sectionToPlainText(s))
        .join('') + '\n'
    
    case 'codeBlock':
      return '```\n' + contentToPlainText(section.content) + '\n```\n'
    
    case 'horizontalRule':
      return '---\n'
    
    default:
      return contentToPlainText(section.content) + '\n'
  }
}

function contentToPlainText(content: DocumentContent[]): string {
  return content.map(c => {
    switch (c.type) {
      case 'text':
        return c.text
      case 'citation':
        return `[${c.citationNumber}]`
      case 'code':
        return `\`${c.text}\``
      case 'link':
        return c.text
      case 'hardBreak':
        return '\n'
      default:
        return ''
    }
  }).join('')
}
