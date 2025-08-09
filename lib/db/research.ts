import { getSB } from '@/lib/supabase/server'
import { createClient as createBrowserSupabaseClient } from '@/lib/supabase/client'
import type { 
  ResearchProject, 
  ResearchProjectVersion, 
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
  
  const { data, error } = await supabase
    .from('research_projects')
    .insert({
      user_id: userId,
      topic,
      generation_config: generationConfig,
      status: 'generating'
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

export async function updateProjectContent(
  projectId: string,
  content: string
): Promise<ResearchProject> {
  const supabase = await getSB()
  
  const { data, error } = await supabase
    .from('research_projects')
    .update({ content })
    .eq('id', projectId)
    .select()
    .single()

  if (error) throw error
  return data
}

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
        authors:paper_authors(
          ordinal,
          author:authors(*)
        )
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
      authors:paper_authors(
        ordinal,
        author:authors(*)
      )
    `)
    .in('id', paperIds)
    
  if (papersError) throw papersError
  
  // Transform to PaperWithAuthors format
  return (papers || []).map(paper => ({
    ...paper,
    author_names: paper.authors
      ?.sort((a: { ordinal?: number }, b: { ordinal?: number }) => (a.ordinal || 0) - (b.ordinal || 0))
      ?.map((pa: { author: { name: string } }) => pa.author.name) || []
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
          authors:paper_authors(
            ordinal,
            author:authors(*)
          )
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