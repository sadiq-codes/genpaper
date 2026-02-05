/**
 * AI Context Serializer
 * 
 * Serializes TipTap document to plain text for AI context.
 * 
 * Key difference from editor.getText():
 * - Citations render as [CITE: paperId] markers (not formatted text)
 * - This lets AI see where citations exist and preserve them
 * - AI can add new citations using the same marker format
 * 
 * Key difference from tiptapToMarkdown():
 * - Outputs plain text (no markdown formatting like **, *, etc.)
 * - Simpler output focused on content + citation markers
 */

import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/**
 * Serialize a ProseMirror document to plain text with citation markers.
 * 
 * @param doc - ProseMirror document node
 * @returns Plain text with [CITE: paperId] markers for citations
 * 
 * @example
 * Input: Document with citation nodes
 * Output: "Climate change impacts are significant [CITE: abc123] and require attention."
 */
export function serializeForAIContext(doc: ProseMirrorNode): string {
  const chunks: string[] = []
  
  doc.descendants((node, _pos) => {
    if (node.isText) {
      chunks.push(node.text || '')
      return false // Don't descend into text nodes
    }
    
    if (node.type.name === 'citation') {
      // Serialize citation as marker format
      const paperId = node.attrs.id || 'unknown'
      const marker = `[CITE: ${paperId}]`
      chunks.push(marker)
      return false
    }
    
    if (node.type.name === 'hardBreak') {
      chunks.push('\n')
      return false
    }
    
    // Block-level elements that should have newlines
    if (node.isBlock && chunks.length > 0) {
      const lastChunk = chunks[chunks.length - 1]
      if (lastChunk && !lastChunk.endsWith('\n\n')) {
        if (lastChunk.endsWith('\n')) {
          chunks.push('\n')
        } else {
          chunks.push('\n\n')
        }
      }
    }
    
    // Add heading markers for structure
    if (node.type.name === 'heading') {
      const level = node.attrs.level || 1
      chunks.push('#'.repeat(level) + ' ')
    }
    
    // Add list item markers
    if (node.type.name === 'listItem') {
      chunks.push('- ')
    }
    
    // Add blockquote markers
    if (node.type.name === 'blockquote') {
      chunks.push('> ')
    }
    
    return true // Continue descending into children
  })
  
  return chunks.join('')
    .replace(/\n{3,}/g, '\n\n') // Collapse multiple newlines
    .trim()
}

/**
 * Get text content of a single node with citation markers.
 * Used for document structure preview.
 * 
 * @param node - ProseMirror node
 * @returns Plain text with citation markers
 */
export function getNodeTextWithCitations(node: ProseMirrorNode): string {
  const chunks: string[] = []
  
  node.descendants((child, _pos) => {
    if (child.isText) {
      chunks.push(child.text || '')
      return false
    }
    
    if (child.type.name === 'citation') {
      const paperId = child.attrs.id || 'unknown'
      const marker = `[CITE: ${paperId}]`
      chunks.push(marker)
      return false
    }
    
    if (child.type.name === 'hardBreak') {
      chunks.push(' ')
      return false
    }
    
    return true
  })
  
  return chunks.join('').replace(/\s+/g, ' ').trim()
}
