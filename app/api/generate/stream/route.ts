import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { 
  createResearchProject, 
  addProjectVersion, 
  addProjectCitation,
  updateResearchProjectStatus
} from '@/lib/db/research'
import { getUserLibraryPapers } from '@/lib/db/library'
import { searchOnlinePapers, selectRelevantPapers } from '@/lib/ai/search-papers'
import { generatePaperStream } from '@/lib/ai/generate-paper'
import type { 
  GenerateRequest, 
  PaperWithAuthors,
  GenerationConfig
} from '@/types/simplified'

// Fail fast on missing environment variables
if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY environment variable is required')
}

const isDev = process.env.NODE_ENV !== 'production'

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  })
}

export async function POST(request: NextRequest) {
  if (isDev) console.log('🚀 Starting POST /api/generate/stream')
  
  let supabase
  
  try {
    if (isDev) console.log('📦 Creating Supabase client...')
    supabase = await createClient() // Need await for cookies() in Next.js 15
    if (isDev) console.log('✅ Supabase client created successfully')
  } catch (error) {
    console.error('❌ Failed to create Supabase client:', error)
    return new Response('Database connection failed', { status: 500 })
  }
  
  // Check authentication
  try {
    if (isDev) console.log('🔐 Checking authentication...')
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError) {
      console.error('❌ Authentication error:', authError)
      return new Response('Authentication failed', { status: 401 })
    }
    if (!user) {
      console.error('❌ No user found')
      return new Response('Unauthorized', { status: 401 })
    }
    if (isDev) console.log('✅ User authenticated:', user.id)

    if (isDev) console.log('📝 Parsing request body...')
    const body: GenerateRequest = await request.json()
    if (isDev) console.log('✅ Request body parsed:', { topic: body.topic, useLibraryOnly: body.useLibraryOnly })
    
    const { topic, libraryPaperIds, useLibraryOnly, config } = body

    if (!topic?.trim()) {
      console.error('❌ No topic provided')
      return new Response('Topic is required', { status: 400 })
    }

    // Create generation config
    const generationConfig: GenerationConfig = {
      model: 'gpt-4',
      search_parameters: {
        sources: ['arxiv', 'pubmed'],
        limit: 20,
        useSemanticSearch: false
      },
      paper_settings: {
        length: config?.length || 'medium',
        style: config?.style || 'academic',
        citationStyle: config?.citationStyle || 'apa',
        includeMethodology: config?.includeMethodology ?? true
      },
      library_papers_used: libraryPaperIds || []
    }

    if (isDev) console.log('🎯 Creating research project...')
    // Create research project
    const project = await createResearchProject(user.id, topic, generationConfig)
    if (isDev) console.log('✅ Research project created:', project.id)

    // Create readable stream for Server-Sent Events
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        
        // Add heartbeat to prevent connection timeouts
        const heartbeat = setInterval(() => {
          try {
            sendEvent({ type: 'ping', timestamp: Date.now() })
          } catch {
            // If we can't send events, the connection is probably closed
            clearInterval(heartbeat)
          }
        }, 25000) // 25 seconds
        
        const sendEvent = (data: object) => {
          try {
            const message = `data: ${JSON.stringify(data)}\n\n`
            controller.enqueue(encoder.encode(message))
          } catch (error) {
            console.error('Failed to send event:', error)
            // Clear heartbeat if we can't send events
            clearInterval(heartbeat)
          }
        }

        try {
          // Send initial status
          sendEvent({
            type: 'status',
            projectId: project.id,
            status: 'generating',
            progress: 0,
            stage: 'initializing',
            message: 'Starting paper generation...'
          })

          // Gather papers
          sendEvent({
            type: 'progress',
            progress: 5,
            stage: 'searching',
            message: 'Gathering research papers...'
          })

          let papers: PaperWithAuthors[] = []

          // Get papers from library if specified
          if (libraryPaperIds && libraryPaperIds.length > 0) {
            try {
              const libraryPapers = await getUserLibraryPapers(user.id)
              papers = libraryPapers
                .filter(lp => libraryPaperIds.includes(lp.paper_id))
                .map(lp => lp.paper as PaperWithAuthors)
            } catch (error) {
              console.error('Failed to get library papers:', error)
              throw new Error('Failed to access library papers')
            }
          }

          // Search for additional papers if not library-only
          if (!useLibraryOnly) {
            sendEvent({
              type: 'progress',
              progress: 15,
              stage: 'searching',
              message: 'Searching online databases...'
            })

            try {
              const searchResults = await searchOnlinePapers(
                topic,
                generationConfig?.search_parameters?.sources,
                generationConfig?.search_parameters?.limit
              )
              
              sendEvent({
                type: 'progress',
                progress: 25,
                stage: 'analyzing',
                message: 'Selecting most relevant papers...'
              })

              // Select most relevant papers
              const selectedPapers = await selectRelevantPapers(searchResults, topic, 10)
              papers = [...papers, ...selectedPapers]
            } catch (error) {
              console.error('Failed to search papers:', error)
              throw new Error('Failed to search for papers online')
            }
          }

          if (papers.length === 0) {
            throw new Error('No papers found for the given topic')
          }

          sendEvent({
            type: 'progress',
            progress: 35,
            stage: 'writing',
            message: `Found ${papers.length} relevant papers. Starting paper generation...`
          })

          // Generate the research paper with streaming
          let result
          try {
            result = await generatePaperStream(
              topic,
              papers,
              {
                length: generationConfig?.paper_settings?.length || 'medium',
                style: generationConfig?.paper_settings?.style || 'academic',
                citationStyle: generationConfig?.paper_settings?.citationStyle || 'apa',
                includeMethodology: generationConfig?.paper_settings?.includeMethodology ?? true,
                includeFuture: true
              },
              (content: string, progress: number, stage: string) => {
                // Clamp progress to prevent exceeding 95%
                const clampedProgress = Math.min(35 + (progress * 0.6), 95)
                sendEvent({
                  type: 'progress',
                  progress: clampedProgress,
                  stage: stage,
                  message: `Writing ${stage} section...`,
                  content: content.length > 5000 ? content.substring(0, 5000) + '...' : content
                })
              }
            )
          } catch (error) {
            console.error('Failed to generate paper:', error)
            throw new Error('Failed to generate research paper')
          }

          sendEvent({
            type: 'progress',
            progress: 95,
            stage: 'finalizing',
            message: 'Saving paper and citations...'
          })

          // Save the generated content as version 1
          const version = await addProjectVersion(project.id, result.content, 1)

          // Parallelize citation inserts instead of sequential
          await Promise.all(
            result.citations.map(citation =>
              addProjectCitation(
                project.id,
                version.version,
                citation.paperId,
                citation.citationText,
                citation.positionStart,
                citation.positionEnd,
                citation.pageRange
              )
            )
          )

          // Update project status to complete
          await updateResearchProjectStatus(project.id, 'complete', new Date().toISOString())

          // Send final completion event
          sendEvent({
            type: 'complete',
            projectId: project.id,
            progress: 100,
            stage: 'complete',
            message: 'Paper generation completed successfully!',
            wordCount: result.wordCount,
            citationCount: result.citations.length,
            sections: result.structure.sections
          })

        } catch (error) {
          console.error('Streaming generation error:', error)
          
          // Update project status to failed
          try {
            await updateResearchProjectStatus(project.id, 'failed')
          } catch (dbError) {
            console.error('Failed to update project status:', dbError)
          }
          
          sendEvent({
            type: 'error',
            projectId: project.id,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
            stage: 'failed'
          })
        } finally {
          // Clean up heartbeat
          clearInterval(heartbeat)
        }

        controller.close()
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    })

  } catch (error) {
    console.error('❌ Request processing error:', error)
    if (isDev) {
      console.error('❌ Error type:', typeof error)
      console.error('❌ Error constructor:', error?.constructor?.name)
    }
    
    // Enhanced error serialization with Object.getOwnPropertyNames
    let errorMessage = 'Internal server error'
    let errorDetails: Record<string, unknown> | undefined = undefined
    
    if (error instanceof Error) {
      errorMessage = error.message || error.name || 'Unknown Error instance'
      if (isDev) {
        errorDetails = JSON.parse(JSON.stringify(error, Object.getOwnPropertyNames(error)))
      }
    } else if (typeof error === 'string') {
      errorMessage = error
    } else if (error && typeof error === 'object') {
      // Enhanced object error serialization 
      const errorObj = error as Record<string, unknown>
      errorMessage = String(errorObj.message || errorObj.error || error) || 'Unknown object error'
      
      if (isDev) {
        try {
          errorDetails = JSON.parse(JSON.stringify(error, Object.getOwnPropertyNames(error)))
        } catch {
          errorDetails = {
            type: typeof error,
            stringified: 'Could not stringify',
            toString_result: String(error)
          }
        }
      }
    } else {
      errorMessage = `Unexpected error type: ${typeof error}`
      if (isDev) {
        errorDetails = {
          type: typeof error,
          value: String(error)
        }
      }
    }
    
    const responseData = { 
      error: errorMessage,
      details: errorDetails,
      timestamp: new Date().toISOString()
    }
    
    if (isDev) console.error('❌ Sending error response:', JSON.stringify(responseData, null, 2))
    
    return new Response(
      JSON.stringify(responseData), 
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
} 