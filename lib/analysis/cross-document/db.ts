/**
 * Database Service for Cross-Document Analysis
 * 
 * Handles storing and retrieving analysis results with caching.
 * 
 * @module lib/analysis/cross-document/db
 */

import { createClient } from '@/lib/supabase/server'
import type {
  AnalysisResult,
  ProjectAnalysisRow
} from './types'

// =============================================================================
// Save Analysis
// =============================================================================

/**
 * Save an analysis result to the database
 */
export async function saveAnalysis(analysis: AnalysisResult): Promise<string> {
  const supabase = await createClient()
  
  const row = {
    project_id: analysis.projectId,
    patterns: analysis.patterns,
    contradictions: analysis.contradictions,
    gaps: analysis.gaps,
    summary: analysis.summary,
    key_insights: analysis.keyInsights,
    findings_hash: analysis.findingsHash,
    analyzed_papers: analysis.analyzedPapers,
    total_findings: analysis.totalFindings,
    analyzed_at: analysis.analyzedAt.toISOString(),
    analysis_time_ms: analysis.analysisTimeMs,
    model_used: analysis.modelUsed
  }
  
  const { data, error } = await supabase
    .from('project_analyses')
    .insert(row)
    .select('id')
    .single()
  
  if (error) {
    console.error('Failed to save analysis:', error)
    throw new Error(`Failed to save analysis: ${error.message}`)
  }
  
  console.log(`💾 Saved analysis for project ${analysis.projectId}`)
  
  return data.id
}

// =============================================================================
// Retrieve Analysis
// =============================================================================

/**
 * Get the latest analysis for a project
 */
export async function getAnalysis(projectId: string): Promise<AnalysisResult | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('project_analyses')
    .select('*')
    .eq('project_id', projectId)
    .order('analyzed_at', { ascending: false })
    .limit(1)
    .single()
  
  if (error || !data) {
    return null
  }
  
  return rowToAnalysis(data as ProjectAnalysisRow)
}

/**
 * Get analysis if it's still valid (findings haven't changed)
 */
export async function getCachedAnalysis(
  projectId: string, 
  currentFindingsHash: string
): Promise<AnalysisResult | null> {
  const analysis = await getAnalysis(projectId)
  
  if (!analysis) {
    return null
  }
  
  // Check if findings have changed
  if (analysis.findingsHash !== currentFindingsHash) {
    console.log(`📊 Analysis cache invalid for project ${projectId} (findings changed)`)
    return null
  }
  
  console.log(`📊 Using cached analysis for project ${projectId}`)
  return analysis
}

/**
 * Check if project has a valid cached analysis
 */
export async function hasValidAnalysis(
  projectId: string,
  currentFindingsHash: string
): Promise<boolean> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('project_analyses')
    .select('findings_hash')
    .eq('project_id', projectId)
    .order('analyzed_at', { ascending: false })
    .limit(1)
    .single()
  
  if (error || !data) {
    return false
  }
  
  return data.findings_hash === currentFindingsHash
}

/**
 * Delete old analyses for a project (keep only latest)
 */
export async function cleanupOldAnalyses(projectId: string): Promise<void> {
  const supabase = await createClient()
  
  // Get the latest analysis ID
  const { data: latest } = await supabase
    .from('project_analyses')
    .select('id')
    .eq('project_id', projectId)
    .order('analyzed_at', { ascending: false })
    .limit(1)
    .single()
  
  if (!latest) return
  
  // Delete all except the latest
  await supabase
    .from('project_analyses')
    .delete()
    .eq('project_id', projectId)
    .neq('id', latest.id)
}

// =============================================================================
// Helpers
// =============================================================================

function rowToAnalysis(row: ProjectAnalysisRow): AnalysisResult {
  return {
    id: row.id,
    projectId: row.project_id,
    analyzedPapers: row.analyzed_papers,
    totalFindings: row.total_findings,
    patterns: row.patterns,
    contradictions: row.contradictions,
    gaps: row.gaps,
    summary: row.summary,
    keyInsights: row.key_insights,
    analyzedAt: new Date(row.analyzed_at),
    analysisTimeMs: row.analysis_time_ms,
    modelUsed: row.model_used,
    findingsHash: row.findings_hash
  }
}
