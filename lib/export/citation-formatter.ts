/**
 * Citation Formatter for Export
 * 
 * Formats citations for different export formats.
 * Reuses formatting logic from local-formatter.ts where possible.
 */

import type { ExportPaper } from './types'
import {
  isNumericLikeCitationStyle,
  resolveCitationStyleFamily,
} from '@/lib/citations/style-family'

// =============================================================================
// INLINE CITATION FORMATTING
// =============================================================================

/**
 * Format an inline citation for a specific style
 */
export function formatInlineCitation(
  paper: ExportPaper,
  citationNumber: number,
  style: string
): string {
  const isNumeric = isNumericCitationStyle(style)
  
  if (isNumeric) {
    return `[${citationNumber}]`
  }
  
  // Author-date format
  const authors = getKnownAuthors(paper.authors)
  const year = paper.year || 'n.d.'
  
  if (authors.length === 0) {
    return `(Anonymous, ${year})`
  }
  
  const firstAuthor = getLastName(authors[0])
  
  if (authors.length === 1) {
    return `(${firstAuthor}, ${year})`
  } else if (authors.length === 2) {
    const secondAuthor = getLastName(authors[1])
    return `(${firstAuthor} & ${secondAuthor}, ${year})`
  }
  
  return `(${firstAuthor} et al., ${year})`
}

/**
 * Check if a citation style uses numeric format
 */
export function isNumericCitationStyle(style: string): boolean {
  return isNumericLikeCitationStyle(style)
}

// =============================================================================
// BIBLIOGRAPHY FORMATTING
// =============================================================================

/**
 * Format bibliography entries
 */
export function formatBibliography(
  papers: ExportPaper[],
  citationNumbers: Map<string, number>,
  style: string
): string[] {
  const isNumeric = isNumericCitationStyle(style)
  
  // Sort papers
  let sortedPapers = [...papers]
  
  if (isNumeric) {
    // Sort by citation number for numeric styles
    sortedPapers.sort((a, b) => {
      const numA = citationNumbers.get(a.id) || 999
      const numB = citationNumbers.get(b.id) || 999
      return numA - numB
    })
  } else {
    // Sort alphabetically by first author for author-date styles
    sortedPapers.sort((a, b) => {
      const authorA = getLastName(a.authors?.[0] || 'ZZZ').toLowerCase()
      const authorB = getLastName(b.authors?.[0] || 'ZZZ').toLowerCase()
      return authorA.localeCompare(authorB)
    })
  }
  
  return sortedPapers.map(paper => {
    const num = citationNumbers.get(paper.id) || 0
    return formatBibliographyEntry(paper, num, style, isNumeric)
  })
}

/**
 * Format a single bibliography entry
 */
export function formatBibliographyEntry(
  paper: ExportPaper,
  citationNumber: number,
  style: string,
  isNumeric: boolean = false
): string {
  const authors = formatAuthors(getKnownAuthors(paper.authors), style)
  const year = paper.year || 'n.d.'
  const title = paper.title || 'Untitled'
  const journal = paper.journal || paper.venue || ''
  const doi = paper.doi ? `https://doi.org/${paper.doi}` : ''
  
  // Numeric prefix for numeric styles
  const prefix = isNumeric ? `[${citationNumber}] ` : ''
  
  // Format based on style family
  const styleFamily = resolveCitationStyleFamily(style)

  if (styleFamily === 'ieee') {
    // IEEE format: [1] A. Author, "Title," Journal, year.
    return `${prefix}${formatAuthorsIEEE(paper.authors || ['Unknown'])}, "${title}," ${journal ? journal + ', ' : ''}${year}.${doi ? ' ' + doi : ''}`
  }
  
  if (styleFamily === 'apa') {
    // APA format: Author, A. A. (Year). Title. Journal. DOI
    return `${prefix}${authors} (${year}). ${title}.${journal ? ' ' + journal + '.' : ''}${doi ? ' ' + doi : ''}`
  }
  
  if (styleFamily === 'mla') {
    // MLA format: Author. "Title." Journal, Year.
    return `${prefix}${authors}. "${title}."${journal ? ' ' + journal + ',' : ''} ${year}.`
  }
  
  if (styleFamily === 'chicago') {
    // Chicago format: Author. Year. "Title." Journal.
    return `${prefix}${authors}. ${year}. "${title}."${journal ? ' ' + journal + '.' : ''}${doi ? ' ' + doi : ''}`
  }

  if (styleFamily === 'harvard') {
    return `${prefix}${authors} (${year}) ${title}.${journal ? ' ' + journal + '.' : ''}${doi ? ' ' + doi : ''}`
  }
  
  // Default/fallback format (similar to APA)
  return `${prefix}${authors} (${year}). ${title}.${journal ? ' ' + journal + '.' : ''}${doi ? ' ' + doi : ''}`
}

// =============================================================================
// BIBTEX FORMATTING (for LaTeX export)
// =============================================================================

/**
 * Generate BibTeX entry for a paper
 */
export function paperToBibtex(paper: ExportPaper): string {
  const key = generateBibtexKey(paper)
  const type = getBibtexType(paper.type)
  
  const fields: string[] = []
  
  // Author
  if (paper.authors && paper.authors.length > 0) {
    const authors = paper.authors.map(a => formatAuthorBibtex(a)).join(' and ')
    fields.push(`  author = {${authors}}`)
  }
  
  // Title
  if (paper.title) {
    fields.push(`  title = {${escapeBibtex(paper.title)}}`)
  }
  
  // Year
  if (paper.year) {
    fields.push(`  year = {${paper.year}}`)
  }
  
  // Journal/venue
  if (paper.journal) {
    fields.push(`  journal = {${escapeBibtex(paper.journal)}}`)
  } else if (paper.venue) {
    if (type === 'inproceedings') {
      fields.push(`  booktitle = {${escapeBibtex(paper.venue)}}`)
    } else {
      fields.push(`  journal = {${escapeBibtex(paper.venue)}}`)
    }
  }
  
  // DOI
  if (paper.doi) {
    fields.push(`  doi = {${paper.doi}}`)
  }
  
  // URL
  if (paper.url) {
    fields.push(`  url = {${paper.url}}`)
  }
  
  return `@${type}{${key},\n${fields.join(',\n')}\n}`
}

/**
 * Generate a BibTeX key from paper metadata
 */
export function generateBibtexKey(paper: ExportPaper): string {
  const firstAuthor = paper.authors?.[0] || 'unknown'
  const lastName = getLastName(firstAuthor).toLowerCase().replace(/[^a-z]/g, '')
  const year = paper.year || 'nd'
  
  // Add first word of title to avoid collisions
  const titleWord = (paper.title || 'untitled')
    .split(/\s+/)[0]
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .slice(0, 8)
  
  return `${lastName}${year}${titleWord}`
}

/**
 * Map paper type to BibTeX entry type
 */
function getBibtexType(type?: string): string {
  switch (type) {
    case 'book':
      return 'book'
    case 'chapter':
      return 'incollection'
    case 'paper-conference':
      return 'inproceedings'
    case 'thesis':
      return 'phdthesis'
    default:
      return 'article'
  }
}

/**
 * Format author name for BibTeX (Last, First)
 */
function formatAuthorBibtex(name: string): string {
  if (name.includes(',')) {
    return name.trim()
  }
  
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) {
    return parts[0]
  }
  
  const lastName = parts.pop()!
  const firstNames = parts.join(' ')
  return `${lastName}, ${firstNames}`
}

/**
 * Escape special characters for BibTeX
 */
function escapeBibtex(text: string): string {
  return text
    .replace(/[&]/g, '\\&')
    .replace(/[%]/g, '\\%')
    .replace(/[_]/g, '\\_')
    .replace(/[#]/g, '\\#')
    .replace(/[$]/g, '\\$')
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Extract last name from a full name
 */
function getLastName(name: string): string {
  if (!name) return 'Unknown'
  
  // Handle "Last, First" format
  if (name.includes(',')) {
    return name.split(',')[0].trim()
  }
  
  // Handle "First Last" format
  const parts = name.trim().split(/\s+/)
  return parts[parts.length - 1]
}

function getKnownAuthors(authors: string[] | undefined): string[] {
  if (!Array.isArray(authors)) return []
  return authors
    .map(author => author.trim())
    .filter(author => {
      const lower = author.toLowerCase()
      return lower.length > 0 && lower !== 'unknown' && lower !== 'anonymous' && lower !== 'n/a'
    })
}

/**
 * Format authors list for bibliography
 */
function formatAuthors(authors: string[], style: string): string {
  if (authors.length === 0) return 'Anonymous'
  
  const formatted = authors.map(a => formatAuthorName(a, style))
  
  if (formatted.length === 1) {
    return formatted[0]
  }
  
  if (formatted.length === 2) {
    return `${formatted[0]} & ${formatted[1]}`
  }
  
  // More than 2 authors
  const last = formatted.pop()!
  return `${formatted.join(', ')}, & ${last}`
}

/**
 * Format a single author name (Last, F. format)
 */
function formatAuthorName(name: string, _style: string): string {
  if (name.includes(',')) {
    // Already in "Last, First" format
    const [last, first] = name.split(',').map(s => s.trim())
    const initial = first ? first[0] + '.' : ''
    return `${last}, ${initial}`
  }
  
  // "First Last" format
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) {
    return parts[0]
  }
  
  const lastName = parts.pop()!
  const initials = parts.map(p => p[0] + '.').join(' ')
  return `${lastName}, ${initials}`
}

/**
 * Format authors for IEEE style (F. Last)
 */
function formatAuthorsIEEE(authors: string[]): string {
  if (authors.length === 0) return 'Anonymous'
  
  const formatted = authors.map(a => {
    if (a.includes(',')) {
      const [last, first] = a.split(',').map(s => s.trim())
      const initial = first ? first[0] + '. ' : ''
      return `${initial}${last}`
    }
    
    const parts = a.trim().split(/\s+/)
    if (parts.length === 1) return parts[0]
    
    const lastName = parts.pop()!
    const initials = parts.map(p => p[0] + '.').join(' ')
    return `${initials} ${lastName}`
  })
  
  if (formatted.length <= 3) {
    if (formatted.length === 2) {
      return `${formatted[0]} and ${formatted[1]}`
    }
    return formatted.join(', ')
  }
  
  return `${formatted[0]} et al.`
}
