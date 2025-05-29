import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { openai } from '@/lib/ai/sdk'
import { OUTLINE_SYSTEM_PROMPT, createOutlinePrompt } from '@/lib/ai/prompts'

export async function POST(request: NextRequest) {
  try {
    // Read topicTitle from request body
    const { topicTitle } = await request.json()
    
    if (!topicTitle || typeof topicTitle !== 'string') {
      return NextResponse.json(
        { error: 'topicTitle is required and must be a string' },
        { status: 400 }
      )
    }

    // Authenticate the user using Supabase server client
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Call the AI SDK with prompts
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: OUTLINE_SYSTEM_PROMPT },
        { role: 'user', content: createOutlinePrompt(topicTitle) }
      ],
      temperature: 0.7,
      max_tokens: 1000,
    })

    const outline = completion.choices[0]?.message?.content

    if (!outline) {
      return NextResponse.json(
        { error: 'Failed to generate outline' },
        { status: 500 }
      )
    }

    // Return the generated outline text as JSON response
    return NextResponse.json({ outline })

  } catch (error) {
    console.error('Error generating outline:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 