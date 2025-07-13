import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createResearchProject } from '@/lib/db/research'
import { generateDraftWithRAG } from '@/lib/generation'
import type { GenerationConfig } from '@/types/simplified'
import type { PaperTypeKey } from '@/lib/prompts/types'

// Use Node.js runtime for better DNS resolution and OpenAI SDK compatibility
export const runtime = 'nodejs'

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

// GET - EventSource endpoint for streaming (unified approach)
export async function GET(request: NextRequest) {
  if (isDev) console.log('🚀 Starting unified streaming generation')
  
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
    const length = url.searchParams.get('length') || 'medium'
    const paperType = url.searchParams.get('paperType') || 'researchArticle'
    const backgroundMode = url.searchParams.get('background') === 'true'
    const libraryPaperIds = url.searchParams.get('libraryPaperIds')?.split(',').filter(Boolean) || []

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

    if (isDev) console.log('🎯 Creating research project for unified streaming...')
    console.log('📝 Creating research project for user:', user?.id || 'test')
    console.log('📝 Topic:', topic)
    console.log('📝 Background mode:', backgroundMode)
    
    // Create generation config
    const generationConfig: GenerationConfig = {
      temperature: 0.2,
      max_tokens: 16000,
      stream: true,
      search_parameters: {
        sources: ['arxiv', 'openalex', 'crossref', 'semantic_scholar'],
        limit: 25,
        useSemanticSearch: true,
      },
      library_papers_used: libraryPaperIds,
      paper_settings: {
        length: length as 'short' | 'medium' | 'long',
        paperType: paperType as 'researchArticle' | 'literatureReview' | 'capstoneProject' | 'mastersThesis' | 'phdDissertation',
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

    // 🔧 FIX: Complete Discovery Pipeline BEFORE Streaming
    // Run Discovery → PDF extraction → Embedding → RAG context selection first
    console.log('🔍 Starting complete discovery pipeline before streaming...')
    
    try {
      // Step 1: Complete discovery pipeline
      const { collectPapers } = await import('@/lib/generation/discovery')
      const { ensureBulkContentIngestion, getRelevantChunks } = await import('@/lib/generation/chunks')
      const { generateOutline } = await import('@/lib/prompts/generators')
      const { buildSectionContexts } = await import('@/lib/generation/helpers')
      
      const discoveryOptions: import('@/lib/generation/types').EnhancedGenerationOptions = {
        projectId: project.id,
        userId: user?.id || 'test-user',
        topic,
        paperType: paperType as import('@/lib/prompts/types').PaperTypeKey,
        libraryPaperIds,
        sourceIds: libraryPaperIds,
        useLibraryOnly,
        config: generationConfig
      }

      console.log('📋 Step 1: Collecting papers...')
      const allPapers = await collectPapers(discoveryOptions)
      
      if (allPapers.length === 0) {
        throw new Error('No papers found for the given topic')
      }
      
      console.log(`✅ Discovery complete: ${allPapers.length} papers collected`)

      console.log('📄 Step 2: Ensuring content ingestion...')
      await ensureBulkContentIngestion(allPapers)
      console.log('✅ Content ingestion complete')

      console.log('🧠 Step 3: Building RAG context...')
      const chunkLimit = Math.max(
        10 * allPapers.length, // 10 chunks per paper
        100 // Minimum baseline
      )
      
      await getRelevantChunks(
        topic,
        allPapers.map(p => p.id),
        chunkLimit,
        allPapers
      )
      console.log('✅ RAG context selection complete')

      console.log('📋 Step 4: Generating outline...')
      const outline = await generateOutline(
        generationConfig.paper_settings?.paperType || 'researchArticle',
        topic
      )
      
      // Assign all papers to sections
      const allPaperIds = allPapers.map(p => p.id)
      outline.sections.forEach((section: any) => {
        section.candidatePaperIds = allPaperIds
      })
      
      console.log('📋 Step 5: Building section contexts...')
      const sectionContexts = await buildSectionContexts({
        ...outline,
        paperType: generationConfig.paper_settings?.paperType || 'researchArticle',
        topic
      }, topic, allPapers)
      
      console.log('✅ Complete discovery pipeline finished - starting stream with prepared context')
      
      // Now create the streaming response with prepared context
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        async start(controller) {
          let isControllerClosed = false
          
          // Helper function to send progress events
          const sendProgress = (stage: string, progress: number, message: string, content?: string) => {
            if (isControllerClosed) return
            
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
            // Send discovery completion status (context already prepared)
            sendStatus('discovery_complete', { 
              projectId: project.id,
              papersFound: allPapers.length,
              sectionsPlanned: sectionContexts.length
            })

            if (backgroundMode) {
              // Background mode: Start content generation with prepared context
              sendStatus('queued', { 
                projectId: project.id,
                message: 'Context prepared - generation queued for background processing'
              })
              
              // Start background processing with prepared context (don't await)
              void generateDraftWithRAG({
                projectId: project.id,
                userId: user?.id || 'test-user',
                topic,
                paperType: paperType as import('@/lib/prompts/types').PaperTypeKey,
                sourceIds: libraryPaperIds,
                useLibraryOnly,
                config: generationConfig,
                onProgress: (progress: import('@/types/simplified').GenerationProgress) => {
                  // In background mode, progress is stored in DB rather than streamed
                  console.log(`Background progress [${project.id}]:`, progress.stage, progress.progress)
                }
              }).catch((error: Error) => {
                console.error('Background generation failed:', error)
              })
              
              // Close stream after sending jobId
              sendStatus('background_started', {
                projectId: project.id,
                message: 'Check /api/projects/' + project.id + ' for status updates'
              })
              
            } else {
              // Real-time mode: Stream content generation with prepared context
              const result = await generateDraftWithRAG({
                projectId: project.id,
                userId: user?.id || 'test-user',
                topic,
                paperType: paperType as import('@/lib/prompts/types').PaperTypeKey,
                sourceIds: libraryPaperIds,
                useLibraryOnly,
                config: generationConfig,
                onProgress: (progress: import('@/types/simplified').GenerationProgress) => {
                  sendProgress(progress.stage, progress.progress, progress.message, progress.content)
                }
              })

              // Send final completion with full content
              if (!isControllerClosed) {
                const citationsMapObject = Object.fromEntries(result.citationsMap)
                
                const completionData = JSON.stringify({
                  type: 'complete',
                  projectId: project.id,
                  content: result.content,
                  citations: citationsMapObject,
                  timestamp: new Date().toISOString()
                })
                controller.enqueue(encoder.encode(`data: ${completionData}\n\n`))
              }
            }

          } catch (error) {
            console.error('Content generation error:', error)
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
            sendError(`Content generation failed: ${errorMessage}`)
          } finally {
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
          'Access-Control-Allow-Headers': 'Cache-Control',
          'X-Accel-Buffering': 'no' // Disable Nginx buffering
        }
      })
      
    } catch (discoveryError) {
      console.error('Discovery pipeline failed:', discoveryError)
      
      // Create error stream if discovery fails
      const encoder = new TextEncoder()
      const errorStream = new ReadableStream({
        start(controller) {
          const errorData = JSON.stringify({
            type: 'error',
            error: `Discovery failed: ${discoveryError instanceof Error ? discoveryError.message : 'Unknown error'}`,
            timestamp: new Date().toISOString()
          })
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`))
          controller.close()
        }
      })
      
      return new Response(errorStream, {
        status: 500,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Cache-Control',
          'X-Accel-Buffering': 'no' // Disable Nginx buffering
        }
      })
    }

  } catch (error) {
    console.error('Error in unified generate endpoint:', error)
    return new Response(
      JSON.stringify({ 
        type: 'error',
        error: error instanceof Error ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      }), 
      { 
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    )
  }
}

// POST - Legacy support for non-streaming clients (redirects to streaming)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { topic, libraryPaperIds, useLibraryOnly, config } = body

    if (!topic?.trim()) {
      return new Response(JSON.stringify({ error: 'Topic is required' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Build URL for streaming endpoint
    const params = new URLSearchParams({
      topic: topic.trim(),
      background: 'true' // Force background mode for POST requests
    })
    
    if (libraryPaperIds?.length) {
      params.set('libraryPaperIds', libraryPaperIds.join(','))
    }
    
    if (useLibraryOnly) params.set('useLibraryOnly', 'true')
    if (config?.length) params.set('length', config.length)
    if (config?.paperType) params.set('paperType', config.paperType)

    const streamUrl = `/api/generate?${params.toString()}`
    
    return new Response(JSON.stringify({
      message: 'Generation started in background mode',
      streamUrl,
      note: 'Connect to the streamUrl via EventSource for real-time updates'
    }), {
      status: 202, // Accepted
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error in generate POST API:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
} 