import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { 
  createResearchProject, 
  updateResearchProjectStatus
} from '@/lib/db/research'
import { generateDraftWithRAG } from '@/lib/ai/enhanced-generation'
import type { 
  GenerateRequest, 
  GenerationConfig
} from '@/types/simplified'

// Fail fast on missing environment variables
if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY environment variable is required')
}

const isDev = process.env.NODE_ENV !== 'production'

interface StreamState {
  isControllerClosed: boolean
  heartbeat: NodeJS.Timeout | null
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  })
}

// GET - EventSource endpoint for streaming (Task 5 requirement)
export async function GET(request: NextRequest) {
  if (isDev) console.log('🚀 Starting GET /api/generate/stream (EventSource)')
  
  let supabase
  
  try {
    supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 })
    }

    // Get query parameters for the generation request
    const url = new URL(request.url)
    const topic = url.searchParams.get('topic')
    const libraryPaperIds = url.searchParams.get('libraryPaperIds')?.split(',').filter(Boolean) || []
    const useLibraryOnly = url.searchParams.get('useLibraryOnly') === 'true'
    const length = url.searchParams.get('length') || 'medium'
    const style = url.searchParams.get('style') || 'academic'
    const citationStyle = url.searchParams.get('citationStyle') || 'apa'
    const includeMethodology = url.searchParams.get('includeMethodology') !== 'false'

    if (!topic?.trim()) {
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
        length: length as 'short' | 'medium' | 'long',
        style: style as 'academic' | 'review' | 'survey',
        citationStyle: citationStyle as 'apa' | 'mla' | 'chicago' | 'ieee',
        includeMethodology
      },
      library_papers_used: libraryPaperIds
    }

    if (isDev) console.log('🎯 Creating research project for EventSource...')
    // Create research project
    const project = await createResearchProject(user.id, topic, generationConfig)
    if (isDev) console.log('✅ Research project created:', project.id)

    // Create EventSource stream
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        const streamState: StreamState = {
          isControllerClosed: false,
          heartbeat: null
        }
        
        // Store cleanup function to be called by cancel
        const cleanup = () => {
          streamState.isControllerClosed = true
          if (streamState.heartbeat) {
            clearInterval(streamState.heartbeat)
            streamState.heartbeat = null
          }
        }
        
        // Add heartbeat to prevent connection timeouts
        streamState.heartbeat = setInterval(() => {
          if (!streamState.isControllerClosed) {
            try {
              sendEvent({ type: 'ping', timestamp: Date.now() })
            } catch {
              cleanup()
            }
          } else {
            if (streamState.heartbeat) clearInterval(streamState.heartbeat)
          }
        }, 25000)
        
        const sendEvent = (data: object) => {
          if (streamState.isControllerClosed) {
            return // Don't try to send if controller is closed
          }
          
          try {
            // More robust controller state checking
            if (controller.desiredSize !== null && !streamState.isControllerClosed) {
              const message = `data: ${JSON.stringify(data)}\n\n`
              controller.enqueue(encoder.encode(message))
            } else {
              // Controller is no longer accepting data
              cleanup()
            }
          } catch (error) {
            // Handle specific controller closed errors
            if (error instanceof TypeError && error.message.includes('Controller is already closed')) {
              cleanup()
              return // Silently ignore closed controller errors
            }
            console.error('Failed to send event:', error)
            cleanup()
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
            message: 'Starting enhanced paper generation with semantic search...'
          })

          // Use the new RAG-powered generation flow
          const result = await generateDraftWithRAG({
            projectId: project.id,
            userId: user.id,
            topic,
            libraryPaperIds,
            useLibraryOnly,
            config: generationConfig,
            onProgress: (progress) => {
              if (!streamState.isControllerClosed) {
                sendEvent({
                  type: 'progress',
                  projectId: project.id,
                  progress: progress.progress,
                  stage: progress.stage,
                  message: progress.message,
                  content: progress.content?.substring(0, 5000)
                })
                
                // Send checkpoint events (Task 5 requirement)
                if (progress.stage === 'complete' || progress.progress % 25 === 0) {
                  sendEvent({
                    type: 'checkpoint',
                    projectId: project.id,
                    stage: progress.stage,
                    progress: progress.progress
                  })
                }
              }
            }
          })

          // Send final completion event
          if (!streamState.isControllerClosed) {
            sendEvent({
              type: 'complete',
              projectId: project.id,
              progress: 100,
              stage: 'complete',
              message: 'Paper generation completed successfully!',
              wordCount: result.wordCount,
              citationCount: result.citations.length,
              sections: result.structure.sections,
              sourcesUsed: result.sources.length
            })
          }

        } catch (error) {
          console.error('RAG generation error:', error)
          
          try {
            await updateResearchProjectStatus(project.id, 'failed')
          } catch (dbError) {
            console.error('Failed to update project status:', dbError)
          }
          
          if (!streamState.isControllerClosed) {
            sendEvent({
              type: 'error',
              projectId: project.id,
              error: error instanceof Error ? error.message : 'Unknown error occurred',
              stage: 'failed'
            })
          }
        } finally {
          cleanup()
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
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    })

  } catch (error) {
    console.error('❌ EventSource request processing error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}

// POST - Start generation and return project ID (keeping existing functionality)
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
        const streamState: StreamState = {
          isControllerClosed: false,
          heartbeat: null
        }
        
        // Store cleanup function to be called by cancel
        const cleanup = () => {
          streamState.isControllerClosed = true
          if (streamState.heartbeat) {
            clearInterval(streamState.heartbeat)
            streamState.heartbeat = null
          }
        }
        
        // Add heartbeat to prevent connection timeouts
        streamState.heartbeat = setInterval(() => {
          if (!streamState.isControllerClosed) {
            try {
              sendEvent({ type: 'ping', timestamp: Date.now() })
            } catch {
              cleanup()
            }
          } else {
            if (streamState.heartbeat) clearInterval(streamState.heartbeat)
          }
        }, 25000)
        
        const sendEvent = (data: object) => {
          if (streamState.isControllerClosed) {
            return // Don't try to send if controller is closed
          }
          
          try {
            // More robust controller state checking
            if (controller.desiredSize !== null && !streamState.isControllerClosed) {
              const message = `data: ${JSON.stringify(data)}\n\n`
              controller.enqueue(encoder.encode(message))
            } else {
              // Controller is no longer accepting data
              cleanup()
            }
          } catch (error) {
            // Handle specific controller closed errors
            if (error instanceof TypeError && error.message.includes('Controller is already closed')) {
              cleanup()
              return // Silently ignore closed controller errors
            }
            console.error('Failed to send event:', error)
            cleanup()
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
            message: 'Starting enhanced paper generation with semantic search...'
          })

          // Use the new RAG-powered generation flow
          const result = await generateDraftWithRAG({
            projectId: project.id,
            userId: user.id,
            topic,
            libraryPaperIds,
            useLibraryOnly,
            config: generationConfig,
            onProgress: (progress) => {
              if (!streamState.isControllerClosed) {
                sendEvent({
                  type: 'progress',
                  projectId: project.id,
                  progress: progress.progress,
                  stage: progress.stage,
                  message: progress.message,
                  content: progress.content?.substring(0, 5000)
                })
              }
            }
          })

          // Send final completion event
          if (!streamState.isControllerClosed) {
            sendEvent({
              type: 'complete',
              projectId: project.id,
              progress: 100,
              stage: 'complete',
              message: 'Paper generation completed successfully!',
              wordCount: result.wordCount,
              citationCount: result.citations.length,
              sections: result.structure.sections,
              sourcesUsed: result.sources.length
            })
          }

        } catch (error) {
          console.error('RAG generation error:', error)
          
          // Update project status to failed
          try {
            await updateResearchProjectStatus(project.id, 'failed')
          } catch (dbError) {
            console.error('Failed to update project status:', dbError)
          }
          
          if (!streamState.isControllerClosed) {
            sendEvent({
              type: 'error',
              projectId: project.id,
              error: error instanceof Error ? error.message : 'Unknown error occurred',
              stage: 'failed'
            })
          }
        } finally {
          cleanup()
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