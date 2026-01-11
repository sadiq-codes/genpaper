import { NextRequest } from 'next/server'
import { authenticateUser, createProject } from '@/lib/services/project-service'
import { getResearchProject, getProjectWithContent } from '@/lib/db/research'
import { generatePaper, type PipelineConfig } from '@/lib/generation/pipeline'
import { acquireGenerationLock, releaseGenerationLock } from '@/lib/locks/generation-lock'
import { warn, error as logError } from '@/lib/utils/logger'

// Use Node.js runtime for better DNS resolution and OpenAI SDK compatibility
export const runtime = 'nodejs'

// Fail fast on missing environment variables
if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY environment variable is required')
}

const isDev = process.env.NODE_ENV !== 'production'

// Get allowed origins from environment or default to same-origin only
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || []

function getCorsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get('origin')
  
  // In development, allow localhost origins
  if (isDev && origin?.includes('localhost')) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true'
    }
  }
  
  // In production, only allow configured origins
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true'
    }
  }
  
  // Same-origin requests (no Origin header) are always allowed
  return {}
}

function getStreamHeaders(request: NextRequest): Record<string, string> {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...getCorsHeaders(request)
  }
}

/**
 * Helper function to create error stream for streaming endpoints
 */
function createErrorStream(error: string, request: NextRequest): Response {
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
    headers: getStreamHeaders(request)
  })
}

export async function OPTIONS(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request)
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept, Cache-Control',
      'Access-Control-Max-Age': '86400',
      ...corsHeaders
    }
  })
}

// GET - EventSource endpoint for streaming (thin wrapper around pipeline)
export async function GET(request: NextRequest) {
  if (isDev) {
    console.log('Starting paper generation via pipeline')
  }
  
  let lockId: string | undefined
  let projectId: string | undefined
  
  try {
    // Authenticate user
    const user = await authenticateUser()
    if (!user) {
      warn('Authentication failed for EventSource request')
      return createErrorStream('Authentication required. Please refresh the page and try again.', request)
    }

    // Parse query parameters
    const url = new URL(request.url)
    const topic = url.searchParams.get('topic')
    const useLibraryOnly = url.searchParams.get('useLibraryOnly') === 'true'
    const length = url.searchParams.get('length') || 'medium'
    const paperTypeParam = url.searchParams.get('paperType')
    const paperType = paperTypeParam || 'literatureReview'
    const libraryPaperIds = url.searchParams.get('libraryPaperIds')?.split(',').filter(Boolean) || []
    const existingProjectId = url.searchParams.get('projectId') || undefined
    const temperature = parseFloat(url.searchParams.get('temperature') || '0.2')
    const maxTokens = parseInt(url.searchParams.get('maxTokens') || '16000')
    
    if (!paperTypeParam) {
      console.warn('⚠️ paperType URL param missing! Defaulting to literatureReview')
    }
    
    console.log('🔍 Generate API received paperType:', paperType, 
      paperTypeParam ? '(from URL)' : '(DEFAULT - URL param was missing!)')

    if (!topic) {
      return new Response(
        JSON.stringify({ error: 'Topic parameter is required' }), 
        { 
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...getCorsHeaders(request)
          }
        }
      )
    }

    // Use existing project or create new one
    let project: { id: string }
    if (existingProjectId) {
      const existing = await getResearchProject(existingProjectId, user.id)
      if (!existing) {
        return createErrorStream('Project not found or access denied', request)
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
            headers: getStreamHeaders(request)
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
    
    projectId = project.id

    // Acquire distributed lock to prevent duplicate concurrent runs
    const lockResult = await acquireGenerationLock(project.id)
    if (!lockResult.acquired) {
      warn('Generation already in progress', { projectId: project.id })
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
        headers: getStreamHeaders(request)
      })
    }
    
    lockId = lockResult.lockId

    // Build pipeline config
    const pipelineConfig: PipelineConfig = {
      topic,
      paperType: paperType as PipelineConfig['paperType'],
      length: length as 'short' | 'medium' | 'long',
      useLibraryOnly,
      libraryPaperIds,
      sources: ['arxiv', 'openalex', 'crossref', 'semantic_scholar'],
      temperature,
      maxTokens
    }

    // Capture lockId and projectId for cleanup in closure
    const capturedLockId = lockId
    const capturedProjectId = project.id

    // Create streaming response
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let isControllerClosed = false
        let heartbeatInterval: ReturnType<typeof setInterval> | null = null
        
        // Heartbeat to keep proxies from buffering the stream
        heartbeatInterval = setInterval(() => {
          if (isControllerClosed) {
            if (heartbeatInterval) clearInterval(heartbeatInterval)
            return
          }
          try {
            controller.enqueue(encoder.encode(`: keep-alive\n\n`))
          } catch {
            isControllerClosed = true
            if (heartbeatInterval) clearInterval(heartbeatInterval)
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
        } catch (err) {
          warn('Failed to send start event', { error: err })
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
          } catch (err) {
            warn('Failed to send progress', { error: err })
            isControllerClosed = true
          }
        }

        try {
          // Call the pipeline orchestrator
          const result = await generatePaper(
            pipelineConfig,
            capturedProjectId,
            user.id,
            onProgress,
            url.origin
          )

          // Send completion
          if (!isControllerClosed) {
            const completionData = JSON.stringify({
              type: 'complete',
              projectId: capturedProjectId,
              content: result.content,
              citations: result.citations,
              metrics: result.metrics,
              timestamp: new Date().toISOString()
            })
            controller.enqueue(encoder.encode(`data: ${completionData}\n\n`))
          }
        } catch (err) {
          logError('Pipeline error', { error: err, projectId: capturedProjectId })
          if (!isControllerClosed) {
            const errorData = JSON.stringify({
              type: 'error',
              error: err instanceof Error ? err.message : 'Generation failed',
              timestamp: new Date().toISOString()
            })
            controller.enqueue(encoder.encode(`data: ${errorData}\n\n`))
          }
        } finally {
          // Always release the lock and clean up
          if (capturedLockId) {
            await releaseGenerationLock(capturedProjectId, capturedLockId)
          }
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval)
          }
          if (!isControllerClosed) {
            controller.close()
          }
        }
      }
    })
    
    return new Response(stream, {
      status: 200,
      headers: getStreamHeaders(request)
    })

  } catch (err) {
    logError('Route error', { error: err })
    // Clean up lock if we acquired it but failed before streaming started
    if (lockId && projectId) {
      await releaseGenerationLock(projectId, lockId)
    }
    return createErrorStream(err instanceof Error ? err.message : 'Internal server error', request)
  }
}
