/**
 * Markdown block boundary detection for streaming content
 * Enhanced with factory pattern, robust fence detection, and proper line anchoring
 */

// Pre-compiled regexes - improved with better anchoring
const HEADING_RE = /^(#{1,6})[ \t]+([^\n]+)\n?/
const CODE_OPEN_RE = /^```(\w+)?[ \t]*\r?\n/
const CODE_CLOSE_RE = /\r?\n```[ \t]*\r?\n?/
const QUOTE_RE = /^(>.*(?:\n>.*)*)\n?/
const LIST_RE = /^((?:[-*+]|\d+\.)[ \t]+.*(?:\n(?:[-*+]|\d+\.)[ \t]+.*)*)\n?/
const PARA_RE = /^([\s\S]+?)\n{2,}/

// Define block types once for consistency
export type BlockKind = 'heading' | 'paragraph' | 'code' | 'quote' | 'list'

export interface BlockBoundary {
  type: BlockKind
  content: string
  metadata?: Record<string, unknown>
  remainder: string
  toBlock(documentId: string, position: number): BlockContent
}

// Proper typing for block content
export interface BlockContent {
  id: string
  type: BlockKind
  position: number
  content: {
    type: string
    attrs?: Record<string, unknown>
    content?: Array<{ type: string; text?: string; content?: unknown }>
  }
  metadata: Record<string, unknown>
}

// Factory function to avoid global state conflicts
export function createMarkdownDetector() {
  let openFence: { lang: string; content: string } | null = null

  const resetFenceState = (): void => {
    openFence = null
  }

  const isInsideFence = (): boolean => {
    return openFence !== null
  }

  /**
   * Detects block boundaries in streaming markdown content
   */
  const detectBlockBoundary = (buffer: string): BlockBoundary | null => {
    const trimmed = buffer.trim()
    if (!trimmed) return null

    // Handle ongoing code fence with robust close detection
    if (openFence) {
      const closeMatch = CODE_CLOSE_RE.exec(buffer)
      if (!closeMatch) return null // Still waiting for closing fence
      
      const closeIdx = closeMatch.index
      const code = buffer.slice(0, closeIdx)
      const rest = buffer.slice(closeIdx + closeMatch[0].length)
      const { lang } = openFence
      openFence = null
      
      return {
        type: 'code',
        content: code,
        metadata: { language: lang },
        remainder: rest.trim(),
        toBlock: (documentId: string, position: number) => ({
          id: '',
          type: 'code',
          position,
          content: {
            type: 'codeBlock',
            attrs: { language: lang },
            content: [{ type: 'text', text: code }]
          },
          metadata: { language: lang, documentId }
        })
      }
    }

    // Check for opening code fence (use buffer, not trimmed)
    const openMatch = CODE_OPEN_RE.exec(buffer)
    if (openMatch) {
      openFence = { lang: openMatch[1] || '', content: '' }
      return null // Wait for closing fence
    }

    // Ensure line anchoring by prepending newline for heading check
    const headingBuffer = '\n' + trimmed
    const headingMatch = HEADING_RE.exec(headingBuffer)
    if (headingMatch && headingMatch.index === 0) { // Must be at start after newline
      const [, hashes, title] = headingMatch
      const consumedLength = headingMatch[0].length - 1 // Subtract the prepended \n
      const remainder = trimmed.slice(consumedLength)
      return {
        type: 'heading',
        content: title.trim(),
        metadata: { level: hashes.length },
        remainder: remainder.trim(),
        toBlock: (documentId: string, position: number) => ({
          id: '',
          type: 'heading',
          position,
          content: {
            type: 'heading',
            attrs: { level: hashes.length },
            content: [{ type: 'text', text: title.trim() }]
          },
          metadata: { level: hashes.length, documentId }
        })
      }
    }

    // Check for complete code fence (both open and close) - using pre-compiled style
    const completeFenceRe = /^```(\w+)?\r?\n([\s\S]*?)\r?\n```(?:\r?\n([\s\S]*))?$/
    const codeFenceMatch = completeFenceRe.exec(trimmed)
    if (codeFenceMatch) {
      const [, language = '', code, remainder = ''] = codeFenceMatch
      return {
        type: 'code',
        content: code,
        metadata: { language },
        remainder: remainder.trim(),
        toBlock: (documentId: string, position: number) => ({
          id: '',
          type: 'code',
          position,
          content: {
            type: 'codeBlock',
            attrs: { language },
            content: [{ type: 'text', text: code }]
          },
          metadata: { language, documentId }
        })
      }
    }

    // Check for blockquote with line anchoring
    const quoteBuffer = '\n' + trimmed
    const quoteMatch = QUOTE_RE.exec(quoteBuffer)
    if (quoteMatch && quoteMatch.index === 0) {
      const [fullMatch, quoteLines] = quoteMatch
      const content = quoteLines
        .split('\n')
        .map(line => line.replace(/^>\s?/, ''))
        .join('\n')
        .trim()
      const consumedLength = fullMatch.length - 1 // Subtract the prepended \n
      const remainder = trimmed.slice(consumedLength)
      
      return {
        type: 'quote',
        content,
        metadata: {},
        remainder: remainder.trim(),
        toBlock: (documentId: string, position: number) => ({
          id: '',
          type: 'quote',
          position,
          content: {
            type: 'blockquote',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: content }] }]
          },
          metadata: { documentId }
        })
      }
    }

    // Check for list with line anchoring
    const listBuffer = '\n' + trimmed
    const listMatch = LIST_RE.exec(listBuffer)
    if (listMatch && listMatch.index === 0) {
      const [fullMatch, listLines] = listMatch
      const items = listLines
        .split('\n')
        .filter(line => line.trim())
        .map(line => line.replace(/^(?:[-*+]|\d+\.)\s+/, '').trim())
      const consumedLength = fullMatch.length - 1 // Subtract the prepended \n
      const remainder = trimmed.slice(consumedLength)
      
      return {
        type: 'list',
        content: items.join('\n'),
        metadata: { items },
        remainder: remainder.trim(),
        toBlock: (documentId: string, position: number) => ({
          id: '',
          type: 'list',
          position,
          content: {
            type: 'bulletList',
            content: items.map(item => ({
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: item }] }]
            }))
          },
          metadata: { itemCount: items.length, documentId }
        })
      }
    }

    // Check for paragraph break using pre-compiled regex
    const paragraphMatch = PARA_RE.exec(trimmed)
    if (paragraphMatch) {
      const [, paragraph] = paragraphMatch
      const remainder = trimmed.slice(paragraphMatch[0].length)
      return {
        type: 'paragraph',
        content: paragraph.trim(),
        metadata: {},
        remainder: remainder.trim(),
        toBlock: (documentId: string, position: number) => ({
          id: '',
          type: 'paragraph',
          position,
          content: {
            type: 'paragraph',
            content: [{ type: 'text', text: paragraph.trim() }]
          },
          metadata: { documentId }
        })
      }
    }

    // Smarter paragraph overflow with sentence boundaries
    const BUFFER_SIZE_LIMIT = 800
    if (trimmed.length > BUFFER_SIZE_LIMIT && !trimmed.includes('\n\n')) {
      // Try to break at sentence boundary
      const sentenceBreak = breakAtSentence(trimmed, BUFFER_SIZE_LIMIT)
      if (sentenceBreak && sentenceBreak.length < trimmed.length) {
        const remainder = trimmed.slice(sentenceBreak.length).trim()
        return {
          type: 'paragraph',
          content: sentenceBreak,
          metadata: { 
            forcedBreak: true, 
            breakType: 'sentence',
            overflowAt: sentenceBreak.length // Track overflow position
          },
          remainder,
          toBlock: (documentId: string, position: number) => ({
            id: '',
            type: 'paragraph',
            position,
            content: {
              type: 'paragraph',
              content: [{ type: 'text', text: sentenceBreak }]
            },
            metadata: { 
              forcedBreak: true, 
              breakType: 'sentence', 
              overflowAt: sentenceBreak.length,
              documentId 
            }
          })
        }
      }
      
      // Fallback: break at word boundary
      const words = trimmed.split(/\s+/)
      const halfWords = words.slice(0, Math.floor(words.length / 2))
      const remainder = words.slice(halfWords.length)
      const wordBreakContent = halfWords.join(' ')
      
      return {
        type: 'paragraph',
        content: wordBreakContent,
        metadata: { 
          forcedBreak: true, 
          breakType: 'word',
          overflowAt: wordBreakContent.length
        },
        remainder: remainder.join(' '),
        toBlock: (documentId: string, position: number) => ({
          id: '',
          type: 'paragraph',
          position,
          content: {
            type: 'paragraph',
            content: [{ type: 'text', text: wordBreakContent }]
          },
          metadata: { 
            forcedBreak: true, 
            breakType: 'word', 
            overflowAt: wordBreakContent.length,
            documentId 
          }
        })
      }
    }

    return null
  }

  // Return detector instance with state management
  return {
    detectBlockBoundary,
    resetFenceState,
    isInsideFence
  }
}

/**
 * Smart sentence boundary detection with international support
 * Enhanced to handle multiple languages better
 */
function breakAtSentence(text: string, maxLength: number = 800): string {
  // Try Intl.Segmenter if available (Node 16+, modern browsers)
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    try {
      // Type assertion for Intl.Segmenter which may not be in all TypeScript versions
      const IntlSegmenter = (Intl as { Segmenter?: new (locale: string, options: { granularity: string }) => { segment: (text: string) => Iterable<{ segment: string }> } }).Segmenter
      if (IntlSegmenter) {
        const segmenter = new IntlSegmenter('en', { granularity: 'sentence' })
        let accumulated = ''
        
        for (const { segment } of segmenter.segment(text)) {
          const potential = accumulated + segment
          if (potential.length > maxLength) break
          accumulated = potential
        }
        
        return accumulated.trim()
      }
    } catch {
      // Fallback to simple approach
    }
  }
  
  // Fallback: Simple sentence boundary detection
  const sentences = text.split(/(?<=[.!?])\s+/)
  let accumulated = ''
  
  for (const sentence of sentences) {
    const potential = accumulated + (accumulated ? ' ' : '') + sentence
    if (potential.length > maxLength) {
      break
    }
    accumulated = potential
  }
  
  return accumulated.trim()
}

/**
 * Default detector instance for backward compatibility
 */
const defaultDetector = createMarkdownDetector()

// Export convenience functions that use the default instance
export const detectBlockBoundary = defaultDetector.detectBlockBoundary
export const resetFenceState = defaultDetector.resetFenceState
export const isInsideFence = defaultDetector.isInsideFence

/**
 * Count words in text more accurately than character counting
 */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

/**
 * Extract text content from Tiptap block content
 * Iterative approach to avoid stack overflow on deeply nested structures
 */
export function extractTextFromBlock(content: BlockContent['content']): string {
  const stack = [content]
  let result = ''
  
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || !Array.isArray(current.content)) continue
    
    for (const node of current.content) {
      if (node.type === 'text') {
        result += node.text || ''
      } else if (node.content) {
        stack.push(node as BlockContent['content'])
      }
    }
  }
  
  return result
}

