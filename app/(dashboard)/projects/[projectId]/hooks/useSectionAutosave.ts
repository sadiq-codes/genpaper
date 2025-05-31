import { useCallback, useRef } from 'react'
import { z } from 'zod'
import { useUpdateSectionContent } from '@/lib/tanstack-query/hooks/useSections'

// Zod schema for section auto-save validation
const sectionAutosaveSchema = z.object({
  projectId: z.string().uuid('Project ID must be a valid UUID'),
  sectionKey: z.string().min(1, 'Section key is required'),
  content: z.string(),
  wordCount: z.number().min(0, 'Word count must be non-negative'),
})

type SectionAutosaveData = z.infer<typeof sectionAutosaveSchema>

interface UseSectionAutosaveOptions {
  debounceMs?: number
}

export function useSectionAutosave(options: UseSectionAutosaveOptions = {}) {
  const { debounceMs = 800 } = options
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isValidatingRef = useRef(false)
  
  // Use TanStack Query mutation
  const updateSectionMutation = useUpdateSectionContent()

  const saveSection = useCallback(async (data: SectionAutosaveData) => {
    isValidatingRef.current = true
    
    try {
      // Validate input data with Zod
      const validatedData = sectionAutosaveSchema.parse(data)
      
      // Use TanStack Query mutation
      const result = await updateSectionMutation.mutateAsync({
        projectId: validatedData.projectId,
        sectionKey: validatedData.sectionKey,
        content: validatedData.content,
        wordCount: validatedData.wordCount,
      })
      
      if (!result.success) {
        console.error('Error saving section content:', result.error)
        return { success: false, error: result.error }
      }
      
      return { success: true }
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error('Validation error:', error.errors)
        return { success: false, error: 'Invalid data provided' }
      }
      console.error('Error in saveSection:', error)
      return { success: false, error: 'Failed to save section' }
    } finally {
      isValidatingRef.current = false
    }
  }, [updateSectionMutation])

  // Debounced save function
  const debouncedSave = useCallback((data: SectionAutosaveData) => {
    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    
    // Set new timeout for debounced save
    timeoutRef.current = setTimeout(() => {
      saveSection(data)
    }, debounceMs)
  }, [saveSection, debounceMs])

  // Immediate save function (for onBlur)
  const immediateSave = useCallback(async (data: SectionAutosaveData) => {
    // Cancel any pending debounced save
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    
    // Save immediately
    return await saveSection(data)
  }, [saveSection])

  // Handle content change with debounce
  const handleContentChange = useCallback((data: SectionAutosaveData) => {
    debouncedSave(data)
  }, [debouncedSave])

  // Handle blur event with immediate save
  const handleBlur = useCallback(async (data: SectionAutosaveData) => {
    return await immediateSave(data)
  }, [immediateSave])

  // Cleanup function
  const cleanup = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  return {
    handleContentChange,
    handleBlur,
    cleanup,
    isValidating: isValidatingRef.current || updateSectionMutation.isPending,
    isError: updateSectionMutation.isError,
    error: updateSectionMutation.error,
  }
} 