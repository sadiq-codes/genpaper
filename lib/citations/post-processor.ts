// Note: Server-dependent functions use dynamic imports to keep pure functions testable

import type { CSLItem } from '@/lib/utils/csl'

/**
 * Citation Post-Processor
 * 
 * Processes [CITE: paper_id] markers in generated content and replaces them
 * with properly formatted citations. This is more reliable than real-time
 * tool calling because:
 * 
 * 1. AI just outputs structured text (no tool calling complexity)
 * 2. Citation resolution happens deterministically in code
 * 3. No race conditions or streaming issues
 * 4. Easy to debug and test
 */

// Pattern to match [CITE: paper_id] markers
const CITE_MARKER_PATTERN = /\[CITE:\s*([a-f0-9-]+)\]/gi

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
 */
export function extractCitationMarkers(content: string): Array<{ marker: string; paperId: string }> {
  const markers: Array<{ marker: string; paperId: string }> = []
  let match: RegExpExecArray | null
  
  // Reset regex state
  CITE_MARKER_PATTERN.lastIndex = 0
  
  while ((match = CITE_MARKER_PATTERN.exec(content)) !== null) {
    markers.push({
      marker: match[0],
      paperId: match[1]
    })
  }
  
  return markers
}

/**
 * Check if content contains citation markers
 */
export function hasCitationMarkers(content: string): boolean {
  CITE_MARKER_PATTERN.lastIndex = 0
  return CITE_MARKER_PATTERN.test(content)
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
        marker: `[CITE: ${paperId}]`
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
    // Create pattern that matches this specific paper_id (case-insensitive)
    const pattern = new RegExp(`\\[CITE:\\s*${paperId}\\]`, 'gi')
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
  
  // Remove any remaining [CITE: ...] markers that weren't processed
  cleaned = cleaned.replace(/\[CITE:\s*[^\]]*\]/gi, '')
  
  // Also clean non-citation artifacts
  cleaned = cleanNonCitationArtifacts(cleaned)
  
  // Clean up whitespace
  cleaned = cleaned.replace(/\s+\./g, '.')
  cleaned = cleaned.replace(/\s+,/g, ',')
  cleaned = cleaned.replace(/\s{2,}/g, ' ')
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
