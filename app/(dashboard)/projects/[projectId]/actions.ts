'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { OUTLINE_SYSTEM_PROMPT, createOutlinePrompt } from '@/lib/ai/prompts'

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
  literatureSearchResults?: any[]
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

    // Call the full paper generation API
    const response = await fetch('/api/research/generate/full-paper', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topicTitle,
        outline: project.outline
      })
    })

    if (!response.ok) {
      throw new Error('Failed to generate full paper')
    }

    // Read the streamed response
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let fullPaperContent = ''

    if (reader) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        fullPaperContent += decoder.decode(value, { stream: true })
      }
    }

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