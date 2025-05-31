import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { streamText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { addCitation, setCitationContext, clearCitationContext } from '@/lib/ai/tools/addCitation'
import { literatureSearchTool } from '@/lib/ai/tools/literatureSearch'

// Enhanced system prompt for function calling
const STREAM_PAPER_SYSTEM_PROMPT = `You are an expert academic writer creating a comprehensive research paper.

CRITICAL INSTRUCTIONS:

1. **USE FUNCTION CALLING FOR ALL CITATIONS**
   - NEVER write citation placeholders like [CITE: ...] or [CN: ...]
   - ALWAYS call the 'addCitation' function when you need to cite a source
   - Call 'literatureSearch' first to find real sources, then 'addCitation' to cite them
   - Every claim, statistic, methodology, or theory MUST have a proper citation via function calling

2. **STREAMING WRITING PROCESS**
   - Write the paper section by section in a natural flow
   - Include proper academic section headers (## Introduction, ## Methodology, etc.)
   - Write comprehensive content (4-6 paragraphs per major section)
   - Maintain formal academic tone throughout

3. **MANDATORY CITATION PROCESS**
   For every citation:
   a) Use 'literatureSearch' to find relevant sources
   b) Immediately call 'addCitation' with the found source details
   c) Continue writing naturally - do NOT insert any placeholder text

4. **OUTPUT REQUIREMENTS**
   - Output ONLY the research paper content
   - Do NOT mention tool calls or meta-commentary
   - Do NOT include system messages or reasoning
   - Write as if citations are invisibly embedded (they are!)

5. **PAPER STRUCTURE**
   - Abstract (150-250 words)
   - Introduction (800-1000 words)
   - Literature Review (1000-1200 words)
   - Methodology (600-800 words)
   - Results/Analysis (800-1000 words)
   - Discussion (600-800 words)
   - Conclusion (400-500 words)

The paper should be publication-ready with proper academic rigor and comprehensive citations throughout.`

export async function POST(request: NextRequest) {
  let citationContextSet = false
  
  try {
    const { projectId, topicTitle, outline } = await request.json()

    if (!projectId || !topicTitle) {
      return new Response('Missing required parameters', { status: 400 })
    }

    // Authenticate user
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 })
    }

    // Verify user owns this project
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, title')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (projectError || !project) {
      return new Response('Project not found', { status: 404 })
    }

    // Set citation context for the addCitation tool
    setCitationContext({ projectId, userId: user.id })
    citationContextSet = true

    console.log(`Starting chunk-based paper generation for project: ${projectId}`)

    // Create the paper generation prompt
    const prompt = outline 
      ? `Generate a comprehensive research paper on "${topicTitle}". Use this outline as a guide:\n\n${outline}\n\nRemember to use function calling for all citations.`
      : `Generate a comprehensive research paper on "${topicTitle}". Create a well-structured academic paper with proper sections and thorough citations via function calling.`

    let chunkSequence = 0

    // Stream the paper with chunk-based storage
    const result = streamText({
      model: openai('gpt-4o'),
      system: STREAM_PAPER_SYSTEM_PROMPT,
      prompt,
      tools: {
        addCitation,
        literatureSearch: literatureSearchTool
      },
      maxSteps: 15, // Allow multiple literature searches and citations
      temperature: 0.7,
      maxTokens: 12000,
      onText: async (text, isFinal) => {
        try {
          // Store each text delta as a chunk
          chunkSequence += 1
          
          const { error: chunkError } = await supabase
            .rpc('append_paper_chunk', {
              p_project_id: projectId,
              p_text: text
            })

          if (chunkError) {
            console.error('Error storing chunk:', chunkError)
            // Don't fail the stream for chunk storage errors
          }

          return text // Forward to client
        } catch (error) {
          console.error('Error in onText handler:', error)
          return text // Continue streaming even if storage fails
        }
      },
      onStepFinish: ({ text, toolCalls, toolResults, usage }) => {
        console.log(`Step completed:`, {
          textLength: text?.length || 0,
          toolCallsCount: toolCalls?.length || 0,
          tokensUsed: usage?.totalTokens || 0
        })

        if (toolCalls?.length) {
          toolCalls.forEach((call, index) => {
            console.log(`Tool call ${index + 1}: ${call.toolName}`, call.args)
          })
        }
      }
    })

    console.log('Returning chunk-based streaming response...')

    // Return the streaming response
    return new Response(
      new ReadableStream({
        async start(controller) {
          try {
            // Stream the response to the client
            for await (const chunk of result.textStream) {
              controller.enqueue(new TextEncoder().encode(chunk))
            }
          } catch (error) {
            console.error('Streaming error:', error)
            controller.error(error)
          } finally {
            controller.close()
            // Clear citation context when done
            if (citationContextSet) {
              clearCitationContext()
            }
          }
        }
      }),
      {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Transfer-Encoding': 'chunked'
        }
      }
    )

  } catch (error) {
    console.error('Paper generation error:', error)
    
    // Clean up citation context on error
    if (citationContextSet) {
      clearCitationContext()
    }
    
    return new Response(
      JSON.stringify({ 
        error: 'Paper generation failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
} 