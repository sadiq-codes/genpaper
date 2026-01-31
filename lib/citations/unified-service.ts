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

import { v4 as uuidv4 } from 'uuid'
import type { CSLItem } from '@/lib/utils/csl'
import { isNumericStyleId } from '@/lib/citations/csl-styles'

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
  marker: string        // "[@abc123#inst456]" or "[@abc123]" (Pandoc format)
  paperId: string       // "abc123"
  instanceId?: string   // "inst456" (optional, for new format)
  format: 'pandoc' | 'legacy'  // Which format was matched
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

/**
 * Check if a style is numeric (IEEE/Vancouver/etc.)
 */
function isNumericCitationStyle(style: CitationStyle): boolean {
  const normalized = style.toLowerCase().trim()
  if (isNumericStyleId(normalized)) return true
  return (
    normalized.includes('number') ||
    normalized.includes('numeric') ||
    normalized.includes('superscript')
  )
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
// Numbered Citation Processing (for AI output)
// ============================================================================

/**
 * Numbered citation from AI response
 * AI outputs text with [1], [2], etc. markers and provides this mapping
 */
export interface NumberedCitation {
  index: number        // The number used in text: [1], [2], etc.
  paperId: string      // UUID of the paper
  citedContent: string // Exact quote from the paper (stored in DB, not in marker)
}

/**
 * Citation instance to be saved to the database
 * Contains instanceId, paperId, and quote for each citation occurrence
 */
export interface CitationInstanceToCreate {
  instanceId: string   // UUID for this specific citation instance
  paperId: string      // UUID of the paper being cited
  quote: string        // The exact quote/context for this citation
}

/**
 * Result of processing numbered citations
 */
export interface ProcessNumberedCitationsResult {
  // Text with [@paperId#instanceId] markers (new format for storage/editor)
  contentWithMarkers: string
  // Text with formatted citations like (Smith et al., 2023)
  contentFormatted: string
  // Citation instances to save to the database
  instancesToCreate: CitationInstanceToCreate[]
  // Successfully processed citations with full metadata
  processedCitations: Array<{
    index: number
    paperId: string
    instanceId: string  // UUID for this instance
    citedContent: string
    marker: string      // [@paperId#instanceId]
    formatted: string   // (Author, Year)
    paper: PaperMetadata
  }>
  // Citations that failed (invalid paperId)
  failedCitations: Array<{
    citation: NumberedCitation
    reason: 'invalid_paper_id' | 'marker_not_found'
  }>
}

/**
 * Pattern to match numbered citation markers [1], [2], etc.
 */
const NUMBERED_CITATION_PATTERN = /\[(\d+)\]/g

/**
 * Process numbered citations in text
 * 
 * Takes text with [1], [2] markers and a citations array mapping index → paperId.
 * Replaces [1] with [@paperId#instanceId] for storage and (Author, Year) for display.
 * 
 * Each citation occurrence gets a unique instanceId. The caller should save the
 * returned `instancesToCreate` to the citation_instances table.
 */
export function processNumberedCitations(
  text: string,
  citations: NumberedCitation[],
  papers: PaperMetadata[],
  style: CitationStyle
): ProcessNumberedCitationsResult {
  // Build paper lookup map
  const paperMap = new Map<string, PaperMetadata>()
  for (const paper of papers) {
    paperMap.set(paper.id, paper)
  }
  
  // Build citation index lookup with duplicate detection
  const citationMap = new Map<number, NumberedCitation>()
  const duplicateIndices: number[] = []
  for (const citation of citations) {
    if (citationMap.has(citation.index)) {
      duplicateIndices.push(citation.index)
      console.warn(`[processNumberedCitations] Duplicate citation index: ${citation.index}`)
    }
    citationMap.set(citation.index, citation)
  }
  
  if (duplicateIndices.length > 0) {
    console.warn(`[processNumberedCitations] Found ${duplicateIndices.length} duplicate indices: ${duplicateIndices.join(', ')}`)
  }
  
  const processedCitations: ProcessNumberedCitationsResult['processedCitations'] = []
  const failedCitations: ProcessNumberedCitationsResult['failedCitations'] = []
  const instancesToCreate: CitationInstanceToCreate[] = []
  
  // Track which citation indices we've seen in the text
  const seenIndices = new Set<number>()
  // Track orphaned markers (in text but not in citations array)
  const orphanedMarkers: Array<{ index: number; position: number }> = []
  
  // Find all [N] markers in text and collect replacements
  const replacements: Array<{
    start: number
    end: number
    index: number
    instanceId: string
    marker: string
    formatted: string
    citation: NumberedCitation
    paper: PaperMetadata
  }> = []
  
  let match: RegExpExecArray | null
  const pattern = new RegExp(NUMBERED_CITATION_PATTERN.source, 'g')
  
  while ((match = pattern.exec(text)) !== null) {
    const index = parseInt(match[1], 10)
    seenIndices.add(index)
    
    const citation = citationMap.get(index)
    if (!citation) {
      // Marker in text but no citation in array - track as orphaned
      orphanedMarkers.push({ index, position: match.index })
      continue
    }
    
    const paper = paperMap.get(citation.paperId)
    if (!paper) {
      failedCitations.push({
        citation,
        reason: 'invalid_paper_id'
      })
      continue
    }
    
    // Generate a unique instance ID for this citation occurrence
    const instanceId = uuidv4()
    
    // New marker format with instance tracking: [@paperId#instanceId]
    const marker = `[@${citation.paperId}#${instanceId}]`
    const formatted = isNumericCitationStyle(style)
      ? `[${index}]`
      : formatInlineCitation(paper, style)
    
    replacements.push({
      start: match.index,
      end: match.index + match[0].length,
      index,
      instanceId,
      marker,
      formatted,
      citation,
      paper
    })
    
    // Track instance for DB insertion
    instancesToCreate.push({
      instanceId,
      paperId: citation.paperId,
      quote: citation.citedContent,
    })
  }
  
  // Check for citations in array but not in text
  for (const citation of citations) {
    if (!seenIndices.has(citation.index)) {
      failedCitations.push({
        citation,
        reason: 'marker_not_found'
      })
    }
  }
  
  // Log orphaned markers (in text but not in citations array)
  if (orphanedMarkers.length > 0) {
    console.warn(`[processNumberedCitations] Found ${orphanedMarkers.length} orphaned markers in text: ${orphanedMarkers.map(m => `[${m.index}]`).join(', ')}`)
    // Add orphaned markers as failures with a synthetic citation object
    for (const orphan of orphanedMarkers) {
      failedCitations.push({
        citation: { index: orphan.index, paperId: '', citedContent: '' },
        reason: 'marker_not_found' // Reusing this reason - marker exists but citation doesn't
      })
    }
  }
  
  // Sort replacements by position (descending) to replace from end to start
  replacements.sort((a, b) => b.start - a.start)
  
  // Apply replacements
  let contentWithMarkers = text
  let contentFormatted = text
  
  for (const r of replacements) {
    contentWithMarkers = 
      contentWithMarkers.slice(0, r.start) + 
      r.marker + 
      contentWithMarkers.slice(r.end)
    
    contentFormatted = 
      contentFormatted.slice(0, r.start) + 
      r.formatted + 
      contentFormatted.slice(r.end)
    
    processedCitations.unshift({
      index: r.index,
      paperId: r.citation.paperId,
      instanceId: r.instanceId,
      citedContent: r.citation.citedContent,
      marker: r.marker,
      formatted: r.formatted,
      paper: r.paper
    })
  }
  
  // Strip any orphaned [N] markers that weren't matched to citations
  contentWithMarkers = contentWithMarkers.replace(/\[(\d+)\]/g, '')
  contentFormatted = contentFormatted.replace(/\[(\d+)\]/g, '')
  
  // Clean up extra whitespace
  // IMPORTANT: do not collapse newlines, or markdown headings/paragraphs break.
  contentWithMarkers = contentWithMarkers.replace(/[ \t]{2,}/g, ' ')
  contentFormatted = contentFormatted.replace(/[ \t]{2,}/g, ' ')
  
  return {
    contentWithMarkers,
    contentFormatted,
    instancesToCreate,
    processedCitations,
    failedCitations
  }
}

// ============================================================================
// Citation Marker Processing
// ============================================================================

// New format with instance tracking: [@paperId#instanceId] (group 1 = paperId, group 2 = instanceId)
// Also matches legacy [@paperId] without instanceId for backward compatibility
const PANDOC_CITE_PATTERN = /\[@([a-f0-9-]+)(?:#([a-f0-9-]+))?\]/gi

// Legacy citation format (for backward compatibility): [CITE: paper_id]
const LEGACY_CITE_PATTERN = /\[CITE:\s*([a-f0-9-]+)\]/gi

// Plain bracket format (AI sometimes outputs this): [paper_id]
// Only matches UUIDs to avoid matching other bracketed content
const PLAIN_BRACKET_PATTERN = /\[([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\]/gi

/**
 * Extract all citation markers from content
 * Supports:
 * - [@paperId#instanceId] (new format with instance tracking)
 * - [@paperId] (Pandoc, backward compatible)
 * - [CITE: paperId] (legacy)
 */
export function extractCitationMarkers(content: string): CitationMarker[] {
  const markers: CitationMarker[] = []
  let match: RegExpExecArray | null
  
  // Extract Pandoc-style markers: [@paperId] or [@paperId#instanceId]
  const pandocPattern = new RegExp(PANDOC_CITE_PATTERN.source, 'gi')
  while ((match = pandocPattern.exec(content)) !== null) {
    markers.push({
      marker: match[0],
      paperId: match[1],
      instanceId: match[2] || undefined,  // Group 2 is optional instanceId
      format: 'pandoc',
      position: {
        start: match.index,
        end: match.index + match[0].length
      }
    })
  }
  
  // Extract legacy [CITE: paper_id] markers (backward compatibility)
  const legacyPattern = new RegExp(LEGACY_CITE_PATTERN.source, 'gi')
  while ((match = legacyPattern.exec(content)) !== null) {
    markers.push({
      marker: match[0],
      paperId: match[1],
      format: 'legacy',
      position: {
        start: match.index,
        end: match.index + match[0].length
      }
    })
  }
  
  // Extract plain bracket [uuid] markers (fallback for when AI doesn't use @ symbol)
  // Only if no pandoc markers were found at that position
  const plainPattern = new RegExp(PLAIN_BRACKET_PATTERN.source, 'gi')
  while ((match = plainPattern.exec(content)) !== null) {
    // Check if this position already has a marker (avoid duplicates)
    const alreadyFound = markers.some(m => 
      m.position.start === match!.index || m.paperId === match![1]
    )
    if (!alreadyFound) {
      markers.push({
        marker: match[0],
        paperId: match[1],
        format: 'pandoc', // Treat as pandoc format for processing
        position: {
          start: match.index,
          end: match.index + match[0].length
        }
      })
    }
  }
  
  // Sort by position for consistent processing
  markers.sort((a, b) => a.position.start - b.position.start)
  
  return markers
}

/**
 * Check if content contains citation markers (either format)
 */
export function hasCitationMarkers(content: string): boolean {
  PANDOC_CITE_PATTERN.lastIndex = 0
  LEGACY_CITE_PATTERN.lastIndex = 0
  return PANDOC_CITE_PATTERN.test(content) || LEGACY_CITE_PATTERN.test(content)
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
    
    return `- [@${paper.id}] "${paper.title}" by ${authorStr} (${paper.year})`
  }).join('\n')
  
  return `## Available Papers for Citation

Use Pandoc-style citations: [@paper_id]
Example: "Recent studies show promising results [@abc123-def456]."

${paperList}`
}

/**
 * Build citation instructions for AI
 */
export function buildCitationInstructions(): string {
  return `## Citation Format

When you reference information from the provided sources, insert a citation marker:
[@paper_id]

This is standard Pandoc/academic citation format.

Rules:
- Place [@paper_id] immediately after the sentence or clause using that source
- Use the EXACT paper_id from the Available Papers list
- For multiple sources, use SEPARATE brackets: "This is supported by research [@id1] [@id2]."
- NEVER group citations with semicolons like [@id1; @id2] - this breaks formatting
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
  
  // Remove any remaining [@...] markers (Pandoc format)
  cleaned = cleaned.replace(/\[@[^\]]*\]/gi, '')
  
  // Remove any remaining [CITE: ...] markers (legacy format)
  cleaned = cleaned.replace(/\[CITE:\s*[^\]]*\]/gi, '')
  
  // Remove [CONTEXT FROM: ...] markers (legacy evidence format)
  cleaned = cleaned.replace(/\[CONTEXT FROM:\s*[^\]]+\]/gi, '')
  
  // Remove addCitation(...) text
  cleaned = cleaned.replace(/addCitation\s*\([^)]*\)/gi, '')
  
  // Remove CITATION_N placeholders
  cleaned = cleaned.replace(/CITATION_\d+/g, '')
  
  // Remove placeholder citations
  cleaned = cleaned.replace(/\[(citation needed|cite|citation|ref|source needed)\]/gi, '')
  
  // Clean up whitespace
  // IMPORTANT: do not collapse newlines, or markdown headings/paragraphs break.
  cleaned = cleaned.replace(/[ \t]{2,}/g, ' ')
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
