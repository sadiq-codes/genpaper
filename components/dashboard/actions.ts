"use server"

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserResearchProjects, createResearchProject, deleteResearchProject } from '@/lib/db/research'
import { headers } from 'next/headers'
import { getAbsoluteUrlFromHeaders } from '@/lib/config'
import { CitationService } from '@/lib/citations/immediate-bibliography'
import { parseTopicInput } from '@/lib/generation/topic-parser'

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
  
  // Uploaded PDF paper IDs
  const uploadedPaperIds = formData.getAll('uploadedPaperIds') as string[]
  
  // Selected paper IDs from library
  const selectedPaperIds = formData.getAll('selectedPaperIds') as string[]
  
  // Combined paper IDs (both uploaded and selected from library)
  const allPaperIds = [...new Set([...uploadedPaperIds, ...selectedPaperIds])]
  
  // Original research support
  const hasOriginalResearch = formData.get('hasOriginalResearch') === 'true'
  const keyFindings = formData.get('keyFindings') as string | null
  
  // Paper source selection
  const useLibraryOnly = formData.get('useLibraryOnly') === 'true'
  
  // Debug logging
  console.log('📝 createProjectAction received:', {
    topic: topic?.substring(0, 50),
    paperType,
    generationMode,
    hasOriginalResearch,
    useLibraryOnly,
    uploadedPaperIdsCount: uploadedPaperIds.length,
    selectedPaperIdsCount: selectedPaperIds.length,
    totalPapersCount: allPaperIds.length
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

  // Validate "Use only my papers" mode: require uploaded PDFs
  if (useLibraryOnly && generationMode !== 'write') {
    if (allPaperIds.length === 0) {
      return { success: false, error: 'You selected "Use only my papers" but haven\'t added any papers. Upload PDFs or select papers from your library first.' }
    }

    // Check that every selected paper has processed PDF content
    const { data: paperRows, error: paperCheckError } = await supabase
      .from('papers')
      .select('id, title, pdf_content')
      .in('id', allPaperIds)

    if (paperCheckError) {
      console.error('Failed to check paper PDF status:', paperCheckError)
      return { success: false, error: 'Failed to verify paper status. Please try again.' }
    }

    const papersById = new Map((paperRows || []).map(p => [p.id, p]))
    const missingPdf: string[] = []

    for (const id of allPaperIds) {
      const paper = papersById.get(id)
      if (!paper || !paper.pdf_content || paper.pdf_content.trim().length === 0) {
        missingPdf.push(paper?.title || 'Unknown paper')
      }
    }

    if (missingPdf.length > 0) {
      const titles = missingPdf.slice(0, 3).join(', ')
      const extra = missingPdf.length > 3 ? ` and ${missingPdf.length - 3} more` : ''
      return {
        success: false,
        error: `Upload PDFs before generating with "Use only my papers". Missing PDF content for: ${titles}${extra}`
      }
    }
  }

  try {
    const isWriteMode = generationMode === 'write'
    
    // Billing gate: check paper quota before creating the project (skip for write-only mode)
    if (!isWriteMode) {
      const { checkCanStartGeneration } = await import('@/lib/billing/gates')
      const gateCheck = await checkCanStartGeneration(user.id, paperType as import('@/types/simplified').PaperTypeKey)
      if (!gateCheck.allowed) {
        return { success: false, error: gateCheck.reason || 'You have reached your paper generation limit. Please upgrade your plan.' }
      }
    }
    
    // Parse freeform topic input to extract clean title + custom instructions
    const parsed = await parseTopicInput(topic.trim())
    const projectTitle = parsed.title
    const customInstructions = parsed.customInstructions
    
    const generationConfig = {
      paper_settings: {
        paperType // No fallback - we've validated it exists
      },
      // Track generation mode for the editor to handle appropriately
      generation_mode: generationMode,
      // Paper source selection - if true, only use library papers (no online search)
      useLibraryOnly,
      // Custom instructions extracted from user's freeform input
      ...(customInstructions && { custom_instructions: customInstructions }),
      // Include original research data in config (for empirical papers)
      // The main topic input serves as the research question for empirical papers
      ...(hasOriginalResearch && {
        original_research: {
          has_original_research: true,
          research_question: projectTitle, // Use parsed title as research question
          key_findings: keyFindings?.trim(),
        }
      }),
      ...(selectedPaperIds.length > 0 && { library_papers_used: selectedPaperIds }),
      // Track uploaded PDFs in config
      ...(uploadedPaperIds.length > 0 && { uploaded_paper_ids: uploadedPaperIds })
    }

    const project = await createResearchProject(user.id, projectTitle, generationConfig)
    
    // Link all papers (uploaded + selected from library) to the project via CitationService
    if (allPaperIds.length > 0) {
      console.log(`📎 Linking ${allPaperIds.length} papers to project ${project.id}`)

      const linkResults = await Promise.allSettled(
        allPaperIds.map(async (paperId) => {
          const isUploaded = uploadedPaperIds.includes(paperId)
          await CitationService.add({
            projectId: project.id,
            sourceRef: { paperId },
            reason: isUploaded ? 'Uploaded PDF' : 'Selected from library'
          })
          return paperId
        })
      )

      for (const result of linkResults) {
        if (result.status === 'fulfilled') {
          console.log(`  ✓ Linked paper ${result.value}`)
        } else {
          // Log but don't fail - the paper is already in the library
          console.error('  ✗ Failed to link paper:', result.reason)
        }
      }
    }
    
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
