import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { streamText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { SECTION_SYSTEM_PROMPT, createSectionPrompt } from '@/lib/ai/prompts'
import { literatureSearchTool, LiteratureSearchResult } from '@/lib/ai/tools/literatureSearch'

export async function POST(request: NextRequest) {
  try {
    // Read request body
    const { topicTitle, outline, sectionName, projectId } = await request.json()
    
    console.log('🔍 Section generation request:', { topicTitle, sectionName, projectId })
    
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
    console.log('📝 Generated prompt length:', userPrompt.length)

    // Store literature search results for later citation processing
    const literatureSearchResults: LiteratureSearchResult[] = []
    let toolCallCount = 0

    // Call streamText with the literatureSearch tool
    const result = streamText({
      model: openai('gpt-4o'),
      system: SECTION_SYSTEM_PROMPT,
      prompt: userPrompt,
      tools: {
        literatureSearch: literatureSearchTool,
      },
      temperature: 0.7,
      maxTokens: 2000,
      onStepFinish({ toolCalls, toolResults }) {
        // Capture literature search results for citation processing
        if (toolCalls && toolResults) {
          toolCallCount += toolCalls.length
          console.log(`🔧 Step finished with ${toolCalls.length} tool calls`)
          
          for (let i = 0; i < toolCalls.length; i++) {
            const toolCall = toolCalls[i];
            const toolResult = toolResults[i];
            
            console.log(`📞 Tool call ${i + 1}:`, {
              toolName: toolCall.toolName,
              args: toolCall.args
            })
            
            if (toolCall.toolName === 'literatureSearch' && toolResult.result) {
              const results = toolResult.result as LiteratureSearchResult[]
              console.log(`📚 Literature search returned ${results.length} results`)
              // Store the literature search results
              literatureSearchResults.push(...results);
            }
          }
        } else {
          console.log('🔕 Step finished with no tool calls')
        }
      },
    })

    console.log('🚀 Starting streaming response...')

    // Enhanced streaming response that includes metadata about citations
    return new Response(
      new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder()
          let finalText = ''
          
          try {
            // Stream the AI response and collect the full text
            for await (const chunk of result.textStream) {
              finalText += chunk
              controller.enqueue(encoder.encode(chunk))
            }
            
            console.log(`✅ Streaming complete. Generated ${finalText.length} characters`)
            console.log(`🔧 Total tool calls: ${toolCallCount}`)
            console.log(`📚 Literature results collected: ${literatureSearchResults.length}`)
            
            // Log a sample of the generated text to check for placeholders
            const textSample = finalText.substring(0, 500) + (finalText.length > 500 ? '...' : '')
            console.log('📝 Generated text sample:', textSample)
            
            // Check for citation placeholders in the text
            const cnMatches = finalText.match(/\[CN:.*?\]/g) || []
            const citeMatches = finalText.match(/\[CITE:.*?\]/g) || []
            console.log(`🔍 Found ${cnMatches.length} [CN: ...] placeholders`)
            console.log(`🔍 Found ${citeMatches.length} [CITE: ...] placeholders`)
            
            // After streaming is complete, process citations if projectId is provided
            if (projectId && (literatureSearchResults.length > 0 || cnMatches.length > 0 || citeMatches.length > 0)) {
              console.log(`💾 Processing citations for project ${projectId}...`)
              
              // Import and use citation processing functions
              try {
                const { extractAndSaveCitations } = await import('@/app/(dashboard)/projects/[projectId]/actions')
                const citationResult = await extractAndSaveCitations(projectId, finalText, sectionName, literatureSearchResults)
                console.log('💾 Citation processing result:', citationResult)
              } catch (citationError) {
                console.error('❌ Error processing citations:', citationError)
                // Don't fail the whole request if citation processing fails
              }
            } else {
              console.log('⚠️ Skipping citation processing:', {
                hasProjectId: !!projectId,
                literatureResultsCount: literatureSearchResults.length,
                cnPlaceholders: cnMatches.length,
                citePlaceholders: citeMatches.length
              })
            }
          } catch (error) {
            console.error('❌ Streaming error:', error)
            controller.error(error)
          } finally {
            controller.close()
          }
        }
      }),
      {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Literature-Results': literatureSearchResults.length.toString(),
          'X-Tool-Calls': toolCallCount.toString(),
        },
      }
    )

  } catch (error) {
    console.error('❌ Error generating section:', error)
    return new Response('Internal server error', { status: 500 })
  }
} 