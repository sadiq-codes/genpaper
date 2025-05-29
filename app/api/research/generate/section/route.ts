import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { streamText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { SECTION_SYSTEM_PROMPT, createSectionPrompt } from '@/lib/ai/prompts'

export async function POST(request: NextRequest) {
  try {
    // Read request body
    const { topicTitle, outline, sectionName } = await request.json()
    
    if (!topicTitle || typeof topicTitle !== 'string') {
      return new Response('topicTitle is required and must be a string', { status: 400 })
    }
    
    if (!sectionName || typeof sectionName !== 'string') {
      return new Response('sectionName is required and must be a string', { status: 400 })
    }

    // Authenticate user using Supabase server client
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 })
    }

    // Create the section prompt
    const userPrompt = createSectionPrompt(topicTitle, sectionName, outline)

    // Call streamText with the new API
    const result = streamText({
      model: openai('gpt-4o'),
      system: SECTION_SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: 0.7,
      maxTokens: 2000,
    })

    // Return the streaming response using the new API
    return result.toDataStreamResponse()

  } catch (error) {
    console.error('Error generating section:', error)
    return new Response('Internal server error', { status: 500 })
  }
} 