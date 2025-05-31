import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Project, BasicProject } from '@/app/(dashboard)/projects/[projectId]/types'

// Query Keys
export const projectKeys = {
  all: ['projects'] as const,
  byId: (projectId: string) => ['projects', projectId] as const,
  details: (projectId: string) => ['projects', projectId, 'details'] as const,
}

// Query: Get basic project data (already provided by server component)
export function useProject(projectId: string, initialData?: BasicProject) {
  return useQuery({
    queryKey: projectKeys.byId(projectId),
    queryFn: async (): Promise<BasicProject> => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        throw new Error('User not authenticated')
      }

      const { data, error } = await supabase
        .from('projects')
        .select('id,title,status,created_at')
        .eq('id', projectId)
        .eq('user_id', user.id)
        .single()

      if (error) {
        throw new Error(`Failed to fetch project: ${error.message}`)
      }

      return data
    },
    enabled: !!projectId,
    initialData,
    staleTime: 1000 * 60 * 10, // 10 minutes for basic project data
  })
}

// Query: Get detailed project data (content, outline, etc.)
export function useProjectDetails(projectId: string) {
  return useQuery({
    queryKey: projectKeys.details(projectId),
    queryFn: async (): Promise<Partial<Project>> => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        throw new Error('User not authenticated')
      }

      const { data, error } = await supabase
        .from('projects')
        .select('content,outline,word_count,citation_count,last_modified')
        .eq('id', projectId)
        .eq('user_id', user.id)
        .single()

      if (error) {
        throw new Error(`Failed to fetch project details: ${error.message}`)
      }

      return data
    },
    enabled: !!projectId,
    staleTime: 1000 * 60 * 5, // 5 minutes for detailed data
  })
} 