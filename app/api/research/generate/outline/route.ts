import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateText } from 'ai'
import { openai } from '@/lib/ai/sdk'
import { OUTLINE_SYSTEM_PROMPT } from '@/lib/ai/prompts'

function createOutlinePrompt(topicTitle: string, requirements?: string): string {
  const basePrompt = `Create a detailed outline for a research paper on "${topicTitle}".`
  
  if (requirements) {
    return `${basePrompt}

Additional requirements and focus areas:
${requirements}

Please create a comprehensive outline that addresses these specific requirements while maintaining academic rigor and logical flow.`
  }
  
  return `${basePrompt}

Create a comprehensive, well-structured outline suitable for an academic research paper. Include all necessary sections with clear hierarchical organization.`
}

export async function POST(request: NextRequest) {
  try {
    // Read input from request body
    const { topicTitle, requirements } = await request.json()
    
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

    // Call the AI SDK with enhanced prompts
    const { text: outline } = await generateText({
      model: openai('gpt-4o'),
      system: OUTLINE_SYSTEM_PROMPT,
      prompt: createOutlinePrompt(topicTitle, requirements),
      temperature: 0.7,
      maxTokens: 1500,
    })

    if (!outline) {
      return NextResponse.json(
        { error: 'Failed to generate outline' },
        { status: 500 }
      )
    }

    // Return the generated outline text as JSON response
    return NextResponse.json({ 
      outline,
      topicTitle,
      requirements: requirements || null
    })

  } catch (error) {
    console.error('Error generating outline:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 