// Note: Server-dependent functions use dynamic imports to keep pure functions testable

import { v4 as uuidv4 } from 'uuid'
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

// Patterns to match citation markers
// New format with instance tracking: [@paperId#instanceId] (group 1 = paperId, group 2 = instanceId)
// Also matches legacy [@paperId] without instanceId for backward compatibility
const PANDOC_CITE_PATTERN = /\[@([a-f0-9-]+)(?:#([a-f0-9-]+))?\]/gi
// Legacy format (for backward compatibility): [CITE: paper_id]
const LEGACY_CITE_PATTERN = /\[CITE:\s*([a-f0-9-]+)\]/gi

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
 * Supports both [@paper_id] (Pandoc) and [CITE: paper_id] (legacy) formats
 */
export function extractCitationMarkers(content: string): Array<{ marker: string; paperId: string }> {
  const markers: Array<{ marker: string; paperId: string }> = []
  
  // Extract Pandoc-style [@paper_id] markers (preferred format)
  const pandocPattern = new RegExp(PANDOC_CITE_PATTERN.source, 'gi')
  for (const match of content.matchAll(pandocPattern)) {
    markers.push({
      marker: match[0],
      paperId: match[1]
    })
  }
  
  // Extract legacy [CITE: paper_id] markers (backward compatibility)
  const legacyPattern = new RegExp(LEGACY_CITE_PATTERN.source, 'gi')
  for (const match of content.matchAll(legacyPattern)) {
    markers.push({
      marker: match[0],
      paperId: match[1]
    })
  }
  
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
  
  // Replace all markers in content (both Pandoc and legacy formats)
  let processedContent = content
  
  for (const [paperId, formattedCitation] of replacements) {
    // Replace Pandoc-style [@paper_id] markers
    const pandocPattern = new RegExp(`\\[@${paperId}\\]`, 'gi')
    processedContent = processedContent.replace(pandocPattern, formattedCitation)
    
    // Replace legacy [CITE: paper_id] markers
    const legacyPattern = new RegExp(`\\[CITE:\\s*${paperId}\\]`, 'gi')
    processedContent = processedContent.replace(legacyPattern, formattedCitation)
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
  
  // Remove any remaining [CITE: ...] legacy markers that weren't processed
  cleaned = cleaned.replace(/\[CITE:\s*[^\]]*\]/gi, '')
  
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
// Numbered Citation Processing (for generation pipeline)
// =============================================================================

// Pattern to match numbered citation markers [1], [2], etc.
const NUMBERED_CITE_PATTERN = /\[(\d+)\]/g

// Pattern to extract the CITATIONS block (global to match all blocks across sections)
const CITATIONS_BLOCK_PATTERN = /<!--\s*CITATIONS\s*([\s\S]*?)-->/gi

// Pattern to parse individual citation entries in the block
// Format: [N] paper_id: xxx | quote: "yyy"
const CITATION_ENTRY_PATTERN = /\[(\d+)\]\s*paper_id:\s*([a-f0-9-]+)(?:\s*\|\s*quote:\s*"([^"]*)")?/gi

interface NumberedCitationEntry {
  index: number
  paperId: string
  quote?: string
}

/**
 * Citation instance to be saved to the database
 */
export interface CitationInstanceToCreate {
  instanceId: string   // UUID for this specific citation instance
  paperId: string      // UUID of the paper being cited
  quote: string        // The exact quote/context for this citation
}

/**
 * Result of converting numbered citations to storage format
 */
export interface ConvertNumberedResult {
  content: string                        // Content with [@paperId#instanceId] markers
  instancesToCreate: CitationInstanceToCreate[]  // Instances to save to DB
}

/**
 * Parse ALL CITATIONS blocks from content (handles multiple sections)
 * Returns a map of index → { paperId, quote }
 * 
 * When multiple sections are generated, each may have its own CITATIONS block.
 * This function iterates all blocks and merges entries (first occurrence wins).
 */
export function parseNumberedCitationsBlock(content: string): Map<number, NumberedCitationEntry> {
  const entries = new Map<number, NumberedCitationEntry>()
  
  // Create fresh pattern instance to reset lastIndex for matchAll
  const blockPattern = /<!--\s*CITATIONS\s*([\s\S]*?)-->/gi
  
  for (const blockMatch of content.matchAll(blockPattern)) {
    const blockContent = blockMatch[1]
    const entryPattern = new RegExp(CITATION_ENTRY_PATTERN.source, 'gi')
    
    for (const match of blockContent.matchAll(entryPattern)) {
      const index = parseInt(match[1], 10)
      // Use first occurrence for each index (don't override)
      if (!entries.has(index)) {
        entries.set(index, {
          index,
          paperId: match[2],
          quote: match[3] || undefined
        })
      }
    }
  }
  
  return entries
}

/**
 * Check if content has a CITATIONS block
 */
export function hasNumberedCitationsBlock(content: string): boolean {
  // Use fresh pattern to avoid lastIndex issues with global regex
  return /<!--\s*CITATIONS\s*([\s\S]*?)-->/i.test(content)
}

/**
 * Convert numbered citation markers to [@paperId#instanceId] format for storage
 * Uses the CITATIONS block to map [1], [2] etc. to paper IDs
 * Each citation occurrence gets a unique instanceId for tracking the specific quote used.
 * 
 * @param content - Content with [1], [2] markers and CITATIONS block
 * @returns Object with converted content and instances to save to DB
 */
export function convertNumberedToStorageFormat(content: string): ConvertNumberedResult {
  const citationsMap = parseNumberedCitationsBlock(content)
  const instancesToCreate: CitationInstanceToCreate[] = []
  
  let result = content
  
  // First, deduplicate consecutive numbered citations BEFORE conversion
  // This catches patterns like [1] [1] or [1][1][1] from AI output
  const { content: dedupedContent, duplicatesRemoved: numberedDupsRemoved } = 
    deduplicateConsecutiveNumberedCitations(result)
  result = dedupedContent
  
  if (numberedDupsRemoved > 0) {
    console.log(`[Citation Dedup] Removed ${numberedDupsRemoved} consecutive duplicate numbered citations before conversion`)
  }
  
  if (citationsMap.size > 0) {
    // For each citation index, find all occurrences and replace with unique instances
    for (const [index, entry] of citationsMap) {
      const pattern = new RegExp(`\\[${index}\\]`, 'g')
      
      // Replace each occurrence with a unique instanceId
      result = result.replace(pattern, () => {
        const instanceId = uuidv4()
        
        // Track this instance for DB insertion
        instancesToCreate.push({
          instanceId,
          paperId: entry.paperId,
          quote: entry.quote || '',
        })
        
        return `[@${entry.paperId}#${instanceId}]`
      })
    }
    
    // After conversion, deduplicate any consecutive citations with same paperId
    // This handles edge cases where different numbered citations map to the same paper
    const { content: finalContent, duplicatesRemoved: storageDupsRemoved } = 
      deduplicateConsecutiveCitations(result)
    result = finalContent
    
    if (storageDupsRemoved > 0) {
      console.log(`[Citation Dedup] Removed ${storageDupsRemoved} consecutive duplicate storage-format citations`)
      // Also remove the duplicate instances from the array
      // We need to filter out instances that were removed from content
      const remainingInstanceIds = new Set<string>()
      const instancePattern = /@[a-f0-9-]+#([a-f0-9-]+)\]/gi
      for (const match of result.matchAll(instancePattern)) {
        remainingInstanceIds.add(match[1])
      }
      // Filter instances to only keep those still in content
      const originalCount = instancesToCreate.length
      const filteredInstances = instancesToCreate.filter(inst => remainingInstanceIds.has(inst.instanceId))
      instancesToCreate.length = 0
      instancesToCreate.push(...filteredInstances)
      if (instancesToCreate.length < originalCount) {
        console.log(`[Citation Dedup] Filtered citation instances: ${originalCount} → ${instancesToCreate.length}`)
      }
    }
  }
  
  // Remove the CITATIONS block
  result = result.replace(CITATIONS_BLOCK_PATTERN, '')
  
  // Strip any orphaned [N] markers that weren't in the CITATIONS block
  // These are markers the AI included but didn't define - remove them cleanly
  result = result.replace(/\[(\d+)\]/g, '')
  
  // Clean up extra whitespace and punctuation artifacts
  // IMPORTANT: do not collapse newlines, or markdown headings/paragraphs break.
  // Collapse only repeated spaces/tabs within a line.
  result = result.replace(/[ \t]{2,}/g, ' ')
  result = result.replace(/\n{3,}/g, '\n\n')
  result = result.trim()
  
  return {
    content: result,
    instancesToCreate,
  }
}
