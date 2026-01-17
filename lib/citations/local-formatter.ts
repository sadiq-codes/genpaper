/**
 * Local Citation Formatter
 * 
 * 100% client-side citation formatting using citation-js.
 * No API calls needed - everything happens in the browser.
 * 
 * Features:
 * - Instant inline citation formatting
 * - Instant bibliography generation
 * - Dynamic CSL style loading from CDN (cached after first load)
 * - Fallback to APA if style fails to load
 */

import Cite from 'citation-js'
import '@citation-js/plugin-csl'
import { plugins } from '@citation-js/core'

// =============================================================================
// Types
// =============================================================================

export interface CitationPaper {
  id: string
  title?: string
  authors?: string[]
  year?: number
  journal?: string
  doi?: string
  url?: string
  venue?: string
  type?: 'article-journal' | 'book' | 'chapter' | 'paper-conference' | 'thesis'
}

interface CSLAuthor {
  family?: string
  given?: string
  literal?: string
}

interface CSLJson {
  id: string
  type: string
  title?: string
  author?: CSLAuthor[]
  issued?: { 'date-parts'?: number[][] }
  'container-title'?: string
  DOI?: string
  URL?: string
  [key: string]: unknown
}

// =============================================================================
// Style Management
// =============================================================================

// CSL style repository CDN
const CSL_CDN = 'https://raw.githubusercontent.com/citation-style-language/styles/master'

// Styles bundled with @citation-js/plugin-csl
const BUNDLED_STYLES = new Set(['apa', 'vancouver', 'harvard1'])

// Common style aliases
const STYLE_ALIASES: Record<string, string> = {
  'harvard': 'harvard1',
  'mla': 'modern-language-association',
  'chicago': 'chicago-author-date',
  'chicago-author-date': 'chicago-author-date', 
  'apa-7': 'apa',
  'apa-7th': 'apa',
  'apa-6': 'apa-6th-edition',
}

// Cache for loaded styles
const loadedStyles = new Set<string>(BUNDLED_STYLES)
const styleLoadPromises = new Map<string, Promise<boolean>>()

// Cache for formatted citations: `${paperId}:${styleId}` -> formatted text
const inlineCache = new Map<string, string>()

// Cache for paper CSL-JSON conversion
const cslJsonCache = new Map<string, CSLJson>()

/**
 * Resolve style aliases to canonical CSL style IDs
 */
export function resolveStyleId(styleId: string): string {
  const normalized = styleId.toLowerCase().trim()
  return STYLE_ALIASES[normalized] || normalized
}

/**
 * Check if a style is a numeric citation style (like IEEE, Vancouver)
 */
export function isNumericStyle(styleId: string): boolean {
  const resolved = resolveStyleId(styleId)
  return ['ieee', 'vancouver', 'nature', 'science', 'numbered', 'elsevier-with-titles']
    .some(s => resolved.includes(s))
}

/**
 * Get the citation-js templates register
 */
function getTemplatesRegister() {
  try {
    const config = plugins.config.get('@csl')
    return config?.templates
  } catch {
    return null
  }
}

/**
 * Check if a style is available (bundled or already loaded)
 */
export function isStyleAvailable(styleId: string): boolean {
  const resolved = resolveStyleId(styleId)
  return loadedStyles.has(resolved)
}

/**
 * Load a CSL style from the CDN
 * Returns true if successful, false otherwise
 * Uses caching to prevent duplicate requests
 */
export async function loadStyle(styleId: string): Promise<boolean> {
  const resolved = resolveStyleId(styleId)
  
  // Already loaded
  if (loadedStyles.has(resolved)) {
    return true
  }
  
  // Already loading - wait for it
  if (styleLoadPromises.has(resolved)) {
    return styleLoadPromises.get(resolved)!
  }
  
  // Start loading
  const loadPromise = (async (): Promise<boolean> => {
    try {
      const url = `${CSL_CDN}/${resolved}.csl`
      const response = await fetch(url)
      
      if (!response.ok) {
        console.warn(`[LocalFormatter] Failed to load style '${resolved}': ${response.status}`)
        return false
      }
      
      const cslXml = await response.text()
      
      // Validate it's CSL XML
      if (!cslXml.includes('<style') || !cslXml.includes('citation-style-language')) {
        console.warn(`[LocalFormatter] Invalid CSL XML for style '${resolved}'`)
        return false
      }
      
      // Register with citation-js
      const templates = getTemplatesRegister()
      if (templates) {
        templates.add(resolved, cslXml)
      }
      
      loadedStyles.add(resolved)
      console.log(`[LocalFormatter] Loaded style '${resolved}'`)
      return true
    } catch (error) {
      console.error(`[LocalFormatter] Error loading style '${resolved}':`, error)
      return false
    } finally {
      styleLoadPromises.delete(resolved)
    }
  })()
  
  styleLoadPromises.set(resolved, loadPromise)
  return loadPromise
}

/**
 * Ensure a style is loaded, with fallback to APA
 */
export async function ensureStyle(styleId: string): Promise<string> {
  const resolved = resolveStyleId(styleId)
  
  if (loadedStyles.has(resolved)) {
    return resolved
  }
  
  const success = await loadStyle(resolved)
  return success ? resolved : 'apa'
}

// =============================================================================
// Paper -> CSL-JSON Conversion
// =============================================================================

/**
 * Parse author name string to CSL author object
 */
function parseAuthor(name: string): CSLAuthor {
  if (!name || !name.trim()) {
    return { literal: 'Unknown' }
  }
  
  const trimmed = name.trim()
  
  // Handle "Last, First" format
  if (trimmed.includes(',')) {
    const [family, given] = trimmed.split(',').map(s => s.trim())
    return { family, given: given || undefined }
  }
  
  // Handle "First Last" format
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) {
    return { family: parts[0] }
  }
  
  const family = parts.pop()!
  const given = parts.join(' ')
  return { family, given }
}

/**
 * Convert a paper to CSL-JSON format
 */
export function paperToCSL(paper: CitationPaper): CSLJson {
  // Check cache
  if (cslJsonCache.has(paper.id)) {
    return cslJsonCache.get(paper.id)!
  }
  
  const csl: CSLJson = {
    id: paper.id,
    type: paper.type || 'article-journal',
    title: paper.title || 'Untitled',
    author: (paper.authors || []).map(parseAuthor),
    issued: paper.year ? { 'date-parts': [[paper.year]] } : undefined,
    'container-title': paper.journal || paper.venue,
    DOI: paper.doi,
    URL: paper.url,
  }
  
  cslJsonCache.set(paper.id, csl)
  return csl
}

// =============================================================================
// Inline Citation Formatting
// =============================================================================

/**
 * Format a single inline citation
 * Synchronous if style is loaded, returns fallback otherwise
 */
export function formatInline(
  paper: CitationPaper,
  styleId: string = 'apa',
  citationNumber?: number
): string {
  const resolved = resolveStyleId(styleId)
  
  // For numeric styles, just return the number
  if (isNumericStyle(resolved)) {
    if (citationNumber !== undefined) {
      return `[${citationNumber}]`
    }
    return '[?]'
  }
  
  // Check cache
  const cacheKey = `${paper.id}:${resolved}`
  if (inlineCache.has(cacheKey)) {
    return inlineCache.get(cacheKey)!
  }
  
  // If style not loaded, use fast fallback
  if (!loadedStyles.has(resolved)) {
    return formatFallback(paper)
  }
  
  try {
    const csl = paperToCSL(paper)
    const cite = new Cite(csl)
    let formatted = cite.format('citation', {
      format: 'text',
      template: resolved,
      lang: 'en-US',
    }).trim()
    
    // Handle empty results
    if (!formatted || formatted === '()' || formatted === '[]' || formatted === '(, )') {
      formatted = formatFallback(paper)
    }
    
    inlineCache.set(cacheKey, formatted)
    return formatted
  } catch (error) {
    console.warn(`[LocalFormatter] Format error:`, error)
    return formatFallback(paper)
  }
}

/**
 * Format multiple inline citations (for grouped citations like [1-3])
 */
export function formatInlineMultiple(
  papers: CitationPaper[],
  styleId: string = 'apa',
  citationNumbers?: Map<string, number>
): string {
  const resolved = resolveStyleId(styleId)
  
  // For numeric styles, format as range or list
  if (isNumericStyle(resolved) && citationNumbers) {
    const numbers = papers
      .map(p => citationNumbers.get(p.id))
      .filter((n): n is number => n !== undefined)
      .sort((a, b) => a - b)
    
    if (numbers.length === 0) return '[?]'
    if (numbers.length === 1) return `[${numbers[0]}]`
    
    // Check if consecutive for range notation
    const isConsecutive = numbers.every((n, i) => i === 0 || n === numbers[i - 1] + 1)
    if (isConsecutive && numbers.length > 2) {
      return `[${numbers[0]}-${numbers[numbers.length - 1]}]`
    }
    
    return `[${numbers.join(', ')}]`
  }
  
  // For author-date styles, format each and join
  // citation-js can handle multiple in one call for proper grouping
  if (!loadedStyles.has(resolved)) {
    return papers.map(p => formatFallback(p)).join('; ')
  }
  
  try {
    const cslArray = papers.map(paperToCSL)
    const cite = new Cite(cslArray)
    return cite.format('citation', {
      format: 'text',
      template: resolved,
      lang: 'en-US',
    }).trim()
  } catch {
    return papers.map(p => formatInline(p, styleId)).join('; ')
  }
}

/**
 * Fast fallback format (no citation-js, pure string manipulation)
 */
function formatFallback(paper: CitationPaper): string {
  const authors = paper.authors || []
  const year = paper.year || 'n.d.'
  
  if (authors.length === 0) {
    return `(${year})`
  }
  
  // Extract last name from first author
  const firstAuthor = authors[0]
  const lastName = firstAuthor.includes(',')
    ? firstAuthor.split(',')[0].trim()
    : firstAuthor.split(' ').pop() || firstAuthor
  
  if (authors.length === 1) {
    return `(${lastName}, ${year})`
  } else if (authors.length === 2) {
    const secondAuthor = authors[1]
    const lastName2 = secondAuthor.includes(',')
      ? secondAuthor.split(',')[0].trim()
      : secondAuthor.split(' ').pop() || secondAuthor
    return `(${lastName} & ${lastName2}, ${year})`
  }
  
  return `(${lastName} et al., ${year})`
}

// =============================================================================
// Bibliography Formatting
// =============================================================================

/**
 * Format a single bibliography entry
 */
export function formatBibEntry(
  paper: CitationPaper,
  styleId: string = 'apa'
): string {
  const resolved = resolveStyleId(styleId)
  
  if (!loadedStyles.has(resolved)) {
    return formatBibFallback(paper)
  }
  
  try {
    const csl = paperToCSL(paper)
    const cite = new Cite(csl)
    return cite.format('bibliography', {
      format: 'text',
      template: resolved,
      lang: 'en-US',
    }).trim()
  } catch {
    return formatBibFallback(paper)
  }
}

/**
 * Format complete bibliography
 */
export function formatBibliography(
  papers: CitationPaper[],
  styleId: string = 'apa',
  citationNumbers?: Map<string, number>
): string {
  const resolved = resolveStyleId(styleId)
  
  // Sort papers for bibliography
  let sortedPapers = [...papers]
  
  if (isNumericStyle(resolved) && citationNumbers) {
    // Sort by citation number for numeric styles
    sortedPapers.sort((a, b) => {
      const numA = citationNumbers.get(a.id) || 999
      const numB = citationNumbers.get(b.id) || 999
      return numA - numB
    })
  } else {
    // Sort alphabetically by first author for author-date styles
    sortedPapers.sort((a, b) => {
      const authorA = (a.authors?.[0] || 'ZZZ').toLowerCase()
      const authorB = (b.authors?.[0] || 'ZZZ').toLowerCase()
      return authorA.localeCompare(authorB)
    })
  }
  
  if (!loadedStyles.has(resolved)) {
    return sortedPapers.map((p, i) => {
      const prefix = isNumericStyle(resolved) ? `[${citationNumbers?.get(p.id) || i + 1}] ` : ''
      return prefix + formatBibFallback(p)
    }).join('\n\n')
  }
  
  try {
    const cslArray = sortedPapers.map(paperToCSL)
    const cite = new Cite(cslArray)
    return cite.format('bibliography', {
      format: 'text',
      template: resolved,
      lang: 'en-US',
    }).trim()
  } catch {
    return sortedPapers.map(p => formatBibEntry(p, styleId)).join('\n\n')
  }
}

/**
 * Fallback bibliography entry format
 */
function formatBibFallback(paper: CitationPaper): string {
  const authors = (paper.authors || ['Unknown']).join(', ')
  const year = paper.year || 'n.d.'
  const title = paper.title || 'Untitled'
  const journal = paper.journal || paper.venue || ''
  const doi = paper.doi ? ` https://doi.org/${paper.doi}` : ''
  
  if (journal) {
    return `${authors} (${year}). ${title}. ${journal}.${doi}`
  }
  return `${authors} (${year}). ${title}.${doi}`
}

// =============================================================================
// Cache Management
// =============================================================================

/**
 * Clear all caches - call when citation style changes
 */
export function clearCaches(): void {
  inlineCache.clear()
  // Don't clear cslJsonCache - paper data doesn't change with style
}

/**
 * Clear cache for a specific paper
 */
export function clearPaperCache(paperId: string): void {
  // Clear all entries for this paper (any style)
  for (const key of inlineCache.keys()) {
    if (key.startsWith(`${paperId}:`)) {
      inlineCache.delete(key)
    }
  }
  cslJsonCache.delete(paperId)
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  return {
    loadedStyles: loadedStyles.size,
    cachedInline: inlineCache.size,
    cachedCsl: cslJsonCache.size,
  }
}
