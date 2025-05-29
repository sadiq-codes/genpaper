import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { openai } from '@/lib/ai/sdk'
import { generateFullPaperPrompt, FULL_PAPER_SYSTEM_PROMPT } from '@/lib/ai/prompts'
import { streamText } from 'ai'

export async function POST(request: NextRequest) {
  try {
    const { topicTitle, outline } = await request.json()

    // Authenticate user
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!topicTitle) {
      return NextResponse.json({ error: 'Topic title is required' }, { status: 400 })
    }

    // Generate the full research paper using Vercel AI SDK
    const result = await streamText({
      model: openai('gpt-4o'),
      system: FULL_PAPER_SYSTEM_PROMPT,
      prompt: generateFullPaperPrompt(topicTitle, outline),
      temperature: 0.7,
      maxTokens: 4000,
    })

    // Return the streaming response
    return result.toDataStreamResponse()

  } catch (error) {
    console.error('Full paper generation error:', error)
    return NextResponse.json(
      { error: 'Failed to generate full paper' },
      { status: 500 }
    )
  }
} 