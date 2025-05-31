import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { sectionsRepository } from '@/lib/db/sections'
import type { Section, SectionStatus, SectionsResponse } from '@/app/(dashboard)/projects/[projectId]/types'

// Query Keys
export const sectionKeys = {
  all: ['sections'] as const,
  byProject: (projectId: string) => ['sections', projectId] as const,
  section: (projectId: string, sectionKey: string) => ['sections', projectId, sectionKey] as const,
}

// Query: Get all sections for a project
export function useSections(projectId: string) {
  return useQuery({
    queryKey: sectionKeys.byProject(projectId),
    queryFn: async (): Promise<SectionsResponse> => {
      // Only fetch existing sections - don't auto-create defaults
      const result = await sectionsRepository.getSections(projectId)
      return result
    },
    enabled: !!projectId,
  })
}

// New hook: Get sections WITH auto-creation (for when we want the old behavior)
export function useSectionsWithAutoCreate(projectId: string) {
  return useQuery({
    queryKey: ['sectionsWithAutoCreate', projectId],
    queryFn: async (): Promise<SectionsResponse> => {
      // Try repository first, fallback to server action if needed
      const result = await sectionsRepository.getSections(projectId)
      
      if (!result.success || !result.sections || result.sections.length === 0) {
        // If no sections exist, create defaults via server action
        const { getSectionsWithContent } = await import('@/app/(dashboard)/projects/[projectId]/actions')
        return await getSectionsWithContent(projectId)
      }
      
      return result
    },
    enabled: !!projectId,
  })
}

// Hook to check if project needs initial setup (no sections exist)
export function useProjectNeedsSetup(projectId: string) {
  const { data: sectionsResponse, isLoading } = useSections(projectId)
  
  return {
    needsSetup: !isLoading && sectionsResponse?.success && (!sectionsResponse.sections || sectionsResponse.sections.length === 0),
    isLoading,
    hasError: !isLoading && !sectionsResponse?.success
  }
}

// Mutation: Update section content
export function useUpdateSectionContent() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({
      projectId,
      sectionKey,
      content,
      wordCount,
    }: {
      projectId: string
      sectionKey: string
      content: string
      wordCount: number
    }) => {
      return await sectionsRepository.updateSectionContent(projectId, sectionKey, content, wordCount)
    },
    onMutate: async ({ projectId, sectionKey, content, wordCount }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: sectionKeys.byProject(projectId) })
      
      // Snapshot the previous value
      const previousSections = queryClient.getQueryData<SectionsResponse>(sectionKeys.byProject(projectId))
      
      // Optimistically update
      if (previousSections?.sections) {
        const updatedSections = previousSections.sections.map(section =>
          section.section_key === sectionKey
            ? { 
                ...section, 
                content, 
                word_count: wordCount,
                updated_at: new Date().toISOString() 
              }
            : section
        )
        
        queryClient.setQueryData<SectionsResponse>(sectionKeys.byProject(projectId), {
          ...previousSections,
          sections: updatedSections,
        })
      }
      
      return { previousSections }
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousSections) {
        queryClient.setQueryData(sectionKeys.byProject(variables.projectId), context.previousSections)
      }
    },
    onSettled: (data, error, variables) => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: sectionKeys.byProject(variables.projectId) })
    },
  })
}

// Mutation: Update section status
export function useUpdateSectionStatus() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({
      projectId,
      sectionKey,
      status,
    }: {
      projectId: string
      sectionKey: string
      status: SectionStatus
    }) => {
      return await sectionsRepository.updateSectionStatus(projectId, sectionKey, status)
    },
    onMutate: async ({ projectId, sectionKey, status }) => {
      await queryClient.cancelQueries({ queryKey: sectionKeys.byProject(projectId) })
      
      const previousSections = queryClient.getQueryData<SectionsResponse>(sectionKeys.byProject(projectId))
      
      if (previousSections?.sections) {
        const updatedSections = previousSections.sections.map(section =>
          section.section_key === sectionKey
            ? { 
                ...section, 
                status,
                updated_at: new Date().toISOString() 
              }
            : section
        )
        
        queryClient.setQueryData<SectionsResponse>(sectionKeys.byProject(projectId), {
          ...previousSections,
          sections: updatedSections,
        })
      }
      
      return { previousSections }
    },
    onError: (err, variables, context) => {
      if (context?.previousSections) {
        queryClient.setQueryData(sectionKeys.byProject(variables.projectId), context.previousSections)
      }
    },
    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({ queryKey: sectionKeys.byProject(variables.projectId) })
    },
  })
}

// Mutation: Create default sections
export function useCreateDefaultSections() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (projectId: string) => {
      return await sectionsRepository.createDefaultSections(projectId)
    },
    onSuccess: (data, projectId) => {
      // Update cache with new sections
      if (data.success && data.sections) {
        queryClient.setQueryData<SectionsResponse>(sectionKeys.byProject(projectId), data)
      }
    },
  })
}