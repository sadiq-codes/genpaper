/**
 * Centralized Text Processing Utilities
 * 
 * All text chunking, splitting, and processing functions are consolidated here
 * to avoid duplication across the codebase.
 */

import { createDeterministicChunkId } from '@/lib/utils/deterministic-id'

export interface ChunkOptions {
  maxLength?: number
  overlap?: number
  preserveParagraphs?: boolean
  minChunkSize?: number
}

export interface TextChunk {
  id: string
  content: string
  position: number
  metadata?: {
    wordCount: number
    charCount: number
    isOverlap?: boolean
  }
}

/**
 * Split text into chunks with deterministic IDs
 * Consolidates all the various splitIntoChunks implementations
 */
export function splitIntoChunks(
  text: string,
  paperId: string,
  options: ChunkOptions = {}
): TextChunk[] {
  const {
    maxLength = 1000,
    overlap = 100,
    preserveParagraphs = true,
    minChunkSize = 100
  } = options

  if (!text || text.trim().length < minChunkSize) {
    return []
  }

  const chunks: TextChunk[] = []
  let position = 0

  // Split by paragraphs first if preserveParagraphs is true
  const segments = preserveParagraphs 
    ? text.split(/\n\s*\n/).filter(seg => seg.trim().length > 0)
    : [text]

  for (const segment of segments) {
    if (segment.length <= maxLength) {
      // Segment fits in one chunk
      const chunkId = createDeterministicChunkId(paperId, segment, position)

      chunks.push({
        id: chunkId,
        content: segment.trim(),
        position,
        metadata: {
          wordCount: segment.trim().split(/\s+/).length,
          charCount: segment.length
        }
      })
      position += segment.length
    } else {
      // Split segment into multiple chunks with overlap
      let segmentStart = 0
      
      while (segmentStart < segment.length) {
        const chunkEnd = Math.min(segmentStart + maxLength, segment.length)
        let chunkContent = segment.slice(segmentStart, chunkEnd)
        
        // Try to break at word boundaries
        if (chunkEnd < segment.length) {
          const lastSpaceIndex = chunkContent.lastIndexOf(' ')
          if (lastSpaceIndex > maxLength * 0.8) {
            chunkContent = chunkContent.slice(0, lastSpaceIndex)
          }
        }

        if (chunkContent.trim().length >= minChunkSize) {
          const chunkId = createDeterministicChunkId(paperId, chunkContent, position + segmentStart)

          chunks.push({
            id: chunkId,
            content: chunkContent.trim(),
            position: position + segmentStart,
            metadata: {
              wordCount: chunkContent.trim().split(/\s+/).length,
              charCount: chunkContent.length,
              isOverlap: segmentStart > 0
            }
          })
        }

        // Move to next chunk with overlap
        segmentStart = chunkEnd - overlap
        if (segmentStart >= segment.length - minChunkSize) {
          break // Avoid tiny trailing chunks
        }
      }
      position += segment.length
    }
  }

  return chunks
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
 * @deprecated Use getTokenCount() instead for accurate token counting
 * Kept for backward compatibility, but should be migrated
 */
export function estimateTokenCount(text: string): number {
  console.warn('estimateTokenCount is deprecated. Use getTokenCount() for accurate token counting.')
  // Rough approximation: 1 token ≈ 4 characters for English text
  return Math.ceil(text.length / 4)
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
 * Calculate text similarity (simple word overlap)
 */
export function calculateTextSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/))
  const words2 = new Set(text2.toLowerCase().split(/\s+/))
  
  const intersection = new Set([...words1].filter(word => words2.has(word)))
  const union = new Set([...words1, ...words2])
  
  return union.size > 0 ? intersection.size / union.size : 0
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
 * Extract keywords from text (simple frequency-based)
 */
export function extractKeywords(text: string, maxKeywords: number = 10): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 3) // Filter short words
  
  const frequency = new Map<string, number>()
  words.forEach(word => {
    frequency.set(word, (frequency.get(word) || 0) + 1)
  })
  
  return Array.from(frequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([word]) => word)
}

/**
 * Extract title from PDF text lines
 */
export function extractTitle(lines: string[], fallbackName: string): string {
  let title = fallbackName.replace('.pdf', '').replace(/[-_]/g, ' ')
  
  // Look for title in first 10 lines, avoiding headers/metadata
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const line = lines[i]
    if (line.length > 15 && line.length < 200 && 
        !line.toLowerCase().includes('journal') &&
        !line.toLowerCase().includes('volume') &&
        !line.toLowerCase().includes('page') &&
        !line.toLowerCase().includes('issn') &&
        !line.toLowerCase().includes('doi') &&
        !line.match(/^\d+$/) && // Not just numbers
        !line.match(/^[A-Z\s]{3,}$/) && // Not all caps
        line.includes(' ')) { // Has multiple words
      title = line
      break
    }
  }
  
  return title
}

/**
 * Extract authors from PDF text
 */
export function extractAuthors(fullText: string): string[] {
  let authors: string[] = []
  
  // Look for author patterns
  const authorPatterns = [
    /(?:authors?|by)\s*:?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]*\.?\s*)*(?:,?\s*(?:and\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]*\.?\s*)*)*)/gi,
    /^([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s*,\s*[A-Z][a-z]+\s+[A-Z][a-z]+)*)/m,
    /([A-Z]\.\s*[A-Z][a-z]+(?:\s*,\s*[A-Z]\.\s*[A-Z][a-z]+)*)/g
  ]
  
  for (const pattern of authorPatterns) {
    const matches = fullText.match(pattern)
    if (matches && matches.length > 0) {
      const authorText = matches[0].replace(/^(authors?|by)\s*:?\s*/i, '')
      authors = authorText.split(/,|\band\b/)
        .map(author => author.trim())
        .filter(author => author.length > 2 && author.length < 50)
        .slice(0, 10) // Max 10 authors
      if (authors.length > 0) {
        break
      }
    }
  }
  
  return authors.length > 0 ? authors : ['Unknown Author']
}

/**
 * Extract abstract from PDF text
 */
export function extractAbstract(fullText: string): string | undefined {
  const abstractPatterns = [
    new RegExp('abstract[:\\s]+(.*?)(?:\\n\\s*\\n|\\n\\s*(?:keywords|introduction|1\\.?\\s*introduction))', 'si'),
    new RegExp('summary[:\\s]+(.*?)(?:\\n\\s*\\n|\\n\\s*(?:keywords|introduction))', 'si')
  ]
  
  for (const pattern of abstractPatterns) {
    const match = fullText.match(pattern)
    if (match && match[1]) {
      let abstract = match[1].trim()
        .replace(/\s+/g, ' ')
        .replace(/\n/g, ' ')
      
      // Clean up abstract
      if (abstract.length > 50 && abstract.length < 2000) {
        if (abstract.length > 500) {
          abstract = abstract.substring(0, 500) + '...'
        }
        return abstract
      }
    }
  }
  
  return undefined
}

/**
 * Extract DOI from PDF text
 */
export function extractDOI(fullText: string): string | undefined {
  const doiPatterns = [
    /DOI[:\s]*(10\.\d+\/[^\s\n]+)/i,
    /https?:\/\/doi\.org\/(10\.\d+\/[^\s\n]+)/i,
    /\b(10\.\d+\/[^\s\n]+)\b/g
  ]
  
  for (const pattern of doiPatterns) {
    const match = fullText.match(pattern)
    if (match && (match[1] || match[0])) {
      return match[1] || match[0]
    }
  }
  
  return undefined
}

/**
 * Extract publication year from PDF text
 */
export function extractYear(fullText: string): string | undefined {
  const yearPattern = /\b(19|20)\d{2}\b/g
  const firstPartText = fullText.substring(0, Math.min(5000, fullText.length)) // First ~5k chars
  const yearMatches = firstPartText.match(yearPattern)
  
  if (yearMatches && yearMatches.length > 0) {
    const years = yearMatches
      .map(y => parseInt(y))
      .filter(y => y >= 1990 && y <= new Date().getFullYear())
    if (years.length > 0) {
      // Prefer the first valid year found (likely publication date)
      return years[0].toString()
    }
  }
  
  return undefined
}

/**
 * Extract venue/journal from PDF text
 */
export function extractVenue(fullText: string): string | undefined {
  const venuePatterns = [
    /(?:published in|journal of|international journal of|proceedings of)\s+([^.\n]+)/i,
    /(?:conference on|workshop on)\s+([^.\n]+)/i,
    /([A-Z][a-z\s]+Journal[^.\n]*)/i
  ]
  
  for (const pattern of venuePatterns) {
    const match = fullText.match(pattern)
    if (match && match[1]) {
      let venue = match[1].trim()
      if (venue.length > 100) venue = venue.substring(0, 100) + '...'
      return venue
    }
  }
  
  return undefined
}

/**
 * Sanitize filename for security
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9\s\-_.]/g, '')
    .substring(0, 255)
} 