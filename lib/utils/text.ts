// Text manipulation utilities for content processing

/**
 * Content chunking for RAG with intelligent sentence breaks
 */
export function chunkText(text: string, chunkSize: number = 1000, overlap: number = 200): string[] {
  if (text.length <= chunkSize) {
    return [text]
  }
  
  const chunks: string[] = []
  let start = 0
  
  while (start < text.length) {
    let end = start + chunkSize
    
    // If not at the end, try to break at a sentence or paragraph
    if (end < text.length) {
      // Look for sentence endings within the last 200 characters
      const lastPart = text.slice(end - 200, end)
      const sentenceEndings = ['. ', '.\n', '! ', '!\n', '? ', '?\n']
      
      let bestBreak = -1
      for (const ending of sentenceEndings) {
        const index = lastPart.lastIndexOf(ending)
        if (index > bestBreak) {
          bestBreak = index
        }
      }
      
      if (bestBreak > -1) {
        end = end - 200 + bestBreak + 2 // +2 to include the punctuation and space
      }
    }
    
    chunks.push(text.slice(start, end).trim())
    
    // Move start position with overlap, preventing negative values
    start = Math.max(0, end - overlap)
    if (start >= text.length) break
  }
  
  return chunks.filter(chunk => chunk.length > 50) // Filter out very small chunks
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