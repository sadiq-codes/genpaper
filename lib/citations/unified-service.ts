/**
 * Unified Citation Service
 * 
 * Single source of truth for all citation operations across:
 * - Paper generation (pipeline)
 * - Autocomplete (ghost text)
 * - Editor interactions
 * 
 * Supports citation styles: APA, MLA, Chicago, IEEE, Harvard
 */

import type { CSLItem } from '@/lib/utils/csl'

// ============================================================================
// Types
// ============================================================================

// CitationStyle now accepts any CSL style ID string
export type CitationStyle = string

export interface PaperMetadata {
  id: string
  title: string
  authors: string[] // Array of author names
  year: number
  doi?: string
  venue?: string
}

export interface CitationMarker {
  marker: string        // "[CITE: abc123]"
  paperId: string       // "abc123"
  position: {
    start: number
    end: number
  }
}

export interface FormattedCitation {
  marker: string        // Original marker
  formatted: string     // "(Smith et al., 2023)"
  paperId: string
  paper: PaperMetadata
}

export interface ProcessCitationsResult {
  content: string                    // Content with markers replaced
  citations: FormattedCitation[]     // Processed citations
  invalidPaperIds: string[]          // Paper IDs not found in project
}

// ============================================================================
// Citation Style Formatting
// ============================================================================

/**
 * Format inline citation based on style
 */
export function formatInlineCitation(paper: PaperMetadata, style: CitationStyle): string {
  const { authors, year } = paper
  
  // Parse author last names
  const lastNames = authors.map(author => {
    // Handle "Last, First" format
    if (author.includes(',')) {
      return author.split(',')[0].trim()
    }
    // Handle "First Last" format
    const parts = author.trim().split(/\s+/)
    return parts[parts.length - 1]
  })
  
  switch (style) {
    case 'apa':
      return formatAPA(lastNames, year)
    case 'mla':
      return formatMLA(lastNames)
    case 'chicago':
      return formatChicago(lastNames, year)
    case 'ieee':
      // IEEE uses numbers, but for inline we'll use a placeholder
      // The actual number is assigned during bibliography generation
      return `[citation]`
    case 'harvard':
      return formatHarvard(lastNames, year)
    default:
      return formatAPA(lastNames, year)
  }
}

function formatAPA(lastNames: string[], year: number): string {
  if (lastNames.length === 0) return `(Anonymous, ${year})`
  if (lastNames.length === 1) return `(${lastNames[0]}, ${year})`
  if (lastNames.length === 2) return `(${lastNames[0]} & ${lastNames[1]}, ${year})`
  return `(${lastNames[0]} et al., ${year})`
}

function formatMLA(lastNames: string[]): string {
  if (lastNames.length === 0) return '(Anonymous)'
  if (lastNames.length === 1) return `(${lastNames[0]})`
  if (lastNames.length === 2) return `(${lastNames[0]} and ${lastNames[1]})`
  return `(${lastNames[0]} et al.)`
}

function formatChicago(lastNames: string[], year: number): string {
  if (lastNames.length === 0) return `(Anonymous ${year})`
  if (lastNames.length === 1) return `(${lastNames[0]} ${year})`
  if (lastNames.length === 2) return `(${lastNames[0]} and ${lastNames[1]} ${year})`
  return `(${lastNames[0]} et al. ${year})`
}

function formatHarvard(lastNames: string[], year: number): string {
  // Harvard is similar to APA
  if (lastNames.length === 0) return `(Anonymous ${year})`
  if (lastNames.length === 1) return `(${lastNames[0]} ${year})`
  if (lastNames.length === 2) return `(${lastNames[0]} & ${lastNames[1]} ${year})`
  return `(${lastNames[0]} et al. ${year})`
}

// ============================================================================
// Citation Marker Processing
// ============================================================================

const CITE_MARKER_PATTERN = /\[CITE:\s*([a-f0-9-]+)\]/gi

/**
 * Extract all [CITE: paper_id] markers from content
 */
export function extractCitationMarkers(content: string): CitationMarker[] {
  const markers: CitationMarker[] = []
  let match: RegExpExecArray | null
  
  // Reset regex state
  const pattern = new RegExp(CITE_MARKER_PATTERN.source, 'gi')
  
  while ((match = pattern.exec(content)) !== null) {
    markers.push({
      marker: match[0],
      paperId: match[1],
      position: {
        start: match.index,
        end: match.index + match[0].length
      }
    })
  }
  
  return markers
}

/**
 * Check if content contains citation markers
 */
export function hasCitationMarkers(content: string): boolean {
  return CITE_MARKER_PATTERN.test(content)
}

/**
 * Process citation markers in content - replaces [CITE: id] with formatted citations
 * This is the pure function version that takes papers directly (no DB calls)
 */
export function processCitationMarkersSync(
  content: string,
  papers: PaperMetadata[],
  style: CitationStyle
): ProcessCitationsResult {
  const markers = extractCitationMarkers(content)
  
  if (markers.length === 0) {
    return {
      content,
      citations: [],
      invalidPaperIds: []
    }
  }
  
  // Build paper lookup map
  const paperMap = new Map<string, PaperMetadata>()
  for (const paper of papers) {
    paperMap.set(paper.id, paper)
  }
  
  const citations: FormattedCitation[] = []
  const invalidPaperIds: string[] = []
  let processedContent = content
  
  // Process markers in reverse order to preserve positions
  const sortedMarkers = [...markers].sort((a, b) => b.position.start - a.position.start)
  
  for (const marker of sortedMarkers) {
    const paper = paperMap.get(marker.paperId)
    
    if (!paper) {
      invalidPaperIds.push(marker.paperId)
      // Remove invalid marker
      processedContent = 
        processedContent.slice(0, marker.position.start) + 
        processedContent.slice(marker.position.end)
      continue
    }
    
    const formatted = formatInlineCitation(paper, style)
    
    citations.unshift({
      marker: marker.marker,
      formatted,
      paperId: marker.paperId,
      paper
    })
    
    // Replace marker with formatted citation
    processedContent = 
      processedContent.slice(0, marker.position.start) + 
      formatted + 
      processedContent.slice(marker.position.end)
  }
  
  return {
    content: processedContent,
    citations,
    invalidPaperIds
  }
}

// ============================================================================
// AI Context Building
// ============================================================================

/**
 * Build citation context for AI prompts
 * Provides clear paper IDs and metadata for the AI to use
 */
export function buildCitationContextForAI(papers: PaperMetadata[]): string {
  if (papers.length === 0) {
    return 'No papers available for citation.'
  }
  
  const paperList = papers.map(paper => {
    const authorStr = paper.authors.length > 0 
      ? paper.authors.slice(0, 3).join(', ') + (paper.authors.length > 3 ? ' et al.' : '')
      : 'Unknown'
    
    return `- ID: ${paper.id}
  Title: "${paper.title}"
  Authors: ${authorStr}
  Year: ${paper.year}`
  }).join('\n\n')
  
  return `## Available Papers for Citation

When citing, use the format: [CITE: paper_id]
Example: "Recent studies show promising results [CITE: abc123-def456]."

${paperList}`
}

/**
 * Build citation instructions for AI
 */
export function buildCitationInstructions(): string {
  return `## Citation Format

When you reference information from the provided sources, insert a citation marker:
[CITE: paper_id]

Rules:
- Place [CITE: paper_id] immediately after the sentence or clause using that source
- Use the EXACT paper_id from the Available Papers list
- You can cite multiple sources: "This is supported by research [CITE: id1] [CITE: id2]."
- Do NOT write (Author, Year) format - the system will format citations automatically
- Do NOT make up paper IDs - only use IDs from the Available Papers list`
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Clean any remaining citation artifacts from content
 */
export function cleanCitationArtifacts(content: string): string {
  let cleaned = content
  
  // Remove any remaining [CITE: ...] markers
  cleaned = cleaned.replace(/\[CITE:\s*[^\]]*\]/gi, '')
  
  // Remove [CONTEXT FROM: ...] markers
  cleaned = cleaned.replace(/\[CONTEXT FROM:\s*[^\]]+\]/gi, '')
  
  // Remove addCitation(...) text
  cleaned = cleaned.replace(/addCitation\s*\([^)]*\)/gi, '')
  
  // Remove CITATION_N placeholders
  cleaned = cleaned.replace(/CITATION_\d+/g, '')
  
  // Remove placeholder citations
  cleaned = cleaned.replace(/\[(citation needed|cite|citation|ref|source needed)\]/gi, '')
  
  // Clean up whitespace
  cleaned = cleaned.replace(/\s{2,}/g, ' ')
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n')
  
  return cleaned.trim()
}

/**
 * Get style display name
 */
export function getStyleDisplayName(style: CitationStyle): string {
  const names: Record<CitationStyle, string> = {
    apa: 'APA 7th Edition',
    mla: 'MLA 9th Edition',
    chicago: 'Chicago 17th Edition',
    ieee: 'IEEE',
    harvard: 'Harvard'
  }
  return names[style] || 'APA 7th Edition'
}

/**
 * Get style preview example
 */
export function getStylePreview(style: CitationStyle): string {
  const examples: Record<CitationStyle, string> = {
    apa: '(Smith et al., 2023)',
    mla: '(Smith et al.)',
    chicago: '(Smith et al. 2023)',
    ieee: '[1]',
    harvard: '(Smith et al. 2023)'
  }
  return examples[style] || '(Smith et al., 2023)'
}

/**
 * Validate citation style string
 * Now accepts any non-empty CSL style ID
 */
export function isValidCitationStyle(style: string): style is CitationStyle {
  // Accept any non-empty string up to 100 chars as a valid CSL style ID
  return typeof style === 'string' && style.length > 0 && style.length <= 100
}

/**
 * Convert CSLItem to PaperMetadata
 */
export function cslToPaperMetadata(csl: CSLItem, paperId: string): PaperMetadata {
  const authors = (csl.author || []).map(a => {
    if (a.literal) return a.literal
    if (a.family && a.given) return `${a.family}, ${a.given}`
    return a.family || 'Unknown'
  })
  
  const year = csl.issued?.['date-parts']?.[0]?.[0] || new Date().getFullYear()
  
  return {
    id: paperId,
    title: csl.title || 'Untitled',
    authors,
    year,
    doi: csl.DOI,
    venue: csl['container-title']
  }
}
