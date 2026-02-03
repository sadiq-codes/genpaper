/**
 * Database Service for Paper Extractions (Service Client Version)
 * 
 * This version uses createServiceClient instead of createClient,
 * making it suitable for background processing and server-side operations
 * that don't have access to cookies.
 * 
 * @module lib/extraction/db-service
 */

import { createServiceClient } from '@/lib/supabase/service'
import type {
  PaperExtraction,
  Finding
} from './types'

// =============================================================================
// Database Row Types
// =============================================================================

interface PaperExtractionRow {
  id: string
  paper_id: string
  extraction_version: number
  metadata: PaperExtraction['metadata']
  findings: Finding[]
  research_question: string | null
  contributions: string[]
  limitations: string[]
  extraction_confidence: number
  extraction_notes: string[]
  extracted_at: string
  extraction_time_ms: number
  model_used: string
}

interface PaperFindingRow {
  id: string
  paper_id: string
  extraction_id: string
  claim: string
  evidence: string
  value: string | null
  value_type: string | null
  direction: string | null
  compared_to: string | null
  context: string | null
  is_main_finding: boolean
  confidence: number
}

// =============================================================================
// Save Extraction (Service Client)
// =============================================================================

/**
 * Save a paper extraction to the database using service client
 * Use this for background processing where cookies aren't available
 */
export async function saveExtractionService(extraction: PaperExtraction): Promise<string> {
  const supabase = createServiceClient()
  
  // Get current version for this paper
  const { data: existing } = await supabase
    .from('paper_extractions')
    .select('extraction_version')
    .eq('paper_id', extraction.paperId)
    .order('extraction_version', { ascending: false })
    .limit(1)
    .single()
  
  const newVersion = (existing?.extraction_version || 0) + 1
  
  // Prepare row
  const row = {
    paper_id: extraction.paperId,
    extraction_version: newVersion,
    metadata: extraction.metadata,
    findings: extraction.findings,
    research_question: extraction.researchQuestion || null,
    contributions: extraction.contributions,
    limitations: extraction.limitations,
    extraction_confidence: extraction.extractionConfidence,
    extraction_notes: extraction.extractionNotes,
    extracted_at: extraction.extractedAt.toISOString(),
    extraction_time_ms: extraction.extractionTimeMs,
    model_used: extraction.modelUsed
  }
  
  const { data, error } = await supabase
    .from('paper_extractions')
    .insert(row)
    .select('id')
    .single()
  
  if (error) {
    console.error('Failed to save extraction:', error)
    throw new Error(`Failed to save extraction: ${error.message}`)
  }
  
  // Save normalized findings for easier querying
  await saveNormalizedFindingsService(supabase, data.id, extraction)
  
  console.log(`💾 Saved extraction for paper ${extraction.paperId} (version ${newVersion})`)
  
  return data.id
}

/**
 * Save normalized findings for cross-document analysis
 */
async function saveNormalizedFindingsService(
  supabase: ReturnType<typeof createServiceClient>,
  extractionId: string,
  extraction: PaperExtraction
): Promise<void> {
  if (extraction.findings.length === 0) return
  
  const rows: Omit<PaperFindingRow, 'id'>[] = extraction.findings.map(f => ({
    paper_id: extraction.paperId,
    extraction_id: extractionId,
    claim: f.claim,
    evidence: f.evidence,
    value: f.value || null,
    value_type: f.valueType || null,
    direction: f.direction || null,
    compared_to: f.comparedTo || null,
    context: f.context || null,
    is_main_finding: f.isMainFinding,
    confidence: f.confidence
  }))
  
  const { error } = await supabase
    .from('paper_findings')
    .insert(rows)
  
  if (error) {
    console.warn('Failed to save normalized findings:', error)
  } else {
    console.log(`   📊 Saved ${rows.length} findings`)
  }
}

// =============================================================================
// Retrieve Extractions (Service Client)
// =============================================================================

/**
 * Get the latest extraction for a paper using service client
 */
export async function getExtractionService(paperId: string): Promise<PaperExtraction | null> {
  const supabase = createServiceClient()
  
  const { data, error } = await supabase
    .from('paper_extractions')
    .select('*')
    .eq('paper_id', paperId)
    .order('extraction_version', { ascending: false })
    .limit(1)
    .single()
  
  if (error || !data) {
    return null
  }
  
  return rowToExtraction(data as PaperExtractionRow)
}

/**
 * Get extractions for multiple papers using service client
 */
export async function getExtractionsService(paperIds: string[]): Promise<Map<string, PaperExtraction>> {
  const supabase = createServiceClient()
  
  const { data, error } = await supabase
    .from('paper_extractions')
    .select('*')
    .in('paper_id', paperIds)
    .order('extraction_version', { ascending: false })
  
  if (error || !data) {
    return new Map()
  }
  
  // Keep only latest version per paper
  const latest = new Map<string, PaperExtractionRow>()
  for (const row of data as PaperExtractionRow[]) {
    if (!latest.has(row.paper_id)) {
      latest.set(row.paper_id, row)
    }
  }
  
  // Convert to extractions
  const result = new Map<string, PaperExtraction>()
  for (const [paperId, row] of latest) {
    result.set(paperId, rowToExtraction(row))
  }
  
  return result
}

/**
 * Check if a paper has an extraction using service client
 */
export async function hasExtractionService(paperId: string): Promise<boolean> {
  const supabase = createServiceClient()
  
  const { count, error } = await supabase
    .from('paper_extractions')
    .select('id', { count: 'exact', head: true })
    .eq('paper_id', paperId)
  
  return !error && (count || 0) > 0
}

/**
 * Get papers that need extraction using service client
 */
export async function getPapersNeedingExtractionService(
  paperIds: string[],
  minConfidence?: number
): Promise<string[]> {
  const supabase = createServiceClient()
  
  const { data: existing } = await supabase
    .from('paper_extractions')
    .select('paper_id, extraction_confidence')
    .in('paper_id', paperIds)
  
  const existingMap = new Map(
    (existing || []).map(e => [e.paper_id, e.extraction_confidence])
  )
  
  return paperIds.filter(id => {
    const confidence = existingMap.get(id)
    if (confidence === undefined) return true
    if (minConfidence && confidence < minConfidence) return true
    return false
  })
}

// =============================================================================
// Helpers
// =============================================================================

function rowToExtraction(row: PaperExtractionRow): PaperExtraction {
  return {
    paperId: row.paper_id,
    metadata: row.metadata,
    findings: row.findings,
    researchQuestion: row.research_question || undefined,
    contributions: row.contributions,
    limitations: row.limitations,
    extractionConfidence: row.extraction_confidence,
    extractionNotes: row.extraction_notes,
    extractedAt: new Date(row.extracted_at),
    extractionTimeMs: row.extraction_time_ms,
    modelUsed: row.model_used
  }
}
