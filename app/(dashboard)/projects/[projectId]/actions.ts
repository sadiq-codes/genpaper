'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { OUTLINE_SYSTEM_PROMPT, createOutlinePrompt } from '@/lib/ai/prompts'
import { generateFullPaperPrompt, FULL_PAPER_SYSTEM_PROMPT } from '@/lib/ai/prompts'
import { literatureSearchTool, type LiteratureSearchResult } from '@/lib/ai/tools/literatureSearch'
import { streamText } from 'ai'

export async function generateAndSaveOutline(projectId: string, topicTitle: string) {
  try {
    const supabase = await createClient()
    
    // Get current user for authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return { error: 'User not authenticated' }
    }

    // Call the AI SDK with the new generateText function
    const { text: outline } = await generateText({
      model: openai('gpt-4o'),
      system: OUTLINE_SYSTEM_PROMPT,
      prompt: createOutlinePrompt(topicTitle),
      temperature: 0.7,
      maxTokens: 1000,
    })

    if (!outline) {
      return { error: 'Failed to generate outline' }
    }

    // Update the project's outline field in Supabase
    const { error: dbError } = await supabase
      .from('projects')
      .update({ outline })
      .eq('id', projectId)
      .eq('user_id', user.id) // Ensure user can only update their own projects

    if (dbError) {
      console.error('Database error:', dbError)
      return { error: 'Failed to save outline to database' }
    }

    // Revalidate the project page to show the new outline
    revalidatePath(`/dashboard/projects/${projectId}`)

    return { success: true, outline }

  } catch (error) {
    console.error('Error in generateAndSaveOutline:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function saveSectionContent(projectId: string, sectionContent: string) {
  try {
    const supabase = await createClient()
    
    // Get current user for authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return { error: 'User not authenticated' }
    }

    // Get current content to append to it
    const { data: project, error: fetchError } = await supabase
      .from('projects')
      .select('content')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (fetchError) {
      console.error('Error fetching current content:', fetchError)
      return { error: 'Failed to fetch current project content' }
    }

    // Append new section content to existing content
    const currentContent = project?.content || ''
    const updatedContent = currentContent ? `${currentContent}\n\n${sectionContent}` : sectionContent

    // Update the project's content field in Supabase
    const { error: dbError } = await supabase
      .from('projects')
      .update({ content: updatedContent })
      .eq('id', projectId)
      .eq('user_id', user.id) // Ensure user can only update their own projects

    if (dbError) {
      console.error('Database error:', dbError)
      return { error: 'Failed to save section content to database' }
    }

    // Revalidate the project page to show the new content
    revalidatePath(`/dashboard/projects/${projectId}`)

    return { success: true, content: updatedContent }

  } catch (error) {
    console.error('Error in saveSectionContent:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function extractAndSaveCitations(
  projectId: string, 
  textContent: string, 
  sectionName?: string,
  literatureSearchResults?: LiteratureSearchResult[]
) {
  try {
    const supabase = await createClient()
    
    // Get current user for authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return { error: 'User not authenticated' }
    }

    // Import citation utilities
    const { extractAllCitationPlaceholders, extractStructuredCitations, saveStructuredCitations } = await import('@/lib/citations/utils');

    // Extract all citation placeholders
    const { generalCitations, specificCitations, allCitations } = extractAllCitationPlaceholders(textContent);

    // Process structured citations if literature search results are available
    let structuredCitationResult: { success: boolean; citationIds: string[]; error?: string } = { success: true, citationIds: [] };
    if (literatureSearchResults && literatureSearchResults.length > 0) {
      const structuredCitations = extractStructuredCitations(textContent, literatureSearchResults);
      if (structuredCitations.length > 0) {
        structuredCitationResult = await saveStructuredCitations(projectId, structuredCitations, sectionName);
      }
    }

    // Update the citations_identified field in projects table (existing functionality)
    const { error: dbError } = await supabase
      .from('projects')
      .update({ citations_identified: allCitations })
      .eq('id', projectId)
      .eq('user_id', user.id) // Ensure user can only update their own projects

    if (dbError) {
      console.error('Database error:', dbError)
      return { error: 'Failed to save citations to database' }
    }

    // Revalidate the project page to show the extracted citations
    revalidatePath(`/dashboard/projects/${projectId}`)

    return { 
      success: true, 
      citations: allCitations, 
      count: allCitations.length,
      breakdown: {
        general: generalCitations.length,
        specific: specificCitations.length
      },
      structuredCitations: {
        saved: structuredCitationResult.success,
        count: structuredCitationResult.citationIds.length,
        citationIds: structuredCitationResult.citationIds
      }
    }

  } catch (error) {
    console.error('Error in extractAndSaveCitations:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function generatePlaceholderReferences(projectId: string) {
  try {
    const supabase = await createClient()
    
    // Get current user for authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return { error: 'User not authenticated' }
    }

    // Fetch the project's citations_identified
    const { data: project, error: fetchError } = await supabase
      .from('projects')
      .select('citations_identified')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (fetchError) {
      console.error('Error fetching project citations:', fetchError)
      return { error: 'Failed to fetch project data' }
    }

    if (!project.citations_identified || project.citations_identified.length === 0) {
      return { error: 'No citations identified to generate references from' }
    }

    // Format citations into placeholder references
    const placeholderReferences = project.citations_identified.map(
      (citation: string, index: number) => 
        `${index + 1}. [Placeholder for: ${citation}] - Author, A. (Year). Title of work. Journal Name.`
    )

    // Save the references list to the project
    const { error: updateError } = await supabase
      .from('projects')
      .update({ references_list: placeholderReferences })
      .eq('id', projectId)
      .eq('user_id', user.id)

    if (updateError) {
      console.error('Error updating references list:', updateError)
      return { error: 'Failed to save references' }
    }

    revalidatePath(`/dashboard/projects/${projectId}`)
    return { success: true }

  } catch (error) {
    console.error('Error in generatePlaceholderReferences:', error)
    return { error: 'Failed to generate references' }
  }
}

export async function generateAndSaveFullPaper(projectId: string, topicTitle: string) {
  try {
    const supabase = await createClient()
    
    // Get current user for authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return { error: 'User not authenticated' }
    }

    // Fetch the project's outline if it exists
    const { data: project, error: fetchError } = await supabase
      .from('projects')
      .select('outline')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (fetchError) {
      console.error('Error fetching project:', fetchError)
      return { error: 'Failed to fetch project data' }
    }

    console.log(`Starting full paper generation for: "${topicTitle}"`)
    console.log('User authenticated:', user.id)
    console.log('Outline provided:', !!project.outline)

    // Generate the full research paper using Vercel AI SDK directly
    const result = await streamText({
      model: openai('gpt-4o'),
      system: FULL_PAPER_SYSTEM_PROMPT,
      prompt: generateFullPaperPrompt(topicTitle, project.outline),
      tools: {
        literatureSearch: literatureSearchTool, // Enable literature search for citations
      },
      maxSteps: 10, // Allow up to 10 steps for multi-step tool calling and generation
      temperature: 0.7,
      maxTokens: 8000, // Increased for comprehensive full papers
    })

    // Collect all the text from the stream
    let fullPaperContent = ''
    for await (const delta of result.textStream) {
      fullPaperContent += delta
    }

    console.log('Full paper generation completed, content length:', fullPaperContent.length)

    // Update the project with the full paper content
    const { error: updateError } = await supabase
      .from('projects')
      .update({ content: fullPaperContent })
      .eq('id', projectId)
      .eq('user_id', user.id)

    if (updateError) {
      console.error('Error updating project content:', updateError)
      return { error: 'Failed to save generated paper' }
    }

    // Extract and save citations from the generated content
    await extractAndSaveCitations(projectId, fullPaperContent)

    revalidatePath(`/dashboard/projects/${projectId}`)
    return { success: true }

  } catch (error) {
    console.error('Error in generateAndSaveFullPaper:', error)
    return { error: 'Failed to generate full paper' }
  }
}

export async function saveFullPaperContent(projectId: string, content: string) {
  try {
    const supabase = await createClient()
    
    // Get current user for authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return { error: 'User not authenticated' }
    }

    // Update the project with the full paper content
    const { error: updateError } = await supabase
      .from('projects')
      .update({ content })
      .eq('id', projectId)
      .eq('user_id', user.id)

    if (updateError) {
      console.error('Error updating project content:', updateError)
      return { error: 'Failed to save generated paper' }
    }

    // Extract and save citations from the generated content
    await extractAndSaveCitations(projectId, content)

    revalidatePath(`/dashboard/projects/${projectId}`)
    return { success: true }

  } catch (error) {
    console.error('Error in saveFullPaperContent:', error)
    return { error: 'Failed to save full paper content' }
  }
}

// Default sections structure for new projects
const defaultSections = [
  { section_key: "abstract", title: "Abstract", order: 1 },
  { section_key: "introduction", title: "Introduction", order: 2 },
  { section_key: "literature", title: "Literature Review", order: 3 },
  { section_key: "methodology", title: "Methodology", order: 4 },
  { section_key: "results", title: "Results", order: 5 },
  { section_key: "discussion", title: "Discussion", order: 6 },
  { section_key: "conclusion", title: "Conclusion", order: 7 },
  { section_key: "references", title: "References", order: 8 },
]

export async function createDefaultSections(projectId: string) {
  const supabase = await createClient()
  
  try {
    // Check if user has access to this project
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      throw new Error('Unauthorized')
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!project) {
      throw new Error('Project not found or unauthorized')
    }

    // Create default sections
    const { data: newSections, error } = await supabase
      .from('paper_sections')
      .insert(
        defaultSections.map(section => ({
          project_id: projectId,
          section_key: section.section_key,
          title: section.title,
          order: section.order,
          status: 'pending' as const,
          word_count: 0,
        }))
      )
      .select()

    if (error) {
      console.error('Error creating default sections:', error)
      throw error
    }

    revalidatePath(`/projects/${projectId}`)
    return { success: true, sections: newSections }
  } catch (error) {
    console.error('Error in createDefaultSections:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function updateSectionContent(
  projectId: string,
  sectionKey: string,
  newContent: string,
  newWordCount: number
) {
  const supabase = await createClient()
  
  try {
    // Check if user has access to this project
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      throw new Error('Unauthorized')
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!project) {
      throw new Error('Project not found or unauthorized')
    }

    // Update the specific section
    const { error } = await supabase
      .from('paper_sections')
      .update({
        content: newContent,
        word_count: newWordCount,
        updated_at: new Date().toISOString()
      })
      .eq('project_id', projectId)
      .eq('section_key', sectionKey)

    if (error) {
      console.error('Error updating section content:', error)
      throw error
    }

    revalidatePath(`/projects/${projectId}`)
    return { success: true }
  } catch (error) {
    console.error('Error in updateSectionContent:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function getSectionsWithContent(projectId: string) {
  const supabase = await createClient()
  
  try {
    // Check if user has access to this project
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      throw new Error('Unauthorized')
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!project) {
      throw new Error('Project not found or unauthorized')
    }

    // Fetch all sections for the project
    const { data: sections, error } = await supabase
      .from('paper_sections')
      .select('*')
      .eq('project_id', projectId)
      .order('order')

    if (error) {
      console.error('Error fetching sections:', error)
      throw error
    }

    // If no sections exist, create default ones and return them
    if (!sections || sections.length === 0) {
      const result = await createDefaultSections(projectId)
      if (result.success && result.sections) {
        return { success: true, sections: result.sections }
      } else {
        throw new Error(result.error || 'Failed to create default sections')
      }
    }

    return { success: true, sections }
  } catch (error) {
    console.error('Error in getSectionsWithContent:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function getCitationsWithLinks(projectId: string) {
  const supabase = await createClient()
  
  try {
    // Check if user has access to this project
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      throw new Error('Unauthorized')
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!project) {
      throw new Error('Project not found or unauthorized')
    }

    // Fetch citations with their links using the view
    const { data: citations, error } = await supabase
      .from('citations_with_links')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching citations:', error)
      throw error
    }

    return { success: true, citations: citations || [] }
  } catch (error) {
    console.error('Error in getCitationsWithLinks:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function addCitationToProject(
  projectId: string,
  citationData: {
    title: string
    authors: Array<{ family: string; given: string }>
    year?: number
    journal?: string
    doi?: string
    citation_key?: string
  }
) {
  const supabase = await createClient()
  
  try {
    // Check if user has access to this project
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      throw new Error('Unauthorized')
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!project) {
      throw new Error('Project not found or unauthorized')
    }

    // Generate citation key if not provided
    const citationKey = citationData.citation_key || 
      `${citationData.title.slice(0, 20).replace(/\s+/g, '-').toLowerCase()}-${citationData.year || 'unknown'}`

    // Insert citation
    const { data: newCitation, error } = await supabase
      .from('citations')
      .insert({
        project_id: projectId,
        citation_key: citationKey,
        title: citationData.title,
        authors: citationData.authors,
        year: citationData.year,
        journal: citationData.journal,
        doi: citationData.doi,
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating citation:', error)
      throw error
    }

    revalidatePath(`/projects/${projectId}`)
    return { success: true, citation: newCitation }
  } catch (error) {
    console.error('Error in addCitationToProject:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// Flexible outline creation with templates or AI generation
export async function createFlexibleOutline(
  projectId: string, 
  sections: Array<{
    section_key: string
    title: string
    order: number
    description?: string
  }>,
  outlineText?: string
) {
  const supabase = await createClient()
  
  try {
    // Check if user has access to this project
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      throw new Error('Unauthorized')
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!project) {
      throw new Error('Project not found or unauthorized')
    }

    // Delete existing sections first
    const { error: deleteError } = await supabase
      .from('paper_sections')
      .delete()
      .eq('project_id', projectId)

    if (deleteError) {
      console.error('Error deleting existing sections:', deleteError)
      throw deleteError
    }

    // Create new sections
    const { data: newSections, error: insertError } = await supabase
      .from('paper_sections')
      .insert(
        sections.map(section => ({
          project_id: projectId,
          section_key: section.section_key,
          title: section.title,
          order: section.order,
          status: 'pending' as const,
          word_count: 0,
        }))
      )
      .select()

    if (insertError) {
      console.error('Error creating sections:', insertError)
      throw insertError
    }

    // Optionally store the outline text in the project
    if (outlineText) {
      const { error: updateError } = await supabase
        .from('projects')
        .update({ outline: outlineText })
        .eq('id', projectId)

      if (updateError) {
        console.error('Error storing outline text:', updateError)
        // Don't throw here since sections were created successfully
      }
    }

    revalidatePath(`/projects/${projectId}`)
    return { success: true, sections: newSections, outlineText }
  } catch (error) {
    console.error('Error in createFlexibleOutline:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// Complete project setup with title and outline
export async function completeProjectSetup(
  projectId: string,
  data: {
    title: string
    sections: Array<{
      section_key: string
      title: string
      order: number
      description?: string
    }>
    outlineText?: string
  }
) {
  const supabase = await createClient()
  
  try {
    // Check if user has access to this project
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      throw new Error('Unauthorized')
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!project) {
      throw new Error('Project not found or unauthorized')
    }

    // Update project title and outline text if provided
    const projectUpdates: any = { title: data.title }
    if (data.outlineText) {
      projectUpdates.outline = data.outlineText
    }

    const { error: titleUpdateError } = await supabase
      .from('projects')
      .update(projectUpdates)
      .eq('id', projectId)

    if (titleUpdateError) {
      console.error('Error updating project title:', titleUpdateError)
      throw titleUpdateError
    }

    // Delete existing sections first
    const { error: deleteError } = await supabase
      .from('paper_sections')
      .delete()
      .eq('project_id', projectId)

    if (deleteError) {
      console.error('Error deleting existing sections:', deleteError)
      throw deleteError
    }

    // Create new sections
    const { data: newSections, error: insertError } = await supabase
      .from('paper_sections')
      .insert(
        data.sections.map(section => ({
          project_id: projectId,
          section_key: section.section_key,
          title: section.title,
          order: section.order,
          status: 'pending' as const,
          word_count: 0,
        }))
      )
      .select()

    if (insertError) {
      console.error('Error creating sections:', insertError)
      throw insertError
    }

    revalidatePath(`/projects/${projectId}`)
    return { success: true, sections: newSections, title: data.title }
  } catch (error) {
    console.error('Error in completeProjectSetup:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
} 