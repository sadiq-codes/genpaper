import { getSB } from '@/lib/supabase/server'
import { createClient as createBrowserSupabaseClient } from '@/lib/supabase/client'
import type { 
  ResearchProject, 
  ProjectCitation, 
  PaperStatus,
  ResearchProjectWithLatestVersion,
  PaperWithAuthors
} from '@/types/simplified'

// Browser-side client now imported from centralized location

export async function createResearchProject(
  userId: string,
  topic: string,
  generationConfig?: Record<string, unknown>
): Promise<ResearchProject> {
  const supabase = await getSB()
  
  console.log('📝 Creating research project for user:', userId)
  console.log('📝 Topic:', topic)
  console.log('📝 Config:', generationConfig)
  
  // Ensure profile exists before creating project
  await ensureProfileExists(userId)
  
  // Extract paper_type from generation config if present
  const paperType = (generationConfig?.paper_settings as Record<string, unknown>)?.paperType as string | undefined
  
  // Validate paperType was successfully extracted
  if (!paperType) {
    console.warn('⚠️ paperType extraction failed! Config structure:', JSON.stringify(generationConfig, null, 2))
    console.warn('⚠️ Expected: generationConfig.paper_settings.paperType')
    console.warn('⚠️ Falling back to literatureReview - this may be incorrect!')
  }
  
  console.log('📝 Extracted paperType from config:', paperType || '(MISSING - using literatureReview fallback)')
  
  // Extract original research fields if present
  const originalResearch = generationConfig?.original_research as Record<string, unknown> | undefined
  
  const { data, error } = await supabase
    .from('research_projects')
    .insert({
      user_id: userId,
      topic,
      generation_config: generationConfig,
      status: 'generating',
      // Store paper_type directly in the column for easy access
      paper_type: paperType || 'literatureReview',
      // Store original research fields directly
      has_original_research: originalResearch?.has_original_research || false,
      research_question: originalResearch?.research_question as string | undefined,
      key_findings: originalResearch?.key_findings as string | undefined,
    })
    .select()
    .single()

  if (error) {
    console.error('❌ createResearchProject error details:', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint
    })
    
    // Create a proper Error object that will serialize correctly
    const dbError = new Error(`Database error: ${error.message}`)
    dbError.name = 'DatabaseError'
    // Extend error object with additional properties
    Object.assign(dbError, {
      code: error.code,
      details: error.details,
      hint: error.hint
    })
    
    throw dbError
  }
  
  console.log('✅ Research project created successfully:', data.id)
  return data
}

/**
 * Extract citation paper IDs from content
 * Supports both [@uuid] (Pandoc) and [CITE: uuid] (legacy) formats
 */
function extractCitationPaperIds(content: string): string[] {
  const paperIds = new Set<string>()
  
  // Pandoc format: [@uuid]
  const pandocPattern = /\[@([a-f0-9-]{36})\]/gi
  for (const match of content.matchAll(pandocPattern)) {
    paperIds.add(match[1])
  }
  
  // Legacy format: [CITE: uuid]
  const legacyPattern = /\[CITE:\s*([a-f0-9-]{36})\]/gi
  for (const match of content.matchAll(legacyPattern)) {
    paperIds.add(match[1])
  }
  
  return Array.from(paperIds)
}

/**
 * Update a project's content and automatically create citation records
 * 
 * This function:
 * 1. Saves the content to research_projects
 * 2. Extracts [CITE: uuid] markers from content
 * 3. Validates paper IDs exist in papers table
 * 4. Creates/updates project_citations records
 * 
 * @param projectId - Project to update
 * @param content - Markdown content with [CITE: uuid] markers
 * @param citations - Optional explicit citations (legacy support)
 */
export async function updateProjectContent(
  projectId: string,
  content: string,
  citations?: Record<string, { paperId: string; citationText: string }>
): Promise<void> {
  const supabase = await getSB()
  
  console.log(`💾 Saving generated content to project ${projectId} (${content.length} chars)`)
  
  const { error } = await supabase
    .from('research_projects')
    .update({
      content: content,
      status: 'complete',
      completed_at: new Date().toISOString()
    })
    .eq('id', projectId)

  if (error) {
    console.error('❌ Failed to update project content:', error)
    throw new Error(`Failed to save project content: ${error.message}`)
  }
  
  // Collect paper IDs from both explicit citations and content extraction
  const paperIdsFromContent = extractCitationPaperIds(content)
  const paperIdsFromCitations = citations 
    ? Object.values(citations).map(c => c.paperId) 
    : []
  
  // Merge and deduplicate
  const allPaperIds = [...new Set([...paperIdsFromContent, ...paperIdsFromCitations])]
  
  console.log(`📚 Found ${allPaperIds.length} unique paper IDs (${paperIdsFromContent.length} from content, ${paperIdsFromCitations.length} from citations param)`)
  
  if (allPaperIds.length === 0) {
    console.log('✅ Project content saved successfully (no citations)')
    return
  }
  
  // Validate paper IDs exist in the papers table
  const { data: validPapers, error: validationError } = await supabase
    .from('papers')
    .select('id')
    .in('id', allPaperIds)
  
  if (validationError) {
    console.warn('⚠️ Failed to validate paper IDs:', validationError)
  }
  
  const validPaperIds = new Set(validPapers?.map(p => p.id) || [])
  const invalidPaperIds = allPaperIds.filter(id => !validPaperIds.has(id))
  
  if (invalidPaperIds.length > 0) {
    console.warn(`⚠️ ${invalidPaperIds.length} paper IDs not found in database:`, invalidPaperIds.slice(0, 5))
  }
  
  // Build citation inserts for valid papers only
  const citationInserts: Array<{
    project_id: string
    paper_id: string
    first_seen_order: number
  }> = []
  
  let order = 1
  for (const paperId of allPaperIds) {
    if (validPaperIds.has(paperId)) {
      citationInserts.push({
        project_id: projectId,
        paper_id: paperId,
        first_seen_order: order++
      })
    }
  }
  
  if (citationInserts.length > 0) {
    // Use upsert to handle cases where citation already exists
    const { error: citationError } = await supabase
      .from('project_citations')
      .upsert(citationInserts, {
        onConflict: 'project_id,paper_id',
        ignoreDuplicates: false
      })
    
    if (citationError) {
      console.warn('⚠️ Failed to save citations:', citationError)
    } else {
      console.log(`✅ Saved ${citationInserts.length} citations (${invalidPaperIds.length} invalid IDs skipped)`)
    }
  }
  
  console.log('✅ Project content saved successfully')
}

// Helper function to ensure profile exists
// Note: Uses getUser() which returns the current authenticated user's info
// This is safe because we only call this for the currently authenticated user
async function ensureProfileExists(userId: string): Promise<void> {
  const supabase = await getSB()
  
  // Check if profile exists
  const { data: existingProfile, error: checkError } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .single()
  
  if (checkError && checkError.code !== 'PGRST116') {
    console.error('Error checking profile:', checkError)
    return
  }
  
  if (!existingProfile) {
    console.log('Creating missing profile for user:', userId)
    
    // Get current user info from auth session (not admin API)
    // This only works because we're creating a profile for the current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    
    // Verify we're creating a profile for the current user only
    if (userError || !user || user.id !== userId) {
      console.warn('Cannot get user info - creating minimal profile')
      // Create minimal profile
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          id: userId,
          email: '',
          full_name: '',
          created_at: new Date().toISOString()
        })
      
      if (profileError && profileError.code !== '23505') { // Ignore duplicate key errors
        console.error('Error creating minimal profile:', profileError)
      }
      return
    }
    
    // Create profile with user info from current session
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: userId,
        email: user.email || '',
        full_name: user.user_metadata?.full_name || user.user_metadata?.name || '',
        created_at: new Date().toISOString()
      })
    
    if (profileError && profileError.code !== '23505') { // Ignore duplicate key errors
      console.error('Error creating profile:', profileError)
    } else {
      console.log('Created profile for user:', userId)
    }
  }
}

export async function updateResearchProjectStatus(
  projectId: string,
  status: PaperStatus,
  completedAt?: string
): Promise<void> {
  const supabase = await getSB()
  const updateData: { status: PaperStatus; completed_at?: string } = { status }
  if (completedAt) updateData.completed_at = completedAt

  const { error } = await supabase
    .from('research_projects')
    .update(updateData)
    .eq('id', projectId)

  if (error) throw error
}

export async function getResearchProject(
  projectId: string,
  userId?: string
): Promise<ResearchProject | null> {
  const supabase = await getSB()
  let query = supabase
    .from('research_projects')
    .select('*')
    .eq('id', projectId)

  if (userId) {
    query = query.eq('user_id', userId)
  }

  const { data, error } = await query.single()

  if (error && error.code !== 'PGRST116') throw error
  return data
}

export async function getUserResearchProjects(
  userId: string,
  limit = 20,
  offset = 0
): Promise<ResearchProjectWithLatestVersion[]> {
  const supabase = await getSB()
  
  // Fetch projects
  const { data, error } = await supabase
    .from('research_projects')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) throw error
  if (!data || data.length === 0) return []

  // Fetch citation counts for all projects in ONE query (fixes N+1 problem)
  // Group by project_id and count
  const projectIds = data.map(p => p.id)
  const { data: citationCounts, error: countError } = await supabase
    .from('project_citations')
    .select('project_id')
    .in('project_id', projectIds)

  if (countError) {
    console.error('Error fetching citation counts:', countError)
  }

  // Build a map of project_id -> count
  const countMap = new Map<string, number>()
  for (const row of citationCounts || []) {
    const current = countMap.get(row.project_id) || 0
    countMap.set(row.project_id, current + 1)
  }

  // Map projects with their citation counts
  const projectsWithCitations = data.map((project) => ({
    ...project,
    latest_version: null,
    citation_count: countMap.get(project.id) || 0
  }))

  return projectsWithCitations
}

// Note: updateProjectContent was unused and has been removed to reduce dead code.

export async function getProjectContent(
  projectId: string
): Promise<string | null> {
  const supabase = await getSB()
  const { data, error } = await supabase
    .from('research_projects')
    .select('content')
    .eq('id', projectId)
    .single()

  if (error && error.code !== 'PGRST116') throw error
  return data?.content || null
}

export async function getProjectWithContent(
  projectId: string
): Promise<ResearchProject | null> {
  const supabase = await getSB()
  const { data, error } = await supabase
    .from('research_projects')
    .select('*')
    .eq('id', projectId)
    .single()

  if (error && error.code !== 'PGRST116') throw error
  return data
}

export async function addProjectCitation(
  projectId: string,
  paperId: string,
  citationText: string,
  positionStart?: number,
  positionEnd?: number,
  pageRange?: string
): Promise<ProjectCitation> {
  const supabase = await getSB()
  const { data, error } = await supabase
    .from('project_citations')
    .insert({
      project_id: projectId,
      version: 1, // Default version since we're not using versioning anymore
      paper_id: paperId,
      citation_text: citationText,
      position_start: positionStart,
      position_end: positionEnd,
      page_range: pageRange
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getProjectCitations(
  projectId: string,
  version?: number
): Promise<ProjectCitation[]> {
  const supabase = await getSB()
  let query = supabase
    .from('project_citations')
    .select(`
      *,
      paper:papers(
        *,
        csl_json,
        authors
      )
    `)
    .eq('project_id', projectId)

  if (version) {
    query = query.eq('version', version)
  }

  query = query.order('position_start', { ascending: true })

  const { data, error } = await query

  if (error) throw error
  return data || []
}

export async function getProjectPapersWithCSL(
  projectId: string,
  version?: number
): Promise<PaperWithAuthors[]> {
  const supabase = await getSB()
  
  // Get unique paper IDs from citations
  let citationQuery = supabase
    .from('project_citations')
    .select('paper_id')
    .eq('project_id', projectId)
    
  if (version) {
    citationQuery = citationQuery.eq('version', version)
  }
  
  const { data: citationData, error: citationError } = await citationQuery
  
  if (citationError) throw citationError
  if (!citationData || citationData.length === 0) return []
  
  const paperIds = [...new Set(citationData.map(c => c.paper_id))]
  
  // Get papers with CSL data
  const { data: papers, error: papersError } = await supabase
    .from('papers')
    .select(`
      *,
      csl_json,
      authors
    `)
    .in('id', paperIds)
    
  if (papersError) throw papersError
  
  // Transform to PaperWithAuthors format
  return (papers || []).map(paper => ({
    ...paper,
    authors: Array.isArray(paper.authors) 
      ? paper.authors.map((name: string) => ({ id: '', name }))
      : [],
    author_names: Array.isArray(paper.authors) ? paper.authors : []
  }))
}

export async function getProjectCitationCount(projectId: string): Promise<number> {
  const supabase = await getSB()
  const { count, error } = await supabase
    .from('project_citations')
    .select('id', { count: 'exact' })
    .eq('project_id', projectId)

  if (error) throw error
  return count || 0
}

export async function deleteResearchProject(projectId: string): Promise<void> {
  const supabase = await getSB()
  const { error } = await supabase
    .from('research_projects')
    .delete()
    .eq('id', projectId)

  if (error) throw error
}

// Browser client functions for client components
export const clientResearchOperations = {
  async getUserProjects(limit = 20, offset = 0) {
    const supabase = createBrowserSupabaseClient()
    
    const { data, error } = await supabase
      .from('research_projects')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
      .range(offset, offset + limit - 1)

    if (error) throw error
    return data || []
  },

  async getProject(projectId: string) {
    const supabase = createBrowserSupabaseClient()
    
    const { data, error } = await supabase
      .from('research_projects')
      .select('*')
      .eq('id', projectId)
      .single()

    if (error && error.code !== 'PGRST116') throw error
    return data
  },

  async getProjectContent(projectId: string) {
    const supabase = createBrowserSupabaseClient()
    
    const { data, error } = await supabase
      .from('research_projects')
      .select('content')
      .eq('id', projectId)
      .single()

    if (error && error.code !== 'PGRST116') throw error
    return data?.content || null
  },

  async getCitations(projectId: string, version?: number) {
    const supabase = createBrowserSupabaseClient()
    
    let query = supabase
      .from('project_citations')
      .select(`
        *,
        paper:papers(
          *,
          authors
        )
      `)
      .eq('project_id', projectId)

    if (version) {
      query = query.eq('version', version)
    }

    const { data, error } = await query.order('position_start', { ascending: true })

    if (error) throw error
    return data || []
  }
} 
