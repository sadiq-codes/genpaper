"use server"

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserResearchProjects, createResearchProject, deleteResearchProject } from '@/lib/db/research'
import { headers } from 'next/headers'
import { getAbsoluteUrlFromHeaders } from '@/lib/config'

// Projects Actions
export async function getProjectsAction(limit = 20, offset = 0) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    throw new Error('Unauthorized')
  }

  try {
    const projects = await getUserResearchProjects(user.id, limit, offset)
    return { success: true, projects }
  } catch (error) {
    console.error('Error loading projects:', error)
    return { success: false, error: 'Failed to load projects' }
  }
}

// Enhanced action with proper state management
export async function createProjectAction(
  prevState: { success: boolean; error?: string; project?: unknown } | null,
  formData: FormData
) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    return { success: false, error: 'Unauthorized' }
  }

  // Main input serves as topic (for reviews) or research question (for empirical papers)
  const topic = formData.get('topic') as string
  const paperType = formData.get('paperType') as string
  const generationMode = formData.get('generationMode') as string || 'generate'
  const selectedPapers = formData.getAll('selectedPapers') as string[]
  
  // Original research support
  const hasOriginalResearch = formData.get('hasOriginalResearch') === 'true'
  const keyFindings = formData.get('keyFindings') as string | null
  
  // Debug logging
  console.log('📝 createProjectAction received:', {
    topic: topic?.substring(0, 50),
    paperType,
    generationMode,
    hasOriginalResearch,
    selectedPapersCount: selectedPapers.length
  })

  if (!topic || topic.trim().length === 0) {
    return { success: false, error: 'Topic/Research question is required' }
  }

  if (topic.trim().length < 10) {
    return { success: false, error: 'Please provide at least 10 characters' }
  }

  // Validate paperType - should never be empty since form always sends a value
  if (!paperType) {
    console.error('❌ paperType is missing from form data - this should never happen')
    return { success: false, error: 'Paper type is required' }
  }

  // Validate key findings if original research is enabled
  if (hasOriginalResearch) {
    if (!keyFindings || keyFindings.trim().length < 10) {
      return { success: false, error: 'Key findings are required (at least 10 characters)' }
    }
  }

  try {
    const isWriteMode = generationMode === 'write'
    
    const generationConfig = {
      paper_settings: {
        paperType // No fallback - we've validated it exists
      },
      // Track generation mode for the editor to handle appropriately
      generation_mode: generationMode,
      // Include original research data in config (for empirical papers)
      // The main topic input serves as the research question for empirical papers
      ...(hasOriginalResearch && {
        original_research: {
          has_original_research: true,
          research_question: topic.trim(), // Main input IS the research question
          key_findings: keyFindings?.trim(),
        }
      }),
      ...(selectedPapers.length > 0 && { library_papers_used: selectedPapers })
    }

    const project = await createResearchProject(user.id, topic.trim(), generationConfig)
    
    revalidatePath('/projects')
    
    // Redirect to editor
    // - For 'generate' mode: created=1 triggers paper generation
    // - For 'write' mode: write=1 skips generation, opens blank editor
    if (isWriteMode) {
      redirect(`/editor/${project.id}?write=1`)
    } else {
      redirect(`/editor/${project.id}?created=1`)
    }
  } catch (error) {
    // Allow Next.js redirect control flow errors to propagate without logging
    if (
      error &&
      typeof error === 'object' &&
      'digest' in (error as Record<string, unknown>) &&
      typeof (error as Record<string, unknown>).digest === 'string' &&
      String((error as Record<string, unknown>).digest).startsWith('NEXT_REDIRECT;')
    ) {
      throw error as unknown as Error
    }
    console.error('Error creating project:', error)
    return { success: false, error: 'Failed to create project' }
  }
}

export async function deleteProjectAction(projectId: string) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    throw new Error('Unauthorized')
  }

  try {
    // Verify ownership
    const { data: project, error } = await supabase
      .from('research_projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (error || !project) {
      return { success: false, error: 'Project not found' }
    }

    await deleteResearchProject(projectId)
    
    revalidatePath('/projects')
    return { success: true }
  } catch (error) {
    console.error('Error deleting project:', error)
    return { success: false, error: 'Failed to delete project' }
  }
}

// Library Actions
export async function addToLibraryAction(formData: FormData) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    throw new Error('Unauthorized')
  }

  const paperId = formData.get('paperId') as string
  
  try {
    const h = await headers()
    const absoluteUrl = getAbsoluteUrlFromHeaders(h, '/api/library')
    const response = await fetch(absoluteUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paperId })
    })

    if (!response.ok) {
      throw new Error('Failed to add to library')
    }

    revalidatePath('/library')
    return { success: true }
  } catch (error) {
    console.error('Error adding to library:', error)
    return { success: false, error: 'Failed to add to library' }
  }
}
