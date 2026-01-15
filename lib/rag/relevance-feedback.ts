/**
 * Relevance Feedback Service
 * 
 * Tracks which chunks were actually cited in generated content
 * to improve future retrieval through citation-based boosting.
 * 
 * The feedback loop:
 * 1. Generate content → chunks are retrieved
 * 2. Content is finalized → citations are extracted
 * 3. Cited chunks are logged → citation_log table
 * 4. Future searches → boosted by citation history
 */

import 'server-only'
import { getSB } from '@/lib/supabase/server'

export interface CitationLogEntry {
  chunkId: string
  paperId: string
  projectId: string
  sectionType?: string
  queryContext?: string
}

/**
 * Log a single chunk citation.
 */
export async function logChunkCitation(entry: CitationLogEntry): Promise<void> {
  const supabase = await getSB()
  
  const { error } = await supabase.rpc('log_chunk_citation', {
    p_chunk_id: entry.chunkId,
    p_paper_id: entry.paperId,
    p_project_id: entry.projectId,
    p_section_type: entry.sectionType || null,
    p_query_context: entry.queryContext || null
  })
  
  if (error) {
    // Don't throw - logging failures shouldn't break generation
    console.warn('Failed to log chunk citation:', error.message)
  }
}

/**
 * Check if a string is a valid UUID format
 */
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(str)
}

/**
 * Log multiple chunk citations in batch.
 */
export async function logChunkCitations(entries: CitationLogEntry[]): Promise<void> {
  if (entries.length === 0) return
  
  // Filter out entries with invalid chunk IDs (e.g., abstract fallback chunks like "abstract-{paper_id}")
  // These synthetic IDs aren't valid UUIDs and would fail the database insert
  const validEntries = entries.filter(e => isValidUUID(e.chunkId))
  
  if (validEntries.length === 0) {
    // All entries were abstract fallbacks - this is fine, just skip logging
    return
  }
  
  if (validEntries.length < entries.length) {
    console.log(`📊 Filtered ${entries.length - validEntries.length} abstract fallback chunks from citation logging`)
  }
  
  const supabase = await getSB()
  
  // Use batch insert for efficiency
  const { error } = await supabase
    .from('chunk_citation_log')
    .upsert(
      validEntries.map(e => ({
        chunk_id: e.chunkId,
        paper_id: e.paperId,
        project_id: e.projectId,
        section_type: e.sectionType || null,
        query_context: e.queryContext || null,
        was_cited: true
      })),
      {
        onConflict: 'chunk_id,project_id,section_type',
        ignoreDuplicates: false // Update if exists
      }
    )
  
  if (error) {
    console.warn('Failed to log chunk citations batch:', error.message)
  } else {
    console.log(`📊 Logged ${validEntries.length} chunk citations for relevance feedback`)
  }
}

/**
 * Extract cited chunk IDs from generated content.
 * Looks for citation markers like [CITE: paper_id] in the content.
 */
export function extractCitedChunksFromContent(
  content: string,
  retrievedChunks: Array<{ id?: string; paper_id: string; content: string }>
): string[] {
  // Extract paper IDs from citation markers
  const citedPaperIds = new Set<string>()
  
  // Match [CITE: xxx] patterns
  const citeMatches = content.matchAll(/\[CITE:\s*([^\]]+)\]/g)
  for (const match of citeMatches) {
    citedPaperIds.add(match[1].trim())
  }
  
  // Find chunks that were from cited papers
  const citedChunkIds: string[] = []
  for (const chunk of retrievedChunks) {
    if (chunk.id && citedPaperIds.has(chunk.paper_id)) {
      citedChunkIds.push(chunk.id)
    }
  }
  
  return citedChunkIds
}

/**
 * Get citation statistics for chunks.
 */
export async function getChunkCitationStats(
  chunkIds: string[]
): Promise<Map<string, { totalCitations: number; uniqueProjects: number }>> {
  if (chunkIds.length === 0) return new Map()
  
  const supabase = await getSB()
  
  const { data, error } = await supabase
    .from('chunk_citation_stats')
    .select('chunk_id, total_citations, unique_projects')
    .in('chunk_id', chunkIds)
  
  if (error) {
    console.warn('Failed to fetch citation stats:', error.message)
    return new Map()
  }
  
  const stats = new Map<string, { totalCitations: number; uniqueProjects: number }>()
  for (const row of data || []) {
    stats.set(row.chunk_id, {
      totalCitations: row.total_citations,
      uniqueProjects: row.unique_projects
    })
  }
  
  return stats
}

/**
 * Refresh the citation stats materialized view.
 * Should be called periodically (e.g., after bulk generation).
 */
export async function refreshCitationStats(): Promise<void> {
  const supabase = await getSB()
  
  const { error } = await supabase.rpc('refresh_chunk_citation_stats')
  
  if (error) {
    console.warn('Failed to refresh citation stats:', error.message)
  } else {
    console.log('📊 Citation stats refreshed')
  }
}

/**
 * Higher-level function to log citations after section generation.
 * Call this after each section is generated with its content and context.
 */
export async function logSectionCitations(
  projectId: string,
  sectionType: string,
  generatedContent: string,
  contextChunks: Array<{ id?: string; paper_id: string; content: string }>,
  queryContext?: string
): Promise<void> {
  // Find which chunks were actually cited
  const citedChunkIds = extractCitedChunksFromContent(generatedContent, contextChunks)
  
  if (citedChunkIds.length === 0) {
    return
  }
  
  // Build log entries
  const entries: CitationLogEntry[] = []
  for (const chunkId of citedChunkIds) {
    const chunk = contextChunks.find(c => c.id === chunkId)
    if (chunk) {
      entries.push({
        chunkId,
        paperId: chunk.paper_id,
        projectId,
        sectionType,
        queryContext
      })
    }
  }
  
  await logChunkCitations(entries)
}
