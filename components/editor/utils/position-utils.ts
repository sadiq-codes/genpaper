/**
 * Position Utilities - Shared helpers for TipTap position calculations
 * 
 * These utilities handle the conversion between plain text indices and
 * ProseMirror document positions, which is needed for fuzzy text matching.
 * 
 * IMPORTANT: TipTap's getText() uses '\n\n' (2 newlines) as the default
 * block separator. All position calculations must account for this.
 */

import type { Editor } from '@tiptap/react'

/**
 * Convert a plain text index to TipTap document position.
 * 
 * This is needed because editor.getText() returns a plain string, but
 * ProseMirror uses a position system that includes block boundaries.
 * 
 * IMPORTANT: By default, TipTap's getText() uses '\n\n' (2 newlines) as
 * the block separator. This function must match that behavior exactly.
 * 
 * @param editor - TipTap editor instance
 * @param textIndex - Index in the plain text (from getText())
 * @param blockSeparatorLength - Length of separator used in getText() (default: 2 for '\n\n')
 * @returns ProseMirror document position
 */
export function textIndexToDocPosition(
  editor: Editor, 
  textIndex: number,
  blockSeparatorLength: number = 2
): number {
  let charCount = 0
  let position = 0
  let found = false
  let passedFirstBlock = false

  editor.state.doc.descendants((node, pos) => {
    if (found) return false

    if (node.isText && node.text) {
      const nodeLength = node.text.length
      
      if (charCount + nodeLength >= textIndex) {
        position = pos + (textIndex - charCount)
        found = true
        return false
      }
      
      charCount += nodeLength
    } else if (node.isBlock) {
      // Add separator BETWEEN blocks (not before first block)
      // TipTap's getText() uses '\n\n' (2 chars) by default
      if (passedFirstBlock) {
        // Check if target is within the separator itself
        if (charCount + blockSeparatorLength > textIndex) {
          // Position at the block boundary
          position = pos
          found = true
          return false
        }
        charCount += blockSeparatorLength
      }
      passedFirstBlock = true
    }

    return true
  })

  return found ? position : editor.state.doc.content.size
}

/**
 * Convert a ProseMirror document position to plain text index.
 * 
 * This is the inverse of textIndexToDocPosition.
 * 
 * @param editor - TipTap editor instance
 * @param docPosition - ProseMirror document position
 * @param blockSeparatorLength - Length of separator used in getText() (default: 2 for '\n\n')
 * @returns Index in the plain text (from getText())
 */
export function docPositionToTextIndex(
  editor: Editor, 
  docPosition: number,
  blockSeparatorLength: number = 2
): number {
  let charCount = 0
  let found = false
  let result = 0
  let passedFirstBlock = false

  editor.state.doc.descendants((node, pos) => {
    if (found) return false

    if (pos >= docPosition) {
      // We've passed the target position
      result = charCount + (docPosition - pos)
      found = true
      return false
    }

    if (node.isText && node.text) {
      const nodeEnd = pos + node.text.length
      if (nodeEnd >= docPosition) {
        result = charCount + (docPosition - pos)
        found = true
        return false
      }
      charCount += node.text.length
    } else if (node.isBlock) {
      // Add separator BETWEEN blocks (not before first block)
      if (passedFirstBlock) {
        charCount += blockSeparatorLength
      }
      passedFirstBlock = true
    }

    return true
  })

  return found ? result : charCount
}

/**
 * Validate that document positions are within bounds.
 * 
 * @param editor - TipTap editor instance
 * @param from - Start position
 * @param to - End position
 * @returns true if positions are valid
 */
export function validatePositions(
  editor: Editor,
  from: number,
  to: number
): { valid: boolean; error?: string } {
  const docSize = editor.state.doc.content.size
  
  if (from < 0) {
    return { valid: false, error: 'Start position is negative' }
  }
  
  if (to > docSize) {
    return { valid: false, error: `End position ${to} exceeds document size ${docSize}` }
  }
  
  if (from > to) {
    return { valid: false, error: 'Start position is after end position' }
  }
  
  return { valid: true }
}
