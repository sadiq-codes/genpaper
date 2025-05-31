import { supabase } from '@/lib/supabase/client'

export type ProjectStatus = 'ai-drafting' | 'literature-ready' | 'citations-needed' | 'draft' | 'review' | 'completed'

export interface Project {
  id: string
  title: string
  description?: string
  status: ProjectStatus
  progress: number
  word_count: number
  citation_count: number
  tags: string[]
  starred: boolean
  due_date?: string
  created_at: string
  last_modified: string
  user_id: string
  // UI helper properties
  wordCount?: number // Alias for word_count
  citations?: number // Alias for citation_count
  lastModified?: string // Alias for last_modified
  aiTasks?: number // Count of active AI tasks
  collaborators?: number // Count of collaborators
}

export interface ProjectActivity {
  id: string
  project_id: string
  activity_type: string
  description: string
  created_at: string
  // Computed properties
  title?: string
  lastModified?: string
  projects?: { title: string }[]
}

export interface AITask {
  id: string
  project_id: string
  task_type: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  result?: string
  created_at: string
  completed_at?: string
}

// Fetch projects with full data
export async function fetchProjects(userId: string): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select(`
      id,
      title,
      description,
      status,
      progress,
      word_count,
      citation_count,
      tags,
      starred,
      due_date,
      created_at,
      last_modified,
      user_id
    `)
    .eq('user_id', userId)
    .order('last_modified', { ascending: false })

  if (error) throw error
  
  // Transform data to include UI helper properties
  const projects = (data || []).map(project => ({
    ...project,
    // Add UI helper properties
    wordCount: project.word_count,
    citations: project.citation_count,
    lastModified: new Date(project.last_modified).toLocaleDateString(),
    aiTasks: 0, // TODO: Get actual AI task count
    collaborators: 0, // TODO: Get actual collaborator count
  }))
  
  return projects
}

// Update project status
export async function updateProjectStatus(projectId: string, status: ProjectStatus) {
  const { error } = await supabase
    .from('projects')
    .update({ 
      status,
      last_modified: new Date().toISOString()
    })
    .eq('id', projectId)

  if (error) throw error
}

// Toggle project star
export async function toggleProjectStar(projectId: string, starred: boolean) {
  const { error } = await supabase
    .from('projects')
    .update({ 
      starred,
      last_modified: new Date().toISOString()
    })
    .eq('id', projectId)

  if (error) throw error
}

// Update project progress
export async function updateProjectProgress(projectId: string, progress: number) {
  const { error } = await supabase
    .from('projects')
    .update({ 
      progress,
      last_modified: new Date().toISOString()
    })
    .eq('id', projectId)

  if (error) throw error
}

// Add project activity
export async function addProjectActivity(
  projectId: string, 
  userId: string, 
  activityType: string, 
  description: string
) {
  const { error } = await supabase
    .from('project_activities')
    .insert({
      project_id: projectId,
      user_id: userId,
      activity_type: activityType,
      description
    })

  if (error) throw error
}

// Fetch recent activities
export async function fetchRecentActivities(userId: string, limit = 5): Promise<ProjectActivity[]> {
  const { data, error } = await supabase
    .from('project_activities')
    .select(`
      id,
      project_id,
      activity_type,
      description,
      created_at,
      projects(title)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('Error fetching activities:', error)
    return []
  }

  // Transform data to include computed properties
  const activities = (data || []).map((activity: { 
    id: string;
    project_id: string;
    activity_type: string;
    description: string;
    created_at: string;
    projects: { title: string }[];
  }) => ({
    ...activity,
    title: activity.activity_type,
    lastModified: new Date(activity.created_at).toLocaleDateString(),
  }))

  return activities
}

// Fetch all AI tasks for a user (not just one project)
export async function fetchAITasks(userId: string): Promise<AITask[]> {
  const { data, error } = await supabase
    .from('ai_tasks')
    .select(`
      *,
      projects!inner(user_id)
    `)
    .eq('projects.user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching AI tasks:', error)
    return []
  }
  
  return data || []
}

// Create AI task
export async function createAITask(
  projectId: string, 
  taskType: string
): Promise<string> {
  const { data, error } = await supabase
    .from('ai_tasks')
    .insert({
      project_id: projectId,
      task_type: taskType,
      status: 'pending'
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

// Simulate AI task for testing
export async function simulateAITask(projectId: string, taskType: string = 'content_generation') {
  try {
    const taskId = await createAITask(projectId, taskType)
    
    // Add activity for AI task
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await addProjectActivity(
        projectId,
        user.id,
        'ai_task_started',
        `Started AI ${taskType.replace('_', ' ')}`
      )
    }
    
    return taskId
  } catch (error) {
    console.error('Error creating AI task:', error)
    throw error
  }
}

// Export project data
export async function exportProject(projectId: string) {
  // This would generate and download project data
  // Implementation depends on your export format (PDF, Word, etc.)
  console.log('Exporting project:', projectId)
}

// Share project
export async function shareProject(projectId: string, email: string) {
  // This would send sharing invitation
  // Implementation depends on your sharing mechanism
  console.log('Sharing project:', projectId, 'with:', email)
}

// Get project statistics
export async function getProjectStats(userId: string) {
  const { data: projects } = await supabase
    .from('projects')
    .select('status')
    .eq('user_id', userId)

  const stats = {
    total: projects?.length || 0,
    aiDrafting: projects?.filter(p => p.status === 'ai-drafting').length || 0,
    completed: projects?.filter(p => p.status === 'completed').length || 0,
    citationsNeeded: projects?.filter(p => p.status === 'citations-needed').length || 0
  }

  return stats
} 