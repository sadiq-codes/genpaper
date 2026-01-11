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
 * Update project with generated content and mark as complete
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
  
  // Save citations if provided
  if (citations) {
    // Deduplicate citations by paper_id to avoid "ON CONFLICT DO UPDATE cannot affect row a second time" error
    // When the same paper is cited multiple times, we only need one entry per paper
    const seenPaperIds = new Set<string>()
    const citationInserts: Array<{
      project_id: string
      paper_id: string
      citation_number: number
      quote: string
    }> = []
    
    for (const [key, citation] of Object.entries(citations)) {
      // Skip if we've already seen this paper
      if (seenPaperIds.has(citation.paperId)) {
        continue
      }
      seenPaperIds.add(citation.paperId)
      
      citationInserts.push({
        project_id: projectId,
        paper_id: citation.paperId,
        citation_number: parseInt(key.replace('citation-', '')) + 1,
        quote: citation.citationText
      })
    }
    
    if (citationInserts.length > 0) {
      // Use upsert to handle cases where citation already exists
      // onConflict specifies the unique constraint columns
      const { error: citationError } = await supabase
        .from('project_citations')
        .upsert(citationInserts, {
          onConflict: 'project_id,paper_id',
          ignoreDuplicates: false // Update existing records
        })
      
      if (citationError) {
        console.warn('⚠️ Failed to save citations:', citationError)
        // Don't throw - content was saved successfully
      } else {
        console.log(`✅ Saved ${citationInserts.length} citations (deduplicated from ${Object.keys(citations).length} total)`)
      }
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
  const { data, error } = await supabase
    .from('research_projects')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
    .range(offset, offset + limit - 1)

  if (error) throw error

  // Get citation counts for each project
  const projectsWithCitations = await Promise.all(
    data.map(async (project) => {
      return {
        ...project,
        latest_version: null, // No longer using versions
        citation_count: await getProjectCitationCount(project.id)
      }
    })
  )

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
