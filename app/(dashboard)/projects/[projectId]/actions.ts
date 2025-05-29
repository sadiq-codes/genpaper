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

export async function extractAndSaveCitations(projectId: string, textContent: string) {
  try {
    const supabase = await createClient()
    
    // Get current user for authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return { error: 'User not authenticated' }
    }

    // Use regex to find all [CN: ...] placeholders in the text content
    const citationRegex = /\[CN: (.*?)\]/g
    const citationMatches = Array.from(textContent.matchAll(citationRegex))
    
    // Extract the concepts (the part inside the placeholder)
    const extractedCitations = citationMatches.map(match => match[1].trim())
    
    // Remove duplicates by converting to Set and back to Array
    const uniqueCitations = Array.from(new Set(extractedCitations))

    // Save the array of concepts to the citations_identified field for the project
    const { error: dbError } = await supabase
      .from('projects')
      .update({ citations_identified: uniqueCitations })
      .eq('id', projectId)
      .eq('user_id', user.id) // Ensure user can only update their own projects

    if (dbError) {
      console.error('Database error:', dbError)
      return { error: 'Failed to save citations to database' }
    }

    // Revalidate the project page to show the extracted citations
    revalidatePath(`/dashboard/projects/${projectId}`)

    return { success: true, citations: uniqueCitations, count: uniqueCitations.length }

  } catch (error) {
    console.error('Error in extractAndSaveCitations:', error)
    return { error: 'An unexpected error occurred' }
  }
} 