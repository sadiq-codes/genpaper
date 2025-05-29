import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { openai } from '@ai-sdk/openai'
import { generateFullPaperPrompt, FULL_PAPER_SYSTEM_PROMPT } from '@/lib/ai/prompts'
import { literatureSearchTool } from '@/lib/ai/tools/literatureSearch'
import { streamText } from 'ai'

export async function POST(request: NextRequest) {
  try {
    const { topicTitle, outline } = await request.json()

    // Authenticate user
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      console.error('Authentication error:', authError)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!topicTitle) {
      console.error('Missing topicTitle in request')
      return NextResponse.json({ error: 'Topic title is required' }, { status: 400 })
    }

    console.log(`Starting full paper generation for: "${topicTitle}"`)
    console.log('User authenticated:', user.id)
    console.log('Outline provided:', !!outline)

    // Generate the full research paper using Vercel AI SDK with enhanced capabilities
    const result = await streamText({
      model: openai('gpt-4o'),
      system: FULL_PAPER_SYSTEM_PROMPT,
      prompt: generateFullPaperPrompt(topicTitle, outline),
      tools: {
        literatureSearch: literatureSearchTool, // Enable literature search for citations
      },
      maxSteps: 10, // Allow up to 10 steps for multi-step tool calling and generation
      temperature: 0.7,
      maxTokens: 8000, // Increased for comprehensive full papers (was 4000)
      onStepFinish({ text, toolCalls, toolResults, finishReason, usage, response }) {
        // Log each step for debugging and monitoring
        console.log(`Full paper generation step completed:`, {
          finishReason,
          toolCallsCount: toolCalls?.length || 0,
          toolResultsCount: toolResults?.length || 0,
          textLength: text?.length || 0,
          tokensUsed: usage?.totalTokens || 0,
        });
        
        // Log tool calls for debugging
        if (toolCalls && toolCalls.length > 0) {
          toolCalls.forEach((call, index) => {
            console.log(`Tool call ${index + 1}:`, {
              toolName: call.toolName,
              args: call.args,
            });
          });
        }
      },
    })

    console.log('Full paper generation stream initiated successfully')
    console.log('Returning streaming response...')

    // Return the streaming response
    return result.toDataStreamResponse()

  } catch (error) {
    console.error('Full paper generation error:', error)
    
    // Provide more detailed error information
    if (error instanceof Error) {
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      })
      return NextResponse.json(
        { 
          error: 'Failed to generate full paper',
          details: error.message,
          timestamp: new Date().toISOString()
        },
        { status: 500 }
      )
    }
    
    return NextResponse.json(
      { error: 'Failed to generate full paper' },
      { status: 500 }
    )
  }
} 