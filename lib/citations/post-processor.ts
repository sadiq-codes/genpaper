// Note: Server-dependent functions use dynamic imports to keep pure functions testable

import { v4 as uuidv4 } from 'uuid'
import type { CSLItem } from '@/lib/utils/csl'

/**
 * Citation Post-Processor
 * 
 * Handles citation marker processing for multiple formats:
 * 
 * GENERATION FLOW (via pipeline.ts):
 * 1. LLM outputs [1], [2], [3] markers + structured citations array
 * 2. Pipeline converts to [@paperId#instanceId] format
 * 3. Instances saved to citation_instances table for hover previews
 * 
 * EDITOR FLOW (via tool-executor.ts):
 * 1. AI outputs [N] markers + CITATIONS block
 * 2. tool-executor parses block and converts to [@paperId#instanceId]
 * 
 * STORAGE FORMAT: [@paperId#instanceId] - enables hover quote previews
 */

// Storage format: [@paperId#instanceId] (group 1 = paperId, group 2 = instanceId)
// Also matches [@paperId] without instanceId for edge cases
const STORAGE_CITE_PATTERN = /\[@([a-f0-9-]+)(?:#([a-f0-9-]+))?\]/gi

export interface CitationProcessResult {
  /** Processed content with formatted citations */
  content: string
  /** List of citations found and processed */
  citations: Array<{
    paperId: string
    citationText: string
    marker: string
  }>
  /** Any errors encountered during processing */
  errors: Array<{
    paperId: string
    error: string
  }>
}

/**
 * Extract all citation markers from content
 * Supports [@paperId#instanceId] and [@paperId] formats
 */
export function extractCitationMarkers(content: string): Array<{ marker: string; paperId: string; instanceId?: string }> {
  const markers: Array<{ marker: string; paperId: string; instanceId?: string }> = []
  
  const pattern = new RegExp(STORAGE_CITE_PATTERN.source, 'gi')
  for (const match of content.matchAll(pattern)) {
    markers.push({
      marker: match[0],
      paperId: match[1],
      instanceId: match[2] || undefined
    })
  }
  
  return markers
}

/**
 * Check if content contains citation markers
 */
export function hasCitationMarkers(content: string): boolean {
  STORAGE_CITE_PATTERN.lastIndex = 0
  return STORAGE_CITE_PATTERN.test(content)
}

/**
 * Process all [CITE: paper_id] markers in content and replace with formatted citations
 * 
 * @param content - Raw content with [CITE: paper_id] markers
 * @param projectId - Project ID for citation service
 * @param citationStyle - Citation style (e.g., 'apa', 'mla', 'chicago')
 * @returns Processed content with formatted citations
 */
export async function processCitationMarkers(
  content: string,
  projectId: string,
  citationStyle: string = 'apa'
): Promise<CitationProcessResult> {
  const markers = extractCitationMarkers(content)
  
  if (markers.length === 0) {
    return {
      content,
      citations: [],
      errors: []
    }
  }
  
  const citations: CitationProcessResult['citations'] = []
  const errors: CitationProcessResult['errors'] = []
  const replacements: Map<string, string> = new Map()
  
  // Process each unique paper_id
  const uniquePaperIds = [...new Set(markers.map(m => m.paperId))]
  
  // Dynamic import to keep pure functions testable
  const { CitationService, formatInlineCitation } = await import('./immediate-bibliography')
  
  for (const paperId of uniquePaperIds) {
    try {
      // Get or create citation for this paper
      const result = await CitationService.add({
        projectId,
        sourceRef: { paperId },
        reason: 'Cited in generated content',
        quote: null
      })
      
      // Format the citation
      const cslJson = result.cslJson as unknown as CSLItem
      const citationNumber = result.citationNumber ?? 1
      const formattedCitation = formatInlineCitation(cslJson, citationStyle, citationNumber)
      
      // Store for replacement
      replacements.set(paperId, formattedCitation)
      
      citations.push({
        paperId,
        citationText: formattedCitation,
        marker: `[@${paperId}]`
      })
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error(`Failed to process citation for paper ${paperId}:`, errorMessage)
      
      errors.push({
        paperId,
        error: errorMessage
      })
      
      // Use a fallback marker that won't break the content
      replacements.set(paperId, `[citation error: ${paperId.slice(0, 8)}]`)
    }
  }
  
  // Replace all markers in content
  let processedContent = content
  
  for (const [paperId, formattedCitation] of replacements) {
    // Replace [@paperId] and [@paperId#instanceId] markers
    const pattern = new RegExp(`\\[@${paperId}(?:#[a-f0-9-]+)?\\]`, 'gi')
    processedContent = processedContent.replace(pattern, formattedCitation)
  }
  
  return {
    content: processedContent,
    citations,
    errors
  }
}

/**
 * Clean non-citation artifacts from generated content
 * This is called BEFORE citation processing to clean up AI mistakes
 * Note: Does NOT remove [CITE: paper_id] markers - those are processed separately
 */
export function cleanNonCitationArtifacts(content: string): string {
  let cleaned = content
  
  // Remove [CONTEXT FROM: ...] markers (evidence source markers that leaked)
  cleaned = cleaned.replace(/\[CONTEXT FROM:\s*[^\]]+\]/gi, '')
  
  // Remove addCitation(...) text (tool call syntax that leaked)
  cleaned = cleaned.replace(/addCitation\s*\([^)]*\)/gi, '')
  
  // Remove CITATION_N placeholders
  cleaned = cleaned.replace(/CITATION_\d+/g, '')
  
  // Remove placeholder citations
  cleaned = cleaned.replace(/\[(citation needed|cite|citation|ref|source needed)\]/gi, '')
  
  return cleaned
}

/**
 * Clean any remaining citation artifacts that shouldn't be in final output
 * This is called AFTER citation processing to clean up any remaining markers
 */
export function cleanRemainingArtifacts(content: string): string {
  let cleaned = content
  
  // Remove any remaining [@paperId] or [@paperId#instanceId] markers that weren't processed
  cleaned = cleaned.replace(/\[@[a-f0-9-]+(?:#[a-f0-9-]+)?\]/gi, '')
  
  // Also clean non-citation artifacts
  cleaned = cleanNonCitationArtifacts(cleaned)
  
  // Clean up whitespace
  cleaned = cleaned.replace(/\s+\./g, '.')
  cleaned = cleaned.replace(/\s+,/g, ',')
  // Replace multiple spaces (not newlines) with single space
  cleaned = cleaned.replace(/ {2,}/g, ' ')
  // Limit excessive newlines to max 2 (paragraph break)
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n')
  
  return cleaned.trim()
}

/**
 * Full processing pipeline: process markers then clean artifacts
 */
export async function processAndCleanCitations(
  content: string,
  projectId: string,
  citationStyle: string = 'apa'
): Promise<CitationProcessResult> {
  // First process citation markers
  const result = await processCitationMarkers(content, projectId, citationStyle)
  
  // Then clean any remaining artifacts
  result.content = cleanRemainingArtifacts(result.content)
  
  return result
}

// =============================================================================
// Consecutive Citation Deduplication
// =============================================================================

/**
 * Remove consecutive duplicate citations with the same paperId.
 * Handles both storage format [@paperId#instanceId] and keeps only the first occurrence.
 * 
 * Example: "text [@abc#inst1] [@abc#inst2] more" → "text [@abc#inst1] more"
 * Example: "text [@abc#inst1][@abc#inst2][@abc#inst3] more" → "text [@abc#inst1] more"
 * 
 * @param content - Content with citation markers
 * @returns Content with consecutive duplicates removed
 */
export function deduplicateConsecutiveCitations(content: string): {
  content: string
  duplicatesRemoved: number
} {
  let result = content
  let duplicatesRemoved = 0
  
  // Pattern to match consecutive citations with the same paperId
  // Captures: [@(paperId)#(instanceId)] followed by whitespace and [@(same paperId)#(any instanceId)]
  // We need to run this multiple times to catch chains like [1][1][1]
  let previousResult = ''
  
  while (previousResult !== result) {
    previousResult = result
    
    // Match: [@paperId#instanceId] followed by optional whitespace and [@SAME-paperId#differentInstanceId]
    result = result.replace(
      /(\[@([a-f0-9-]+)#[a-f0-9-]+\])(\s*)\[@\2#[a-f0-9-]+\]/gi,
      (match, firstCitation, paperId, whitespace) => {
        duplicatesRemoved++
        console.warn(`[Citation Dedup] Removed consecutive duplicate citation for paper: ${paperId}`)
        // Keep the first citation and the whitespace (if any)
        return firstCitation + whitespace
      }
    )
  }
  
  return { content: result, duplicatesRemoved }
}

/**
 * Deduplicate consecutive numbered citation markers BEFORE conversion.
 * This catches patterns like [1] [1] or [1][1][1] and reduces them to [1]
 * 
 * @param content - Content with numbered markers
 * @returns Content with consecutive duplicate numbers removed
 */
export function deduplicateConsecutiveNumberedCitations(content: string): {
  content: string
  duplicatesRemoved: number
} {
  let result = content
  let duplicatesRemoved = 0
  
  let previousResult = ''
  
  while (previousResult !== result) {
    previousResult = result
    
    // Match: [N] followed by optional whitespace and [same N]
    result = result.replace(
      /(\[(\d+)\])(\s*)\[\2\]/g,
      (match, firstCitation, number, whitespace) => {
        duplicatesRemoved++
        console.warn(`[Citation Dedup] Removed consecutive duplicate numbered citation: [${number}]`)
        return firstCitation + whitespace
      }
    )
  }
  
  return { content: result, duplicatesRemoved }
}

// =============================================================================
// Citation Instance Types (used by pipeline.ts)
// =============================================================================

/**
 * Citation instance to be saved to the database
 */
export interface CitationInstanceToCreate {
  instanceId: string   // UUID for this specific citation instance
  paperId: string      // UUID of the paper being cited
  quote: string        // The exact quote/context for this citation
}
