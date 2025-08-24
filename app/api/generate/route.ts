import { NextRequest } from 'next/server'
import { authenticateUser, createProject } from '@/lib/services/project-service'
import { getResearchProject, getProjectWithContent } from '@/lib/db/research'
import { generatePaper, type PipelineConfig } from '@/lib/generation/pipeline'

// Use Node.js runtime for better DNS resolution and OpenAI SDK compatibility
export const runtime = 'nodejs'

// Fail fast on missing environment variables
if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY environment variable is required')
}

const isDev = process.env.NODE_ENV !== 'production'

// In-memory lock to avoid duplicate pipeline runs per project in dev/single instance
// Not a substitute for distributed locks in production.
const globalAny = globalThis as any
if (!globalAny.__GEN_LOCKS__) {
  globalAny.__GEN_LOCKS__ = new Map<string, boolean>()
}
const GEN_LOCKS: Map<string, boolean> = globalAny.__GEN_LOCKS__

/**
 * Helper function to create error stream for streaming endpoints
 */
function createErrorStream(error: string): Response {
      const encoder = new TextEncoder()
      const errorStream = new ReadableStream({
        start(controller) {
          const errorData = JSON.stringify({
            type: 'error',
        error,
            timestamp: new Date().toISOString()
          })
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`))
          controller.close()
        }
      })
      
      return new Response(errorStream, {
        status: 200, // Return 200 for EventSource to receive the error message
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Cache-Control',
          'X-Accel-Buffering': 'no'
        }
      })
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept, Cache-Control',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400'
    }
  })
}

// GET - EventSource endpoint for streaming (thin wrapper around pipeline)
export async function GET(request: NextRequest) {
  if (isDev) console.log('🚀 Starting paper generation via pipeline')
  if (isDev) console.log('🍪 Request headers:', Object.fromEntries(request.headers.entries()))
  
  try {
    // Authenticate user with enhanced error details
    const user = await authenticateUser()
    if (!user) {
      console.error('❌ Authentication failed for EventSource request')
      console.error('❌ Cookies:', request.headers.get('cookie'))
      return createErrorStream('Authentication required. Please refresh the page and try again.')
    }

    // Parse query parameters
    const url = new URL(request.url)
    const topic = url.searchParams.get('topic')
    const useLibraryOnly = url.searchParams.get('useLibraryOnly') === 'true'
    const length = url.searchParams.get('length') || 'medium'
    const paperType = url.searchParams.get('paperType') || 'researchArticle'
    const libraryPaperIds = url.searchParams.get('libraryPaperIds')?.split(',').filter(Boolean) || []
    const existingProjectId = url.searchParams.get('projectId') || undefined
    const temperature = parseFloat(url.searchParams.get('temperature') || '0.2')
    const maxTokens = parseInt(url.searchParams.get('maxTokens') || '16000')

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

    // Use existing project or create new one
    let project: { id: string }
    if (existingProjectId) {
      const existing = await getResearchProject(existingProjectId, user.id)
      if (!existing) {
        return createErrorStream('Project not found or access denied')
      }

      // Return cached content if project is already complete
      if (existing.status === 'complete') {
        const existingWithContent = await getProjectWithContent(existing.id)
        if (existingWithContent?.content) {
        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          start(controller) {
            const completionData = JSON.stringify({
              type: 'complete',
                projectId: existing.id,
              content: existingWithContent.content,
              timestamp: new Date().toISOString()
            })
            controller.enqueue(encoder.encode(`data: ${completionData}\n\n`))
            controller.close()
          }
        })

        return new Response(stream, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Cache-Control',
            'X-Accel-Buffering': 'no'
          }
        })
        }
      }

      project = { id: existing.id }
    } else {
      // Create new project
      const config = {
        temperature,
        max_tokens: maxTokens,
        sources: ['arxiv', 'openalex', 'crossref', 'semantic_scholar'],
        limit: 25,
        library_papers_used: libraryPaperIds,
        length: length as 'short' | 'medium' | 'long',
        paperType: paperType as 'researchArticle' | 'literatureReview' | 'capstoneProject' | 'mastersThesis' | 'phdDissertation',
        useLibraryOnly,
        localRegion: undefined
      }
      project = await createProject(user.id, topic, config)
    }

    // Prevent duplicate concurrent runs for the same project (best-effort)
    if (GEN_LOCKS.get(project.id)) {
      if (isDev) console.warn('⚠️ Generation already in progress for project', project.id)
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          const msg = JSON.stringify({ type: 'error', error: 'GENERATION_IN_PROGRESS' })
          controller.enqueue(encoder.encode(`data: ${msg}\n\n`))
          controller.close()
        }
      })
      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Cache-Control',
          'X-Accel-Buffering': 'no'
        }
      })
    }
    GEN_LOCKS.set(project.id, true)

    // Build pipeline config
    const pipelineConfig: PipelineConfig = {
        topic,
      paperType: paperType as any,
      length: length as 'short' | 'medium' | 'long',
      useLibraryOnly,
      libraryPaperIds,
      sources: ['arxiv', 'openalex', 'crossref', 'semantic_scholar'],
      temperature,
      maxTokens
    }

    // Create streaming response
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        async start(controller) {
          let isControllerClosed = false
          // Heartbeat to keep proxies from buffering the stream
          const heartbeat = setInterval(() => {
            if (isControllerClosed) return
            try {
              controller.enqueue(encoder.encode(`: keep-alive\n\n`))
            } catch {
              isControllerClosed = true
            }
          }, 15000)

          // Send immediate start event so client sees streaming instantly
          try {
            const startData = JSON.stringify({
              type: 'progress',
              stage: 'start',
              progress: 0,
              message: 'Starting generation...'
            })
            controller.enqueue(encoder.encode(`data: ${startData}\n\n`))
          } catch {
            // ignore
          }
          
        // Progress callback for pipeline
        const onProgress = (stage: string, progress: number, message: string, data?: Record<string, unknown>) => {
            if (isControllerClosed) return
            
            try {
            const progressData = JSON.stringify({
                type: 'progress',
                stage,
                progress,
                message,
              data,
                timestamp: new Date().toISOString()
              })
            controller.enqueue(encoder.encode(`data: ${progressData}\n\n`))
            } catch (error) {
              console.warn('Failed to send progress:', error)
              isControllerClosed = true
            }
          }

        try {
          // Call the pipeline orchestrator
          const result = await generatePaper(
            pipelineConfig,
            project.id,
            user.id,
            onProgress,
            url.origin
          )

          // Send completion
                if (!isControllerClosed) {
                  const completionData = JSON.stringify({
                    type: 'complete',
                    projectId: project.id,
              content: result.content,
              citations: result.citations,
              metrics: result.metrics,
                    timestamp: new Date().toISOString()
                  })
                  controller.enqueue(encoder.encode(`data: ${completionData}\n\n`))
                }
        } catch (error) {
          console.error('Pipeline error:', error)
                if (!isControllerClosed) {
            const errorData = JSON.stringify({
              type: 'error',
              error: error instanceof Error ? error.message : 'Generation failed',
              timestamp: new Date().toISOString()
            })
            controller.enqueue(encoder.encode(`data: ${errorData}\n\n`))
          }
          } finally {
            GEN_LOCKS.delete(project.id)
            clearInterval(heartbeat)
            if (!isControllerClosed) {
              controller.close()
            }
          }
        }
      })
      
      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Cache-Control, Accept',
          'Access-Control-Allow-Credentials': 'true',
          'X-Accel-Buffering': 'no'
        }
      })

  } catch (error) {
    console.error('Route error:', error)
    return createErrorStream(error instanceof Error ? error.message : 'Internal server error')
  }
}

// POST handler removed - only SSE streaming via GET is supported
// All clients should use EventSource to connect to the GET endpoint 
