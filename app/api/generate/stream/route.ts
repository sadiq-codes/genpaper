import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createResearchProject } from '@/lib/db/research'
import { generateDraftWithRAG } from '@/lib/ai/enhanced-generation'
import type { GenerationConfig } from '@/types/simplified'

// Use Node.js runtime for better DNS resolution and OpenAI SDK compatibility
export const runtime = 'edge'

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
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  })
}

// GET - EventSource endpoint for streaming (Task 5 requirement)
export async function GET(request: NextRequest) {
  if (isDev) console.log('🚀 Starting GET /api/generate/stream (AI SDK Streaming)')
  
  let supabase
  
  try {
    // Create Supabase client that can read cookies
    supabase = await createClient()
    
    // Check authentication - EventSource sends cookies automatically
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      // For development, allow bypass with a test parameter
      const url = new URL(request.url)
      const isTest = url.searchParams.get('test') === 'true' && isDev
      
      if (!isTest) {
        if (isDev) console.log('❌ Authentication failed:', authError?.message || 'No user')
        return new Response('Unauthorized. Please log in to use this feature.', { 
          status: 401,
          headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
          }
        })
      } else {
        if (isDev) console.log('🧪 Test mode: bypassing authentication')
      }
    } else {
      if (isDev) console.log('✅ User authenticated:', user.id)
    }

    // Get query parameters for the generation request
    const url = new URL(request.url)
    const topic = url.searchParams.get('topic')
    const useLibraryOnly = url.searchParams.get('useLibraryOnly') === 'true'
    const forceIngest = url.searchParams.get('forceIngest') === 'true'
    const length = url.searchParams.get('length') || 'medium'
    const style = url.searchParams.get('style') || 'academic'
    const citationStyle = url.searchParams.get('citationStyle') || 'apa'
    const includeMethodology = url.searchParams.get('includeMethodology') === 'true'

    if (!topic) {
      return new Response(
        JSON.stringify({ error: 'Topic parameter is required' }), 
        { 
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      )
    }

    if (isDev) console.log('🎯 Creating research project for AI SDK streaming...')
    console.log('📝 Creating research project for user:', user?.id || 'test')
    console.log('📝 Topic:', topic)
    
    // Create generation config
    const generationConfig: GenerationConfig = {
      temperature: 0.7,
      max_tokens: 16000,
      stream: true,
      search_parameters: {
        sources: ['arxiv', 'openalex', 'crossref', 'semantic_scholar'],
        limit: 25,
        useSemanticSearch: true,
        forceIngest
      },
      library_papers_used: [],
      paper_settings: {
        length: length as 'short' | 'medium' | 'long',
        style: style as 'academic' | 'review' | 'survey',
        citationStyle: citationStyle as 'apa' | 'mla' | 'chicago',
        includeMethodology
      }
    }

    console.log('📝 Config:', generationConfig)

    // Create research project (skip in test mode)
    let project: { id: string } = { id: 'test-project' }
    if (user) {
      project = await createResearchProject(user.id, topic, generationConfig)
      console.log('✅ Research project created successfully:', project.id)
      if (isDev) console.log('✅ Research project created:', project.id)
    }

    // Set up streaming response with custom headers
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let isControllerClosed = false
        
        // Helper function to send progress events
        const sendProgress = (stage: string, progress: number, message: string, content?: string) => {
          if (isControllerClosed) return // Prevent writing to closed controller
          
          try {
            const data = JSON.stringify({
              type: 'progress',
              stage,
              progress,
              message,
              content,
              timestamp: new Date().toISOString()
            })
            controller.enqueue(encoder.encode(`data: ${data}\n\n`))
          } catch (error) {
            console.warn('Failed to send progress:', error)
            isControllerClosed = true
          }
        }

        // Helper function to send status events
        const sendStatus = (status: string, data?: Record<string, unknown>) => {
          if (isControllerClosed) return
          
          try {
            const statusData = JSON.stringify({
              type: 'status',
              status,
              projectId: project.id,
              data,
              timestamp: new Date().toISOString()
            })
            controller.enqueue(encoder.encode(`data: ${statusData}\n\n`))
          } catch (error) {
            console.warn('Failed to send status:', error)
            isControllerClosed = true
          }
        }

        // Helper function to send error events
        const sendError = (error: string) => {
          if (isControllerClosed) return
          
          try {
            const errorData = JSON.stringify({
              type: 'error',
              error,
              timestamp: new Date().toISOString()
            })
            controller.enqueue(encoder.encode(`data: ${errorData}\n\n`))
          } catch (error) {
            console.warn('Failed to send error:', error)
          } finally {
            isControllerClosed = true
          }
        }

        try {
          // Send initial status with projectId
          sendStatus('started', { projectId: project.id })

          // Use the enhanced generation function with progress callback
          const result = await generateDraftWithRAG({
            projectId: project.id,
            userId: user?.id || 'test-user',
            topic,
            useLibraryOnly,
            config: generationConfig,
            onProgress: (progress) => {
              sendProgress(progress.stage, progress.progress, progress.message, progress.content)
            }
          })

          // Send final completion with full content
          if (!isControllerClosed) {
            const completionData = JSON.stringify({
              type: 'complete',
              projectId: project.id,
              content: result.content,
              citations: result.citations,
              wordCount: result.wordCount,
              sources: result.sources,
              timestamp: new Date().toISOString()
            })
            controller.enqueue(encoder.encode(`data: ${completionData}\n\n`))
          }

        } catch (error) {
          console.error('❌ Enhanced generation error:', error)
          sendError(error instanceof Error ? error.message : 'Unknown error occurred')
        } finally {
          if (!isControllerClosed) {
            controller.close()
            isControllerClosed = true
          }
        }
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
    console.error('❌ AI SDK streaming error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}

// POST - Start generation and return streaming response (keeping existing functionality)
export async function POST(request: NextRequest) {
  if (isDev) console.log('🚀 Starting POST /api/generate/stream')
  
  const body = await request.json()
  const { topic, useLibraryOnly, forceIngest, length, style, citationStyle, includeMethodology } = body
  
  // Create a new request with query parameters for the GET handler
  const url = new URL(request.url)
  if (topic) url.searchParams.set('topic', topic)
  // Properly preserve boolean parameters even when false
  if (typeof useLibraryOnly === 'boolean') url.searchParams.set('useLibraryOnly', String(useLibraryOnly))
  if (typeof forceIngest === 'boolean') url.searchParams.set('forceIngest', String(forceIngest))
  if (length) url.searchParams.set('length', length)
  if (style) url.searchParams.set('style', style)
  if (citationStyle) url.searchParams.set('citationStyle', citationStyle)
  if (typeof includeMethodology === 'boolean') url.searchParams.set('includeMethodology', String(includeMethodology))
  
  // Create a new request object with the updated URL
  const newRequest = new NextRequest(url, {
    method: 'GET',
    headers: request.headers
  })
  
  // Call the GET handler directly
  return await GET(newRequest)
} 