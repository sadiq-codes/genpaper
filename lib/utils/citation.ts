import type { CSLItem } from './csl'

/**
 * Normalize a DOI string by stripping protocol and doi.org prefix.
 * Preserves case in the suffix as per DOI spec.
 */
export function normalizeDoi(doi: string): string {
  if (!doi) return ''
  return doi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
}

/**
 * Extract author surname from a full author name.
 * Handles both "Last, First" and "First Last" formats.
 */
export function getAuthorSurname(author: string): string {
  if (!author) return 'Unknown'
  if (author.includes(',')) {
    return author.split(',')[0].trim()
  }
  const parts = author.trim().split(' ')
  return parts.length > 1 ? parts[parts.length - 1] : parts[0]
}

/**
 * Format CSL data into an author-year citation (e.g., "Smith, 2023")
 */
export function formatAuthorYearCitation(csl: CSLItem): string {
  const author = csl.author?.[0]?.family || 'Unknown'
  const year = csl.issued?.['date-parts']?.[0]?.[0] || 'n.d.'
  return `(${author}, ${year})`
}

/**
 * Format CSL data into a full reference entry
 */
export function formatReference(csl: CSLItem, style: 'apa' | 'mla' = 'apa'): string {
  const author = csl.author?.[0]?.family || 'Unknown'
  const year = csl.issued?.['date-parts']?.[0]?.[0] || 'n.d.'
  const title = csl.title || 'Untitled'
  const journal = csl['container-title'] || ''
  const doi = csl.DOI ? `https://doi.org/${csl.DOI}` : ''

  if (style === 'apa') {
    return `${author} (${year}). ${title}. ${journal}. ${doi}`.trim()
  } else {
    return `${author}. "${title}." ${journal}, ${year}. ${doi}`.trim()
  }
}

/**
 * Convert author names to CSL format
 */
export function authorsToCsl(authors: string[]): Array<{ family: string; given?: string }> {
  return authors.map(author => {
    if (author.includes(',')) {
      const [family, given] = author.split(',').map(s => s.trim())
      return { family, given }
    }
    
    const parts = author.trim().split(' ')
    if (parts.length === 1) {
      return { family: parts[0] }
    }
    
    const family = parts.pop() || ''
    const given = parts.join(' ')
    return { family, given }
  })
}

/**
 * Generate a unique citation key based on title, year, and DOI
 */
export async function generateCitationKey(title?: string, year?: number, doi?: string): Promise<string> {
  if (doi) {
    return normalizeDoi(doi)
  }
  
  const base = title 
    ? title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)
    : 'unknown'
  
  return `${base}_${year || 'nd'}`
}

/**
 * Extract citation keys from content
 */
export function extractCitationKeys(content: string): string[] {
  const citationRegex = /\[CITE:([^\]]+)\]/g
  const citations: string[] = []
  let match
  
  while ((match = citationRegex.exec(content)) !== null) {
    citations.push(match[1])
  }
  
  return citations
} 