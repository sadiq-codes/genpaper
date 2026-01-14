/**
 * Citation Settings Service
 * 
 * Server-side service for managing citation style preferences
 * at user and project levels.
 */

import 'server-only'
import { getSB } from '@/lib/supabase/server'
import type { CitationStyle } from './unified-service'

// ============================================================================
// Get Citation Style
// ============================================================================

/**
 * Get the effective citation style for a project
 * Priority: Project setting > User default > 'apa'
 */
export async function getProjectCitationStyle(
  projectId: string,
  userId: string
): Promise<CitationStyle> {
  const supabase = await getSB()
  
  // Use the database function for efficient lookup
  const { data, error } = await supabase
    .rpc('get_project_citation_style', {
      p_project_id: projectId,
      p_user_id: userId
    })
  
  if (error) {
    console.error('Error getting citation style:', error)
    return 'apa' // Default fallback
  }
  
  return (data as CitationStyle) || 'apa'
}

/**
 * Get user's default citation style
 */
export async function getUserDefaultCitationStyle(
  userId: string
): Promise<CitationStyle> {
  const supabase = await getSB()
  
  const { data, error } = await supabase
    .from('user_preferences')
    .select('citation_style')
    .eq('user_id', userId)
    .single()
  
  if (error || !data) {
    return 'apa' // Default fallback
  }
  
  return (data.citation_style as CitationStyle) || 'apa'
}

// ============================================================================
// Update Citation Style
// ============================================================================

/**
 * Update user's default citation style
 */
export async function updateUserCitationStyle(
  userId: string,
  style: CitationStyle
): Promise<{ success: boolean; error?: string }> {
  const supabase = await getSB()
  
  const { error } = await supabase
    .rpc('upsert_user_preferences', {
      p_user_id: userId,
      p_citation_style: style
    })
  
  if (error) {
    console.error('Error updating user citation style:', error)
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Update project-specific citation style
 * Pass null to use user's default
 */
export async function updateProjectCitationStyle(
  projectId: string,
  userId: string,
  style: CitationStyle | null
): Promise<{ success: boolean; error?: string }> {
  const supabase = await getSB()
  
  const { error } = await supabase
    .from('research_projects')
    .update({ citation_style: style })
    .eq('id', projectId)
    .eq('user_id', userId)
  
  if (error) {
    console.error('Error updating project citation style:', error)
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

// ============================================================================
// Get Full Preferences
// ============================================================================

export interface UserPreferences {
  citationStyle: CitationStyle
}

/**
 * Get all user preferences
 */
export async function getUserPreferences(
  userId: string
): Promise<UserPreferences> {
  const supabase = await getSB()
  
  const { data, error } = await supabase
    .from('user_preferences')
    .select('citation_style')
    .eq('user_id', userId)
    .single()
  
  if (error || !data) {
    // Return defaults
    return {
      citationStyle: 'apa'
    }
  }
  
  return {
    citationStyle: (data.citation_style as CitationStyle) || 'apa'
  }
}

// ============================================================================
// Validate Paper in Project
// ============================================================================

/**
 * Check if a paper ID exists in a project's library
 */
export async function validatePaperInProject(
  paperId: string,
  projectId: string
): Promise<boolean> {
  const supabase = await getSB()
  
  // Papers are linked to projects via project_citations table
  const { data, error } = await supabase
    .from('project_citations')
    .select('paper_id')
    .eq('project_id', projectId)
    .eq('paper_id', paperId)
    .single()
  
  if (error || !data) {
    return false
  }
  
  return true
}

/**
 * Validate multiple paper IDs at once
 */
export async function validatePapersInProject(
  paperIds: string[],
  projectId: string
): Promise<{ valid: string[]; invalid: string[] }> {
  if (paperIds.length === 0) {
    return { valid: [], invalid: [] }
  }
  
  const supabase = await getSB()
  
  // Papers are linked to projects via project_citations table
  const { data, error } = await supabase
    .from('project_citations')
    .select('paper_id')
    .eq('project_id', projectId)
    .in('paper_id', paperIds)
  
  if (error) {
    console.error('Error validating papers:', error)
    return { valid: [], invalid: paperIds }
  }
  
  const validIds = new Set((data || []).map(d => d.paper_id))
  
  return {
    valid: paperIds.filter(id => validIds.has(id)),
    invalid: paperIds.filter(id => !validIds.has(id))
  }
}
