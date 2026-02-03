/**
 * Database Service for Paper Extractions
 * 
 * Handles storing and retrieving structured extractions from the database.
 * 
 * @module lib/extraction/db
 */

import { createClient } from '@/lib/supabase/server'
import type {
  PaperExtraction,
  PaperExtractionRow,
  PaperFindingRow,
  CoreExtraction,
  StatisticalFinding,
  QualitativeTheme
} from './types'

// =============================================================================
// Save Extraction
// =============================================================================

/**
 * Save a paper extraction to the database
 * 
 * @param extraction The extraction result to save
 * @returns The saved extraction row ID
 */
export async function saveExtraction(extraction: PaperExtraction): Promise<string> {
  const supabase = await createClient()
  
  // Get current version for this paper
  const { data: existing } = await supabase
    .from('paper_extractions')
    .select('extraction_version')
    .eq('paper_id', extraction.core.paperId)
    .order('extraction_version', { ascending: false })
    .limit(1)
    .single()
  
  const newVersion = (existing?.extraction_version || 0) + 1
  
  // Prepare row
  const row: Partial<PaperExtractionRow> = {
    paper_id: extraction.core.paperId,
    extraction_version: newVersion,
    paper_type: extraction.core.paperType.primaryType,
    paper_type_confidence: extraction.core.paperType.confidenceScore,
    secondary_type: extraction.core.paperType.secondaryType,
    core_extraction: extraction.core as any,
    quantitative_extension: extraction.quantitative as any,
    qualitative_extension: extraction.qualitative as any,
    theoretical_extension: extraction.theoretical as any,
    humanities_extension: extraction.humanities as any,
    review_extension: extraction.review as any,
    overall_confidence: extraction.overallConfidence,
    validation_status: extraction.validationStatus,
    validation_notes: extraction.validationNotes,
    model_used: extraction.core.extractionMetadata.modelUsed,
    extraction_time_ms: extraction.core.extractionMetadata.extractionTimeMs
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
  
  // Save normalized findings
  await saveNormalizedFindings(data.id, extraction)
  
  console.log(`💾 Saved extraction for paper ${extraction.core.paperId} (version ${newVersion})`)
  
  return data.id
}

/**
 * Save normalized findings for easier cross-document analysis
 */
async function saveNormalizedFindings(
  extractionId: string,
  extraction: PaperExtraction
): Promise<void> {
  const supabase = await createClient()
  const findings: Partial<PaperFindingRow>[] = []
  
  // Add statistical findings from quantitative extension
  if (extraction.quantitative?.statisticalFindings) {
    for (const sf of extraction.quantitative.statisticalFindings) {
      findings.push({
        paper_id: extraction.core.paperId,
        extraction_id: extractionId,
        finding_type: 'statistical',
        description: sf.description,
        raw_quote: sf.rawQuote,
        effect_size: sf.effectSize,
        effect_size_type: sf.effectSizeType,
        confidence_interval_lower: sf.confidenceInterval?.lower,
        confidence_interval_upper: sf.confidenceInterval?.upper,
        p_value: sf.pValue,
        sample_size: sf.sampleSize,
        is_significant: sf.isSignificant,
        independent_variable: sf.independentVariable,
        dependent_variable: sf.dependentVariable,
        relationship_direction: mapRelationshipDirection(sf.relationship),
        confidence: sf.confidence
      })
    }
  }
  
  // Add thematic findings from qualitative extension
  if (extraction.qualitative?.themes) {
    for (const theme of extraction.qualitative.themes) {
      findings.push({
        paper_id: extraction.core.paperId,
        extraction_id: extractionId,
        finding_type: 'thematic',
        description: theme.description,
        theme_name: theme.name,
        theme_prevalence: theme.prevalence,
        confidence: theme.confidence
      })
    }
  }
  
  // Add claims from core extraction
  for (const claim of extraction.core.mainClaims) {
    findings.push({
      paper_id: extraction.core.paperId,
      extraction_id: extractionId,
      finding_type: 'claim',
      description: claim.text,
      raw_quote: claim.evidenceQuote,
      section_source: claim.section,
      confidence: claim.confidence
    })
  }
  
  // Add meta-analytic findings from review extension
  if (extraction.review?.metaAnalyticFindings) {
    for (const mf of extraction.review.metaAnalyticFindings) {
      findings.push({
        paper_id: extraction.core.paperId,
        extraction_id: extractionId,
        finding_type: 'statistical',
        description: mf.description,
        raw_quote: mf.rawQuote,
        effect_size: mf.effectSize,
        effect_size_type: mf.effectSizeType,
        confidence_interval_lower: mf.confidenceInterval?.lower,
        confidence_interval_upper: mf.confidenceInterval?.upper,
        p_value: mf.pValue,
        sample_size: mf.sampleSize,
        is_significant: mf.isSignificant,
        independent_variable: mf.independentVariable,
        dependent_variable: mf.dependentVariable,
        relationship_direction: mapRelationshipDirection(mf.relationship),
        confidence: mf.confidence
      })
    }
  }
  
  if (findings.length > 0) {
    const { error } = await supabase
      .from('paper_findings')
      .insert(findings)
    
    if (error) {
      console.warn('Failed to save normalized findings:', error)
    } else {
      console.log(`   📊 Saved ${findings.length} normalized findings`)
    }
  }
}

// =============================================================================
// Retrieve Extractions
// =============================================================================

/**
 * Get the latest extraction for a paper
 */
export async function getExtraction(paperId: string): Promise<PaperExtraction | null> {
  const supabase = await createClient()
  
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
  
  return rowToExtraction(data)
}

/**
 * Get extractions for multiple papers
 */
export async function getExtractions(paperIds: string[]): Promise<Map<string, PaperExtraction>> {
  const supabase = await createClient()
  
  // Get latest extraction for each paper
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
  for (const row of data) {
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
 * Check if a paper has an extraction
 */
export async function hasExtraction(paperId: string): Promise<boolean> {
  const supabase = await createClient()
  
  const { count, error } = await supabase
    .from('paper_extractions')
    .select('id', { count: 'exact', head: true })
    .eq('paper_id', paperId)
  
  return !error && (count || 0) > 0
}

/**
 * Get papers needing extraction
 */
export async function getPapersNeedingExtraction(
  paperIds: string[],
  minConfidence?: number
): Promise<string[]> {
  const supabase = await createClient()
  
  // Get papers that have extractions
  const { data: existing } = await supabase
    .from('paper_extractions')
    .select('paper_id, overall_confidence')
    .in('paper_id', paperIds)
  
  const existingMap = new Map(
    (existing || []).map(e => [e.paper_id, e.overall_confidence])
  )
  
  // Filter to papers without extraction or below confidence threshold
  return paperIds.filter(id => {
    const confidence = existingMap.get(id)
    if (confidence === undefined) return true
    if (minConfidence && confidence < minConfidence) return true
    return false
  })
}

// =============================================================================
// Query Findings
// =============================================================================

/**
 * Get all statistical findings for papers
 */
export async function getStatisticalFindings(
  paperIds: string[]
): Promise<StatisticalFinding[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('paper_findings')
    .select('*')
    .in('paper_id', paperIds)
    .eq('finding_type', 'statistical')
    .order('confidence', { ascending: false })
  
  if (error || !data) {
    return []
  }
  
  return data.map(rowToStatisticalFinding)
}

/**
 * Get findings grouped by direction
 */
export async function getFindingsByDirection(
  paperIds: string[]
): Promise<{
  positive: StatisticalFinding[]
  negative: StatisticalFinding[]
  null: StatisticalFinding[]
  mixed: StatisticalFinding[]
}> {
  const findings = await getStatisticalFindings(paperIds)
  
  return {
    positive: findings.filter(f => f.relationship === 'positive'),
    negative: findings.filter(f => f.relationship === 'negative'),
    null: findings.filter(f => f.relationship === 'null'),
    mixed: findings.filter(f => f.relationship === 'curvilinear' || f.relationship === 'interaction')
  }
}

/**
 * Get themes from qualitative papers
 */
export async function getThematicFindings(
  paperIds: string[]
): Promise<Array<{ paperId: string; theme: string; description: string; prevalence?: string }>> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('paper_findings')
    .select('paper_id, theme_name, description, theme_prevalence')
    .in('paper_id', paperIds)
    .eq('finding_type', 'thematic')
  
  if (error || !data) {
    return []
  }
  
  return data.map(d => ({
    paperId: d.paper_id,
    theme: d.theme_name || '',
    description: d.description,
    prevalence: d.theme_prevalence || undefined
  }))
}

// =============================================================================
// Aggregate Analysis
// =============================================================================

/**
 * Get aggregated statistics for a set of papers
 */
export async function getAggregateStats(paperIds: string[]): Promise<{
  totalPapers: number
  totalFindings: number
  byDirection: {
    direction: string
    count: number
    avgEffectSize?: number
    totalSampleSize?: number
    significantCount: number
  }[]
  byPaperType: {
    paperType: string
    count: number
  }[]
}> {
  const supabase = await createClient()
  
  // Get findings aggregation
  const { data: findingsData } = await supabase.rpc('aggregate_findings', {
    p_paper_ids: paperIds
  })
  
  // Get paper type distribution
  const { data: typeData } = await supabase
    .from('paper_extractions')
    .select('paper_type')
    .in('paper_id', paperIds)
  
  const typeCounts = new Map<string, number>()
  for (const row of typeData || []) {
    typeCounts.set(row.paper_type, (typeCounts.get(row.paper_type) || 0) + 1)
  }
  
  return {
    totalPapers: findingsData?.total_papers || paperIds.length,
    totalFindings: findingsData?.total_findings || 0,
    byDirection: findingsData?.by_direction || [],
    byPaperType: Array.from(typeCounts.entries()).map(([paperType, count]) => ({
      paperType,
      count
    }))
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

type DbRelationshipDirection = 'positive' | 'negative' | 'null' | 'mixed'

function mapRelationshipDirection(relationship: string): DbRelationshipDirection {
  switch (relationship) {
    case 'positive':
      return 'positive'
    case 'negative':
      return 'negative'
    case 'null':
      return 'null'
    case 'curvilinear':
    case 'interaction':
    case 'mediation':
    case 'comparison':
      return 'mixed'
    default:
      return 'null'
  }
}

function rowToExtraction(row: PaperExtractionRow): PaperExtraction {
  return {
    core: row.core_extraction as CoreExtraction,
    quantitative: row.quantitative_extension || undefined,
    qualitative: row.qualitative_extension || undefined,
    theoretical: row.theoretical_extension || undefined,
    humanities: row.humanities_extension || undefined,
    review: row.review_extension || undefined,
    extensions: [
      row.quantitative_extension && 'quantitative',
      row.qualitative_extension && 'qualitative',
      row.theoretical_extension && 'theoretical',
      row.humanities_extension && 'humanities',
      row.review_extension && 'review'
    ].filter(Boolean) as any[],
    overallConfidence: row.overall_confidence,
    validationStatus: row.validation_status,
    validationNotes: row.validation_notes || undefined
  }
}

function rowToStatisticalFinding(row: PaperFindingRow): StatisticalFinding {
  return {
    id: row.id,
    description: row.description,
    relationship: (row.relationship_direction || 'null') as any,
    independentVariable: row.independent_variable || '',
    dependentVariable: row.dependent_variable || '',
    effectSize: row.effect_size || undefined,
    effectSizeType: row.effect_size_type as any,
    confidenceInterval: row.confidence_interval_lower !== null && row.confidence_interval_upper !== null
      ? {
          lower: row.confidence_interval_lower!,
          upper: row.confidence_interval_upper!,
          level: 0.95
        }
      : undefined,
    pValue: row.p_value || undefined,
    sampleSize: row.sample_size || undefined,
    isSignificant: row.is_significant || undefined,
    confidence: row.confidence,
    rawQuote: row.raw_quote || undefined
  }
}
