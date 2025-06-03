import type { PaperWithAuthors } from '@/types/simplified'
// Temporarily disable citation-js to debug bundling issue
// import { Cite } from 'citation-js'

export interface CSLAuthor {
  family: string
  given: string
  literal?: string // Fallback for unparseable names
}

export interface CSLItem {
  id: string
  type: 'article-journal' | 'article' | 'book' | 'chapter' | 'paper-conference'
  title: string
  author: CSLAuthor[]
  'container-title'?: string
  issued?: {
    'date-parts': number[][]
  }
  DOI?: string
  URL?: string
  abstract?: string
  page?: string
  volume?: string
  issue?: string
  publisher?: string
}

// Compiled regexes for performance
const VENUE_CONFERENCE_RE = /\b(icml|iclr|nips|neurips|siggraph|cvpr|iccv|eccv|aaai|ijcai|acl|emnlp|naacl|proceedings?|conference|workshop)\b/i
const VENUE_ARXIV_RE = /\b(arxiv|preprint)\b/i

// Conference venue patterns
const CONFERENCE_VENUES = new Set([
  'icml', 'iclr', 'nips', 'neurips', 'siggraph', 'cvpr', 'iccv', 'eccv',
  'aaai', 'ijcai', 'acl', 'emnlp', 'naacl', 'icdm', 'kdd', 'www'
])

/**
 * Parse author name with fallback strategies
 */
function parseAuthorName(name: string): CSLAuthor {
  const trimmedName = name.trim()
  
  // Strategy 1: "Last, First" format
  if (trimmedName.includes(', ')) {
    const [family, given] = trimmedName.split(', ', 2)
    return { 
      family: family.trim(), 
      given: (given || '').trim(),
      literal: trimmedName
    }
  }
  
  // Strategy 2: Handle prefixes like "van der", "de la"
  const nameParts = trimmedName.split(/\s+/)
  if (nameParts.length >= 2) {
    // Check for common family name prefixes
    const prefixes = ['van', 'der', 'de', 'la', 'del', 'von', 'di', 'du', 'le']
    let familyStartIndex = nameParts.length - 1
    
    // Look for prefix patterns in the last few words
    for (let i = nameParts.length - 2; i >= 0; i--) {
      if (prefixes.includes(nameParts[i].toLowerCase())) {
        familyStartIndex = i
      } else {
        break
      }
    }
    
    if (familyStartIndex > 0) {
      return {
        family: nameParts.slice(familyStartIndex).join(' '),
        given: nameParts.slice(0, familyStartIndex).join(' '),
        literal: trimmedName
      }
    }
    
    // Standard "First Last" format
    return {
      family: nameParts[nameParts.length - 1],
      given: nameParts.slice(0, -1).join(' '),
      literal: trimmedName
    }
  }
  
  // Strategy 3: Single name - store in literal
  return { 
    family: '',
    given: '',
    literal: trimmedName
  }
}

/**
 * Determine publication type from venue
 */
function inferPublicationType(venue: string): CSLItem['type'] {
  const lowerVenue = venue.toLowerCase()
  
  // Check exact matches first
  for (const confName of CONFERENCE_VENUES) {
    if (lowerVenue.includes(confName)) {
      return 'paper-conference'
    }
  }
  
  // Pattern matching
  if (VENUE_CONFERENCE_RE.test(lowerVenue)) {
    return 'paper-conference'
  }
  
  if (VENUE_ARXIV_RE.test(lowerVenue)) {
    return 'article'
  }
  
  return 'article-journal'
}

/**
 * Parse publication date with safe date support for citation-js
 */
function parsePublicationDate(dateStr: string) {
  try {
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return undefined
    
    const year = date.getFullYear()
    if (!year || year < 1000 || year > new Date().getFullYear() + 10) {
      return undefined
    }
    
    // Only include valid parts to avoid citation-js issues
    const dateParts = [year]
    
    // Only add month if it's valid (1-12)
    const month = date.getMonth() + 1
    if (month >= 1 && month <= 12) {
      dateParts.push(month)
      
      // Only add day if we have a valid month and valid day (1-31)
      const day = date.getDate()
      if (day >= 1 && day <= 31) {
        dateParts.push(day)
      }
    }
    
    return {
      'date-parts': [dateParts]
    }
  } catch {
    return undefined
  }
}

/**
 * Convert paper data to CSL-JSON format
 * Robust version with fallback strategies
 */
export function paperToCSL(paper: PaperWithAuthors): CSLItem {
  // Parse authors with robust fallback
  const authors: CSLAuthor[] = paper.author_names?.map(parseAuthorName) || []

  // Determine publication type
  const type = paper.venue ? inferPublicationType(paper.venue) : 'article-journal'

  // Parse publication date with full date support
  const issued = paper.publication_date ? parsePublicationDate(paper.publication_date) : undefined

  return {
    id: paper.id,
    type,
    title: paper.title || 'Untitled',
    author: authors,
    'container-title': paper.venue || undefined,
    issued,
    DOI: paper.doi || undefined,
    URL: paper.url || undefined,
    abstract: paper.abstract || undefined
  }
}

/**
 * Validate CSL-JSON using citation-js dynamically
 */
export async function validateCSLWithCite(csl: unknown): Promise<boolean> {
  try {
    const { Cite } = await import('citation-js')
    new Cite([csl])
    return true
  } catch {
    return false
  }
}

/**
 * Validate CSL-JSON using basic structure check (fallback)
 */
export function validateCSL(csl: unknown): csl is CSLItem {
  // Basic validation without citation-js for immediate use
  return (
    typeof csl === 'object' &&
    csl !== null &&
    typeof (csl as Record<string, unknown>).id === 'string' &&
    typeof (csl as Record<string, unknown>).title === 'string' &&
    Array.isArray((csl as Record<string, unknown>).author)
  )
}

/**
 * Create a hash of CSL data for memoization
 */
export function hashCSLData(cslData: CSLItem[]): string {
  // Simple hash based on IDs and titles for fast comparison
  return cslData
    .map(item => `${item.id}:${item.title}`)
    .join('|')
    .slice(0, 100) // Truncate for performance
}

/**
 * Fix CSL-JSON by building fresh object with only valid fields
 */
export function fixCSL(csl: Record<string, unknown>): CSLItem {
  // Build fresh object copying only known valid fields
  const fixed: CSLItem = {
    id: typeof csl.id === 'string' ? csl.id : 'unknown',
    type: typeof csl.type === 'string' && 
          ['article-journal', 'article', 'book', 'chapter', 'paper-conference'].includes(csl.type)
          ? csl.type as CSLItem['type'] 
          : 'article-journal',
    title: typeof csl.title === 'string' ? csl.title : 'Untitled',
    author: []
  }
  
  // Handle authors array safely
  if (Array.isArray(csl.author)) {
    fixed.author = (csl.author as unknown[])
      .map((author: unknown) => {
        if (typeof author !== 'object' || author === null) {
          return null
        }
        
        const authorObj = author as Record<string, unknown>
        const family = typeof authorObj.family === 'string' ? authorObj.family : ''
        const given = typeof authorObj.given === 'string' ? authorObj.given : ''
        const literal = typeof authorObj.literal === 'string' ? authorObj.literal : undefined
        
        // Must have either family name or literal
        if (!family && !literal) return null
        
        const result: CSLAuthor = { family, given }
        if (literal) result.literal = literal
        return result
      })
      .filter((author: CSLAuthor | null): author is CSLAuthor => author !== null)
  }
  
  // Ensure we have at least one author (citation-js requirement)
  if (!fixed.author.length) {
    fixed.author = [{ family: 'Unknown', given: '' }]
  }
  
  // Add optional fields if valid
  if (typeof csl['container-title'] === 'string') {
    fixed['container-title'] = csl['container-title']
  }
  
  if (csl.issued && typeof csl.issued === 'object') {
    const issued = csl.issued as Record<string, unknown>
    if (Array.isArray(issued['date-parts']) && issued['date-parts'].length > 0) {
      const dateParts = issued['date-parts'] as number[][]
      // Ensure we have valid date parts and not empty arrays
      if (dateParts[0] && dateParts[0].length > 0 && dateParts[0][0]) {
        fixed.issued = { 'date-parts': dateParts }
      }
    }
  }
  
  // Ensure we have a valid issued date (citation-js requirement)
  if (!fixed.issued) {
    fixed.issued = { 'date-parts': [[new Date().getFullYear()]] }
  }
  
  // Add bibliographic fields
  const biblioFields = ['DOI', 'URL', 'abstract', 'page', 'volume', 'issue', 'publisher']
  biblioFields.forEach(field => {
    if (typeof csl[field] === 'string') {
      (fixed as unknown as Record<string, unknown>)[field] = csl[field]
    }
  })
  
  // Make sure the ID is CSL-safe and unique
  fixed.id = fixed.id.replace(/[^A-Za-z0-9_:-]/g, '_')
  
  return fixed
} 