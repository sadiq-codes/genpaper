/**
 * Structure-Aware Text Search
 * 
 * Searches for text directly in the ProseMirror document structure,
 * returning document positions without needing index conversion.
 * 
 * Key benefits over editor.getText() + fuzzyFindPhrase():
 * 1. Returns exact document positions (no conversion drift)
 * 2. Can differentiate node types (heading vs paragraph)
 * 3. Single traversal (more efficient)
 * 4. Citation-aware (uses [@paperId#instanceId] markers)
 * 
 * This fixes two known bugs:
 * - Position mapping errors (edits landing in wrong place)
 * - Repeated text wrong matches (e.g., two "Introduction" occurrences)
 */

import type { Editor } from '@tiptap/react'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { similarity } from '@/lib/utils/fuzzy-match'
import { getNodeTextWithCitations } from './ai-context-serializer'

// =============================================================================
// TYPES
// =============================================================================

export interface StructureMatch {
  found: boolean
  node: ProseMirrorNode | null
  pos: number              // Document position of the node start
  startOffset: number      // Offset within node's text content
  endOffset: number        // Offset within node's text content
  similarity: number       // 0-1 match quality
  nodeType: string         // 'heading' | 'paragraph' | 'listItem' | etc.
  blockId?: string         // Block ID if available
}

export interface SearchOptions {
  blockId?: string           // Scope to specific block
  section?: string           // Scope to section content
  nodeTypes?: string[]       // Only match in these node types (e.g., ['heading', 'paragraph'])
  minSimilarity?: number     // Minimum similarity threshold (default 0.6)
}

export interface SectionBounds {
  found: boolean
  headingPos: number         // Position of heading node
  headingEndPos: number      // End of heading node
  contentStartPos: number    // Start of section content (after heading)
  contentEndPos: number      // End of section content (before next heading or doc end)
  headingText: string        // The matched heading text
}

// Node type priority for disambiguation when multiple matches found
// Higher = preferred
const NODE_TYPE_PRIORITY: Record<string, number> = {
  heading: 100,
  paragraph: 50,
  listItem: 40,
  blockquote: 30,
  codeBlock: 20,
  tableCell: 15,
}

const DEFAULT_PRIORITY = 10

// =============================================================================
// MAIN SEARCH FUNCTION
// =============================================================================

/**
 * Find text in document structure, returning exact positions.
 * 
 * Handles disambiguation by preferring:
 * 1. Higher node type priority (heading > paragraph > etc.)
 * 2. Higher similarity score
 * 
 * @example
 * // Find "Introduction" - will prefer heading over paragraph
 * const match = findTextInStructure(editor, 'Introduction')
 * if (match.found) {
 *   const from = match.pos + match.startOffset
 *   const to = match.pos + match.endOffset
 * }
 */
export function findTextInStructure(
  editor: Editor,
  searchPhrase: string,
  options: SearchOptions = {}
): StructureMatch {
  const {
    blockId,
    section,
    nodeTypes,
    minSimilarity = 0.6
  } = options

  const normalizedSearch = normalizeText(searchPhrase)
  
  // If blockId specified, search only in that block
  if (blockId) {
    return findInBlock(editor, blockId, normalizedSearch, searchPhrase.length, minSimilarity)
  }
  
  // If section specified, find section bounds first
  if (section) {
    const sectionBounds = findSectionBounds(editor, section)
    if (!sectionBounds.found) {
      return notFound()
    }
    return findInRange(
      editor, 
      normalizedSearch, 
      searchPhrase.length,
      minSimilarity,
      sectionBounds.contentStartPos,
      sectionBounds.contentEndPos,
      nodeTypes
    )
  }
  
  // Search entire document
  return findInRange(editor, normalizedSearch, searchPhrase.length, minSimilarity, 0, undefined, nodeTypes)
}

/**
 * Find section boundaries in the document.
 * Returns positions of heading and content range.
 */
export function findSectionBounds(
  editor: Editor,
  sectionName: string
): SectionBounds {
  const normalizedName = normalizeText(sectionName)
  
  interface HeadingInfo {
    pos: number
    endPos: number
    text: string
    similarity: number
  }
  
  const headings: HeadingInfo[] = []
  
  // Collect all headings
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const text = node.textContent
      const sim = similarity(normalizeText(text), normalizedName)
      headings.push({
        pos,
        endPos: pos + node.nodeSize,
        text,
        similarity: sim
      })
    }
  })
  
  // Find best matching heading
  let bestMatch: HeadingInfo | null = null
  for (const heading of headings) {
    if (heading.similarity >= 0.5) {
      if (!bestMatch || heading.similarity > bestMatch.similarity) {
        bestMatch = heading
      }
    }
  }
  
  if (!bestMatch) {
    return {
      found: false,
      headingPos: -1,
      headingEndPos: -1,
      contentStartPos: -1,
      contentEndPos: -1,
      headingText: ''
    }
  }
  
  // Find next heading (section end) or document end
  let contentEndPos = editor.state.doc.content.size
  for (const heading of headings) {
    if (heading.pos > bestMatch.pos && heading.pos < contentEndPos) {
      contentEndPos = heading.pos
    }
  }
  
  return {
    found: true,
    headingPos: bestMatch.pos,
    headingEndPos: bestMatch.endPos,
    contentStartPos: bestMatch.endPos,
    contentEndPos,
    headingText: bestMatch.text
  }
}

// =============================================================================
// INTERNAL SEARCH FUNCTIONS
// =============================================================================

/**
 * Search within a specific block by ID.
 */
function findInBlock(
  editor: Editor,
  blockId: string,
  normalizedSearch: string,
  searchLength: number,
  minSimilarity: number
): StructureMatch {
  let result: StructureMatch = notFound()
  
  editor.state.doc.descendants((node, pos) => {
    if (result.found) return false // Already found
    
    if (node.attrs.blockId === blockId) {
      const text = getNodeTextWithCitations(node)
      const match = findBestMatchInText(text, normalizedSearch, searchLength, minSimilarity)
      
      if (match.found) {
        result = {
          found: true,
          node,
          pos: pos + 1, // +1 to skip the opening tag
          startOffset: match.startOffset,
          endOffset: match.endOffset,
          similarity: match.similarity,
          nodeType: node.type.name,
          blockId: node.attrs.blockId
        }
      }
      return false // Stop traversal
    }
  })
  
  return result
}

/**
 * Search within a position range, collecting all matches and picking best.
 */
function findInRange(
  editor: Editor,
  normalizedSearch: string,
  searchLength: number,
  minSimilarity: number,
  startPos: number,
  endPos?: number,
  nodeTypes?: string[]
): StructureMatch {
  const matches: StructureMatch[] = []
  const docEndPos = endPos ?? editor.state.doc.content.size
  
  editor.state.doc.descendants((node, pos) => {
    // Skip nodes outside range
    if (pos < startPos || pos >= docEndPos) return
    
    // Skip non-text-containing blocks
    if (!node.isTextblock) return
    
    // Filter by node type if specified
    if (nodeTypes && !nodeTypes.includes(node.type.name)) return
    
    const text = getNodeTextWithCitations(node)
    if (!text.trim()) return // Skip empty nodes
    
    const match = findBestMatchInText(text, normalizedSearch, searchLength, minSimilarity)
    
    if (match.found) {
      matches.push({
        found: true,
        node,
        pos: pos + 1, // +1 to skip the opening tag
        startOffset: match.startOffset,
        endOffset: match.endOffset,
        similarity: match.similarity,
        nodeType: node.type.name,
        blockId: node.attrs.blockId
      })
    }
  })
  
  if (matches.length === 0) {
    return notFound()
  }
  
  // Pick best match using priority + similarity
  return pickBestMatch(matches)
}

/**
 * Find best match within a text string.
 * Returns character offsets within the text.
 */
function findBestMatchInText(
  text: string,
  normalizedSearch: string,
  searchLength: number,
  minSimilarity: number
): { found: boolean; startOffset: number; endOffset: number; similarity: number } {
  const normalizedText = normalizeText(text)
  
  // Strategy 1: Exact substring match (fastest)
  const exactIndex = normalizedText.indexOf(normalizedSearch)
  if (exactIndex !== -1) {
    // Map back to original text position
    const originalStart = mapToOriginalPosition(text, exactIndex)
    const originalEnd = mapToOriginalPosition(text, exactIndex + normalizedSearch.length)
    
    return {
      found: true,
      startOffset: originalStart,
      endOffset: originalEnd,
      similarity: 1.0
    }
  }
  
  // Strategy 2: Sliding window fuzzy match
  const windowSize = Math.ceil(searchLength * 1.3)
  let bestMatch = { found: false, startOffset: 0, endOffset: 0, similarity: 0 }
  
  // Sample positions for performance (don't check every character)
  const step = Math.max(1, Math.floor(searchLength / 10))
  
  for (let i = 0; i <= normalizedText.length - normalizedSearch.length; i += step) {
    const candidate = normalizedText.slice(i, i + windowSize)
    const sim = similarity(candidate, normalizedSearch)
    
    if (sim > bestMatch.similarity && sim >= minSimilarity) {
      const originalStart = mapToOriginalPosition(text, i)
      const originalEnd = mapToOriginalPosition(text, Math.min(i + searchLength, normalizedText.length))
      
      bestMatch = {
        found: true,
        startOffset: originalStart,
        endOffset: originalEnd,
        similarity: sim
      }
    }
  }
  
  return bestMatch
}

/**
 * Pick the best match from multiple candidates.
 * Uses node type priority and similarity score.
 */
function pickBestMatch(matches: StructureMatch[]): StructureMatch {
  if (matches.length === 0) return notFound()
  if (matches.length === 1) return matches[0]
  
  // Calculate composite score: priority weight (0.3) + similarity weight (0.7)
  // This means a heading with 0.8 similarity beats a paragraph with 0.9 similarity
  const scored = matches.map(m => {
    const priority = NODE_TYPE_PRIORITY[m.nodeType] ?? DEFAULT_PRIORITY
    const normalizedPriority = priority / 100 // Convert to 0-1 scale
    const compositeScore = normalizedPriority * 0.3 + m.similarity * 0.7
    return { match: m, score: compositeScore }
  })
  
  // Sort by composite score descending
  scored.sort((a, b) => b.score - a.score)
  
  const best = scored[0].match
  
  // Log disambiguation if multiple high-quality matches
  if (scored.length > 1 && scored[1].score > 0.7) {
  }
  
  return best
}

// =============================================================================
// HELPERS
// =============================================================================

function notFound(): StructureMatch {
  return {
    found: false,
    node: null,
    pos: -1,
    startOffset: 0,
    endOffset: 0,
    similarity: 0,
    nodeType: ''
  }
}

/**
 * Normalize text for comparison (lowercase, collapse whitespace).
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Map a position in normalized text back to original text position.
 * Accounts for whitespace collapsing.
 */
function mapToOriginalPosition(original: string, normalizedPos: number): number {
  let origIdx = 0
  let normIdx = 0
  let inWhitespace = false
  
  // Skip leading whitespace in original
  while (origIdx < original.length && /\s/.test(original[origIdx])) {
    origIdx++
  }

  while (normIdx < normalizedPos && origIdx < original.length) {
    const char = original[origIdx]
    const isWs = /\s/.test(char)

    if (isWs) {
      if (!inWhitespace) {
        normIdx++ // Count first whitespace as single space
        inWhitespace = true
      }
    } else {
      normIdx++
      inWhitespace = false
    }
    origIdx++
  }

  return origIdx
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Find text within a section.
 * Convenience wrapper around findTextInStructure with section option.
 */
export function findInSectionStructure(
  editor: Editor,
  sectionName: string,
  searchPhrase: string,
  options: Omit<SearchOptions, 'section'> = {}
): StructureMatch {
  return findTextInStructure(editor, searchPhrase, { ...options, section: sectionName })
}

/**
 * Calculate document positions from a structure match.
 * Returns { from, to } ready for editor operations.
 */
export function matchToRange(match: StructureMatch): { from: number; to: number } | null {
  if (!match.found) return null
  return {
    from: match.pos + match.startOffset,
    to: match.pos + match.endOffset
  }
}
