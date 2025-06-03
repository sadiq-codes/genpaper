import { createBrowserClient } from '@supabase/ssr'
import { createClient } from '@/lib/supabase/server'
import type { 
  ResearchProject, 
  ResearchProjectVersion, 
  ProjectCitation, 
  PaperStatus,
  ResearchProjectWithLatestVersion,
  PaperWithAuthors
} from '@/types/simplified'

// Browser-side client (for client components)
export const createBrowserSupabaseClient = () => {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export async function createResearchProject(
  userId: string,
  topic: string,
  generationConfig?: Record<string, unknown>
): Promise<ResearchProject> {
  const supabase = await createClient()
  
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
    ;(dbError as any).code = error.code
    ;(dbError as any).details = error.details
    ;(dbError as any).hint = error.hint
    
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
  const supabase = await createClient()
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
  const supabase = await createClient()
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
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('research_projects')
    .select(`
      *,
      latest_version:research_project_versions(*)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
    .range(offset, offset + limit - 1)

  if (error) throw error

  // Get the latest version for each project
  const projectsWithVersions = await Promise.all(
    data.map(async (project) => {
      const { data: latestVersion } = await supabase
        .from('research_project_versions')
        .select('*')
        .eq('project_id', project.id)
        .order('version', { ascending: false })
        .limit(1)
        .single()

      return {
        ...project,
        latest_version: latestVersion,
        citation_count: await getProjectCitationCount(project.id)
      }
    })
  )

  return projectsWithVersions
}

export async function addProjectVersion(
  projectId: string,
  content: string,
  version?: number
): Promise<ResearchProjectVersion> {
  const supabase = await createClient()
  // If no version specified, get the next version number
  if (!version) {
    const { data: latestVersion } = await supabase
      .from('research_project_versions')
      .select('version')
      .eq('project_id', projectId)
      .order('version', { ascending: false })
      .limit(1)
      .single()

    version = (latestVersion?.version || 0) + 1
  }

  const { data, error } = await supabase
    .from('research_project_versions')
    .insert({
      project_id: projectId,
      version,
      content
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getProjectVersions(
  projectId: string,
  limit = 10
): Promise<ResearchProjectVersion[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('research_project_versions')
    .select('*')
    .eq('project_id', projectId)
    .order('version', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data || []
}

export async function getLatestProjectVersion(
  projectId: string
): Promise<ResearchProjectVersion | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('research_project_versions')
    .select('*')
    .eq('project_id', projectId)
    .order('version', { ascending: false })
    .limit(1)
    .single()

  if (error && error.code !== 'PGRST116') throw error
  return data
}

export async function addProjectCitation(
  projectId: string,
  version: number,
  paperId: string,
  citationText: string,
  positionStart?: number,
  positionEnd?: number,
  pageRange?: string,
  blockId?: string
): Promise<ProjectCitation> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('project_citations')
    .insert({
      project_id: projectId,
      version,
      paper_id: paperId,
      citation_text: citationText,
      position_start: positionStart,
      position_end: positionEnd,
      page_range: pageRange,
      block_id: blockId
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
  const supabase = await createClient()
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
  const supabase = await createClient()
  
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
      ?.sort((a: any, b: any) => (a.ordinal || 0) - (b.ordinal || 0))
      ?.map((pa: any) => pa.author.name) || []
  }))
}

export async function getProjectCitationCount(projectId: string): Promise<number> {
  const supabase = await createClient()
  const { count, error } = await supabase
    .from('project_citations')
    .select('id', { count: 'exact' })
    .eq('project_id', projectId)

  if (error) throw error
  return count || 0
}

export async function deleteResearchProject(projectId: string): Promise<void> {
  const supabase = await createClient()
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

  async getLatestVersion(projectId: string) {
    const supabase = createBrowserSupabaseClient()
    
    const { data, error } = await supabase
      .from('research_project_versions')
      .select('*')
      .eq('project_id', projectId)
      .order('version', { ascending: false })
      .limit(1)
      .single()

    if (error && error.code !== 'PGRST116') throw error
    return data
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