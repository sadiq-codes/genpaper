/**
 * Centralized Text Processing Utilities
 * 
 * All text chunking, splitting, and processing functions are consolidated here
 * to avoid duplication across the codebase.
 */

import { createDeterministicChunkId } from '@/lib/utils/deterministic-id'
import { jaccardSimilarity } from '@/lib/utils/fuzzy-matching'

export interface TextChunk {
  id: string
  content: string
  position: number
  metadata?: {
    wordCount: number
    charCount: number
    isOverlap?: boolean
    tokenCount?: number
  }
}

/**
 * Get precise token count using tiktoken (reliable implementation)
 */
export async function getTokenCount(text: string): Promise<number> {
  let encoder: any = null
  try {
    const { encoding_for_model } = await import('@dqbd/tiktoken')
    encoder = encoding_for_model('text-embedding-3-small')
    const tokens = encoder.encode(text)
    return tokens.length
  } catch (error) {
    throw new Error(`Failed to count tokens with tiktoken: ${error instanceof Error ? error.message : 'Unknown error'}`)
  } finally {
    // Always free the encoder in finally block to prevent memory leaks
    if (encoder) {
      try {
        encoder.free()
      } catch (freeError) {
        console.warn('Failed to free tiktoken encoder:', freeError)
      }
    }
  }
}

/**
 * Token-aware chunking with smart boundaries
 * Improves retrieval quality by respecting token boundaries and preserving semantic continuity
 */
export interface TokenChunkOptions {
  maxTokens?: number      // Target token count per chunk (default: 500)
  overlapTokens?: number  // Token overlap between chunks (default: 80)
  preserveParagraphs?: boolean  // Try to keep paragraphs intact (default: true)
  minChunkTokens?: number // Minimum tokens per chunk (default: 50)
}

export async function chunkByTokens(
  text: string,
  paperId: string,
  options: TokenChunkOptions = {}
): Promise<TextChunk[]> {
  const {
    maxTokens = 500,
    overlapTokens = 80,
    preserveParagraphs = true,
    minChunkTokens = 50
  } = options

  if (!text || text.trim().length < 50) {
    return []
  }

  const chunks: TextChunk[] = []
  let position = 0

  // Split by paragraphs first if preserveParagraphs is true
  const segments = preserveParagraphs 
    ? text.split(/\n\s*\n/).filter(seg => seg.trim().length > 0)
    : [text]

  let overlapContent = ''

  for (const segment of segments) {
    // Check if segment fits in one chunk
    const segmentTokens = await getTokenCount(segment)
    
    if (segmentTokens <= maxTokens) {
      // Segment fits in one chunk
      const chunkContent = overlapContent + (overlapContent ? ' ' : '') + segment
      const totalTokens = await getTokenCount(chunkContent)
      
      const chunkId = createDeterministicChunkId(paperId, chunkContent.trim(), position)
      chunks.push({
        id: chunkId,
        content: chunkContent.trim(),
        position,
        metadata: {
          wordCount: chunkContent.trim().split(/\s+/).length,
          charCount: chunkContent.length,
          tokenCount: totalTokens,
          isOverlap: !!overlapContent
        }
      })
      position += segment.length
      overlapContent = await createTokenOverlap(chunkContent, overlapTokens)
    } else {
      // Split segment into sentences and pack by token budget
      const sentences = splitIntoSentences(segment)
      
      let currentChunk = overlapContent
      let currentTokens = overlapContent ? await getTokenCount(overlapContent) : 0
      
      for (const sentence of sentences) {
        const sentenceTokens = await getTokenCount(sentence)
        
        // Check if adding this sentence would exceed token limit
        if (currentTokens + sentenceTokens > maxTokens && currentChunk.trim()) {
          // Save current chunk if it meets minimum size
          if (currentTokens >= minChunkTokens) {
            const chunkId = createDeterministicChunkId(paperId, currentChunk.trim(), position)
            chunks.push({
              id: chunkId,
              content: currentChunk.trim(),
              position,
              metadata: {
                wordCount: currentChunk.trim().split(/\s+/).length,
                charCount: currentChunk.length,
                tokenCount: currentTokens,
                isOverlap: !!overlapContent
              }
            })
            position += currentChunk.length
            
            // Prepare overlap for next chunk
            overlapContent = await createTokenOverlap(currentChunk, overlapTokens)
            currentChunk = overlapContent + (overlapContent ? ' ' : '') + sentence
            currentTokens = await getTokenCount(currentChunk)
          } else {
            // Current chunk too small, just add the sentence
            currentChunk += (currentChunk ? ' ' : '') + sentence
            currentTokens += sentenceTokens
          }
        } else {
          // Add sentence to current chunk
          currentChunk += (currentChunk ? ' ' : '') + sentence
          currentTokens += sentenceTokens
        }
      }
      
      // Add final chunk if it has content
      if (currentChunk.trim() && currentTokens >= minChunkTokens) {
        const chunkId = createDeterministicChunkId(paperId, currentChunk.trim(), position)
        chunks.push({
          id: chunkId,
          content: currentChunk.trim(),
          position,
          metadata: {
            wordCount: currentChunk.trim().split(/\s+/).length,
            charCount: currentChunk.length,
            tokenCount: currentTokens,
            isOverlap: !!overlapContent
          }
        })
        
        // Prepare overlap for next segment
        overlapContent = await createTokenOverlap(currentChunk, overlapTokens)
      }
    }
  }

  return chunks
}

/**
 * Split text into sentences with smart boundary detection
 * Avoids cutting numbered lists, equations, and citations
 */
function splitIntoSentences(text: string): string[] {
  const sentences: string[] = []
  let current = ''
  let i = 0
  
  while (i < text.length) {
    const char = text[i]
    current += char
    
    // Check for sentence ending punctuation
    if (char === '.' || char === '!' || char === '?') {
      const nextChar = text[i + 1]
      const prevContext = text.slice(Math.max(0, i - 10), i)
      
      // Don't split if:
      // - Next char is not whitespace (e.g., "2.5")
      // - Inside parentheses with numbers (e.g., "(2023)")
      // - Common abbreviations (e.g., "et al.")
      // - Equations (e.g., "Equation 2.1")
      if (nextChar && /\s/.test(nextChar) && !isInsideSpecialContext(prevContext, current)) {
        // Look ahead for capital letter to confirm sentence boundary
        const remainingText = text.slice(i + 1).trim()
        if (remainingText && /^[A-Z]/.test(remainingText)) {
          sentences.push(current.trim())
          current = ''
        }
      }
    }
    
    i++
  }
  
  // Add final sentence if exists
  if (current.trim()) {
    sentences.push(current.trim())
  }
  
  return sentences.filter(s => s.length > 10) // Filter out very short fragments
}

/**
 * Check if we're inside a special context that shouldn't be split
 */
function isInsideSpecialContext(prevContext: string, _current: string): boolean {
  const abbreviations = ['et al', 'e.g', 'i.e', 'cf', 'vs', 'Fig', 'Eq', 'etc']
  const contextLower = prevContext.toLowerCase()
  
  // Check for abbreviations
  for (const abbrev of abbreviations) {
    if (contextLower.endsWith(abbrev)) {
      return true
    }
  }
  
  // Check for numbered references in parentheses
  if (/\(\d+[\d,\s-]*$/.test(prevContext)) {
    return true
  }
  
  // Check for equation references
  if (/equation\s+\d+\.?\d*$/i.test(prevContext)) {
    return true
  }
  
  return false
}

/**
 * Create token-based overlap from the end of a chunk
 */
async function createTokenOverlap(text: string, targetOverlapTokens: number): Promise<string> {
  if (targetOverlapTokens <= 0 || !text.trim()) {
    return ''
  }
  
  // Split into sentences and take from the end
  const sentences = splitIntoSentences(text)
  let overlap = ''
  let tokens = 0
  
  // Build overlap from last sentences working backwards
  for (let i = sentences.length - 1; i >= 0 && tokens < targetOverlapTokens; i--) {
    const sentence = sentences[i]
    const sentenceTokens = await getTokenCount(sentence)
    
    if (tokens + sentenceTokens <= targetOverlapTokens) {
      overlap = sentence + (overlap ? ' ' + overlap : '')
      tokens += sentenceTokens
    } else {
      break
    }
  }
  
  return overlap
}

/**
 * Clean and normalize text for processing
 */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')           // Normalize line endings
    .replace(/\n{3,}/g, '\n\n')       // Collapse multiple newlines
    .replace(/[ \t]+/g, ' ')          // Normalize whitespace
    .trim()
}

/**
 * Extract meaningful sentences from text
 */
export function extractSentences(text: string): string[] {
  // Simple sentence splitting (can be enhanced with NLP libraries)
  return text
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 10) // Filter out very short fragments
}

/**
 * Calculate text similarity using Jaccard word overlap
 * Re-exports the consolidated implementation from fuzzy-matching
 */
export function calculateTextSimilarity(text1: string, text2: string): number {
  return jaccardSimilarity(text1, text2, { minWordLength: 0, minUnionSize: 1 })
}

/**
 * Truncate text to a maximum length while preserving word boundaries
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }
  
  const truncated = text.slice(0, maxLength)
  const lastSpaceIndex = truncated.lastIndexOf(' ')
  
  return lastSpaceIndex > maxLength * 0.8 
    ? truncated.slice(0, lastSpaceIndex) + '...'
    : truncated + '...'
}

/**
 * Sanitize filename for security
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9\s\-_.]/g, '')
    .substring(0, 255)
} 