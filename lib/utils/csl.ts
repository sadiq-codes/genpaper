import type { Database } from '@/types/supabase'
import z from 'zod'

export interface CSLAuthor {
  family: string
  given: string
  literal?: string // Fallback for unparseable names
}

export interface CSLItem {
  id: string
  type: 'article-journal' | 'article' | 'book' | 'chapter' | 'paper-conference' | 'thesis' | 'report' | 'webpage' | 'manuscript'
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
  'publisher-place'?: string
  ISBN?: string
  ISSN?: string
  keyword?: string
  note?: string
}

// Paper type from database  
type DbAuthor = Database['public']['Tables']['authors']['Row']

// Enhanced interface for papers with authors (compatible with database structure)
export interface PaperWithAuthors {
  id: string
  title: string
  abstract?: string | null
  publication_date?: string | null
  venue?: string | null
  doi?: string | null
  url?: string | null
  pdf_url?: string | null
  volume?: string | null
  issue?: string | null
  pages?: string | null
  metadata?: Record<string, unknown> | null
  source?: string | null
  citation_count?: number | null
  impact_score?: number | null
  created_at: string
  authors: Array<{
    ordinal: number
    author: DbAuthor
  }>
}

// Consolidated venue classification constants
const CONFERENCE_VENUES = new Set([
  'icml', 'iclr', 'nips', 'neurips', 'siggraph', 'cvpr', 'iccv', 'eccv',
  'aaai', 'ijcai', 'acl', 'emnlp', 'naacl', 'icdm', 'kdd', 'www'
])

const CONFERENCE_KEYWORDS = [
  'proceedings', 'conference', 'workshop', 'symposium', 'summit', 'meeting'
]

const PREPRINT_KEYWORDS = [
  'arxiv', 'biorxiv', 'preprint', 'prepub'
]

// Common author name prefixes for proper parsing
const AUTHOR_PREFIXES = [
  'van', 'der', 'de', 'la', 'del', 'von', 'di', 'du', 'le', 'da', 'dos', 'das'
]

/**
 * Parse author name with robust fallback strategies
 * Handles: "Last, First", "First Last", "von der Last", single names
 */
export function parseAuthorName(name: string): CSLAuthor {
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
    let familyStartIndex = nameParts.length - 1
    
    // Look for prefix patterns in the last few words
    for (let i = nameParts.length - 2; i >= 0; i--) {
      if (AUTHOR_PREFIXES.includes(nameParts[i].toLowerCase())) {
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
 * Determine publication type from venue (consolidated heuristics)
 */
export function determinePublicationType(venue: string): CSLItem['type'] {
  const lowerVenue = venue.toLowerCase()
  
  // Check exact conference matches first (O(1) lookup)
  for (const confName of CONFERENCE_VENUES) {
    if (lowerVenue.includes(confName)) {
      return 'paper-conference'
    }
  }
  
  // Check conference keywords
  for (const keyword of CONFERENCE_KEYWORDS) {
    if (lowerVenue.includes(keyword)) {
    return 'paper-conference'
  }
  }
  
  // Check preprint keywords  
  for (const keyword of PREPRINT_KEYWORDS) {
    if (lowerVenue.includes(keyword)) {
      return 'manuscript'
    }
  }
  
  // Default to journal article
  return 'article-journal'
}

/**
 * Parse publication date with consistent year-only fallback
 */
export function parsePublicationDate(dateStr: string) {
  try {
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return undefined
    
    const year = date.getFullYear()
    if (!year || year < 1000 || year > new Date().getFullYear() + 10) {
      return undefined
    }
    
    // Always return year-only for consistency across the system
    return {
      'date-parts': [[year]]
    }
  } catch {
    return undefined
  }
}

/**
 * CANONICAL FUNCTION: Convert paper data to CSL-JSON format
 * This is the single source of truth for Paper → CSL conversion
 */
export function buildCSLFromPaper(paper: PaperWithAuthors): CSLItem {
  // Parse authors using robust name parser
  const authors: CSLAuthor[] = paper.authors
    ?.sort((a, b) => a.ordinal - b.ordinal)
    .map(({ author }) => parseAuthorName(author.name)) || []

  // Ensure we have at least one author
  const finalAuthors = authors.length > 0 ? authors : [{ family: 'Unknown', given: '' }]

  // Determine publication type
  const type = paper.venue ? determinePublicationType(paper.venue) : 'article-journal'

  // Parse publication date
  const issued = paper.publication_date ? parsePublicationDate(paper.publication_date) : undefined

  const csl: CSLItem = {
    id: paper.doi || paper.id,
    type,
    title: paper.title || 'Untitled',
    author: finalAuthors
  }

  // Add optional fields only if they exist
  if (paper.venue) csl['container-title'] = paper.venue
  if (issued) csl.issued = issued
  if (paper.doi) csl.DOI = paper.doi
  if (paper.url) csl.URL = paper.url
  if (paper.abstract) csl.abstract = paper.abstract
  if (paper.volume) csl.volume = paper.volume
  if (paper.issue) csl.issue = paper.issue
  if (paper.pages) csl.page = paper.pages

  return csl
}

// --------------------
// Zod-backed validation schema for CSL-JSON
// --------------------

export const CSLAuthorSchema = z.object({
  family: z.string().optional(),
  given: z.string().optional(),
  literal: z.string().optional()
})

export const CSLItemSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    'article-journal',
    'article',
    'book',
    'chapter',
    'paper-conference',
    'thesis',
    'report',
    'webpage',
    'manuscript'
  ]),
  title: z.string().min(1),
  author: z.array(CSLAuthorSchema).default([]),
  'container-title': z.string().optional(),
  issued: z
    .object({ 'date-parts': z.array(z.array(z.number().int().finite())) })
    .optional(),
  DOI: z.string().optional(),
  URL: z.string().url().optional(),
  abstract: z.string().optional(),
  page: z.string().optional(),
  volume: z.string().optional(),
  issue: z.string().optional(),
  publisher: z.string().optional(),
  'publisher-place': z.string().optional(),
  ISBN: z.string().optional(),
  ISSN: z.string().optional(),
  keyword: z.string().optional(),
  note: z.string().optional()
})

/**
 * Validate CSL using Zod first for structure, then citation-js for strictness
 */
export function validateCSLWithSchema(csl: unknown): boolean {
  return CSLItemSchema.safeParse(csl).success
}

/**
 * Validate CSL-JSON with citation-js (cached import) + fallback
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let citationJsCache: any = null

export async function validateCSL(csl: unknown): Promise<boolean> {
  // First ensure basic structure via Zod
  if (!validateCSLWithSchema(csl)) {
    return false
  }

  // Then try citation-js validation (most reliable)
  try {
    if (!citationJsCache) {
    const citationJsModule = await import('citation-js')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
      citationJsCache = (citationJsModule as any).default || (citationJsModule as any).Cite || citationJsModule
    }
    new citationJsCache([csl])
    return true
  } catch {
    // Fall back to basic structure check
    return (
      typeof csl === 'object' &&
      csl !== null &&
      typeof (csl as Record<string, unknown>).id === 'string' &&
      typeof (csl as Record<string, unknown>).title === 'string' &&
      Array.isArray((csl as Record<string, unknown>).author)
    )
  }
}

/**
 * CSL Normalization Pipeline
 * Ensures consistent CSL JSON formatting and validation
 */

export function normalizeCSLAuthor(author: Partial<CSLAuthor>): CSLAuthor {
  // Handle various author formats and normalize
  if (author.literal) {
    return { 
      family: author.literal, 
      given: '', 
      literal: author.literal 
    }
  }
  
  const family = (author.family || '').trim()
  const given = (author.given || '').trim()
  
  if (!family && !given) {
    return { family: 'Unknown', given: '', literal: 'Unknown' }
  }
  
  return {
    family: family || 'Unknown',
    given: given || '',
    ...(author.literal && { literal: author.literal })
  }
}

export function normalizeCSLDate(date: unknown): { 'date-parts': number[][] } | undefined {
  if (!date) return undefined
  
  if (typeof date === 'object' && date !== null && 'date-parts' in date) {
    const dateParts = (date as any)['date-parts']
    if (Array.isArray(dateParts) && Array.isArray(dateParts[0])) {
      return { 'date-parts': dateParts }
    }
  }
  
  // Try to parse string dates
  if (typeof date === 'string') {
    const parsed = new Date(date)
    if (!isNaN(parsed.getTime())) {
      return { 'date-parts': [[parsed.getFullYear()]] }
    }
  }
  
  // Try to parse number (year)
  if (typeof date === 'number' && date > 1000 && date < 3000) {
    return { 'date-parts': [[date]] }
  }
  
  return undefined
}

export function normalizeCSL(csl: Partial<CSLItem>): CSLItem {
  // Ensure required fields
  const id = csl.id || `temp_${Date.now()}`
  const title = (csl.title || '').trim() || 'Untitled'
  const type = csl.type || 'article'
  
  // Normalize authors
  const authors = Array.isArray(csl.author) 
    ? csl.author.map(normalizeCSLAuthor)
    : []
  
  // Normalize dates
  const issued = normalizeCSLDate(csl.issued)
  
  // Normalize container title
  const containerTitle = csl['container-title']?.trim() || undefined
  
  // Normalize DOI (remove URL prefixes)
  let doi = csl.DOI?.trim()
  if (doi) {
    doi = doi
      .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
      .replace(/^doi:/, '')
      .toLowerCase()
  }
  
  // Normalize URL
  let url = csl.URL?.trim()
  if (url && !url.match(/^https?:\/\//)) {
    url = `https://${url}`
  }
  
  // Build normalized CSL
  const normalized: CSLItem = {
    id,
    type: type as CSLItem['type'],
    title,
    author: authors,
    ...(containerTitle && { 'container-title': containerTitle }),
    ...(issued && { issued }),
    ...(doi && { DOI: doi }),
    ...(url && { URL: url }),
    ...(csl.abstract?.trim() && { abstract: csl.abstract.trim() }),
    ...(csl.page?.trim() && { page: csl.page.trim() }),
    ...(csl.volume?.trim() && { volume: csl.volume.trim() }),
    ...(csl.issue?.trim() && { issue: csl.issue.trim() }),
    ...(csl.publisher?.trim() && { publisher: csl.publisher.trim() }),
    ...(csl['publisher-place']?.trim() && { 'publisher-place': csl['publisher-place'].trim() }),
    ...(csl.ISBN?.trim() && { ISBN: csl.ISBN.trim() }),
    ...(csl.ISSN?.trim() && { ISSN: csl.ISSN.trim() }),
    ...(csl.keyword?.trim() && { keyword: csl.keyword.trim() }),
    ...(csl.note?.trim() && { note: csl.note.trim() })
  }
  
  return normalized
}

/**
 * Validate and normalize CSL JSON
 * Ensures consistent format and validates against schema
 */
export async function validateAndNormalizeCSL(csl: unknown): Promise<{ isValid: boolean; normalized?: CSLItem; errors?: string[] }> {
  const errors: string[] = []
  
  // Basic type check
  if (!csl || typeof csl !== 'object') {
    return { isValid: false, errors: ['CSL must be an object'] }
  }
  
  try {
    // Normalize the CSL data
    const normalized = normalizeCSL(csl as Partial<CSLItem>)
    
    // Validate against Zod schema
    const schemaResult = CSLItemSchema.safeParse(normalized)
    if (!schemaResult.success) {
      errors.push(...schemaResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`))
    }
    
    // Validate with citation-js
    const citationJsValid = await validateCSL(normalized)
    if (!citationJsValid) {
      errors.push('CSL data failed citation-js validation')
    }
    
    if (errors.length > 0) {
      return { isValid: false, normalized, errors }
    }
    
    return { isValid: true, normalized }
  } catch (error) {
    return { 
      isValid: false, 
      errors: [`Normalization failed: ${error instanceof Error ? error.message : 'Unknown error'}`] 
    }
  }
}

/**
 * Create a proper hash of CSL data for memoization
 */
export function hashCSLData(cslData: CSLItem[]): string {
  const dataString = cslData
    .map(item => `${item.id}:${item.title}:${item.author.length}`)
    .join('|')
  
  // Simple hash function (djb2)
  let hash = 5381
  for (let i = 0; i < dataString.length; i++) {
    hash = ((hash << 5) + hash) + dataString.charCodeAt(i)
  }
  return hash.toString(36)
}

// Export for backward compatibility
export const paperToCSL = buildCSLFromPaper

// Simple CSL formatter for basic citation styles
export function formatCSLSimple(csl: CSLItem, style: 'apa' | 'ieee' | 'mla' = 'apa'): string {
  const authors = csl.author || []
  const year = csl.issued?.['date-parts']?.[0]?.[0]
  const title = csl.title
  const venue = csl['container-title']
  
  switch (style) {
    case 'apa':
      return formatAPA(authors, year, title, venue)
    case 'ieee':
      return formatIEEE(authors, year, title, venue)
    case 'mla':
      return formatMLA(authors, year, title, venue)
    default:
      return formatAPA(authors, year, title, venue)
  }
}

function formatAPA(authors: CSLAuthor[], year?: number, title?: string, venue?: string): string {
  const authorStr = authors.length > 0 
    ? authors.map(a => a.literal || `${a.family}, ${a.given?.[0] || ''}.`).join(', ')
    : 'Unknown Author'
  
  const yearStr = year ? ` (${year})` : ''
  const titleStr = title ? `. ${title}` : ''
  const venueStr = venue ? `. *${venue}*` : ''
  
  return `${authorStr}${yearStr}${titleStr}${venueStr}.`
}

function formatIEEE(authors: CSLAuthor[], year?: number, title?: string, venue?: string): string {
  const authorStr = authors.length > 0
    ? authors.length > 3 
      ? `${authors[0].given?.[0] || ''}. ${authors[0].family} et al.`
      : authors.map(a => `${a.given?.[0] || ''}. ${a.family}`).join(', ')
    : 'Unknown Author'
  
  const titleStr = title ? `, "${title}"` : ''
  const venueStr = venue ? `, *${venue}*` : ''
  const yearStr = year ? `, ${year}` : ''
  
  return `${authorStr}${titleStr}${venueStr}${yearStr}.`
}

function formatMLA(authors: CSLAuthor[], year?: number, title?: string, venue?: string): string {
  const authorStr = authors.length > 0
    ? authors.length > 1
      ? `${authors[0].family}, ${authors[0].given} et al.`
      : `${authors[0].family}, ${authors[0].given}`
    : 'Unknown Author'
  
  const titleStr = title ? ` "${title}"` : ''
  const venueStr = venue ? ` *${venue}*` : ''
  const yearStr = year ? `, ${year}` : ''
  
  return `${authorStr}.${titleStr}${venueStr}${yearStr}.`
} 