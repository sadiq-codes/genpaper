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
      model: openai('gpt-3.5-turbo'),
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