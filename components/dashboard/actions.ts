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
  prevState: { success: boolean; error?: string; project?: any } | null,
  formData: FormData
) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    return { success: false, error: 'Unauthorized' }
  }

  const topic = formData.get('topic') as string
  const paperType = formData.get('paperType') as string
  const selectedPapers = formData.getAll('selectedPapers') as string[]

  if (!topic || topic.trim().length === 0) {
    return { success: false, error: 'Topic is required' }
  }

  if (topic.trim().length < 10) {
    return { success: false, error: 'Topic must be at least 10 characters long' }
  }

  try {
    const generationConfig = {
      paper_settings: {
        paperType: paperType || 'researchArticle'
      },
      ...(selectedPapers.length > 0 && { library_papers_used: selectedPapers })
    }

    const project = await createResearchProject(user.id, topic.trim(), generationConfig)
    
    revalidatePath('/projects')
    // Redirect to editor with success hint to show toast
    redirect(`/editor/${project.id}?created=1`)
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
