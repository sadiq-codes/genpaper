import { NextRequest } from 'next/server'
import { authenticateUser, createProject } from '@/lib/services/project-service'
import type { SectionContext } from '@/lib/prompts/types'
import type { GeneratedOutline } from '@/lib/prompts/types'
import type { PaperChunk } from '@/lib/generation/types'
import type { PaperWithAuthors } from '@/types/simplified'

// Use Node.js runtime for better DNS resolution and OpenAI SDK compatibility
export const runtime = 'nodejs'

// Fail fast on missing environment variables
if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY environment variable is required')
}

const isDev = process.env.NODE_ENV !== 'production'

/**
 * Builds the context for each section of the paper, including retrieving relevant
 * chunks of text from source documents.
 */
async function buildSectionContexts(
  outline: GeneratedOutline,
  topic: string,
  allPapers: PaperWithAuthors[] = []
): Promise<SectionContext[]> {
  const sectionContexts: SectionContext[] = []
  const chunkCache = new Map<string, PaperChunk[]>()

  for (const section of outline.sections) {
    const ids = Array.isArray(section.candidatePaperIds) ? section.candidatePaperIds : []
    const cacheKey = ids.slice().sort().join(',')
    let contextChunks = chunkCache.get(cacheKey)

    if (!contextChunks) {
      try {
        const { getRelevantChunks } = await import('@/lib/generation/chunks')
        contextChunks = await getRelevantChunks(
          topic,
          ids,
          Math.min(20, ids.length * 3),
          allPapers
        )
        chunkCache.set(cacheKey, contextChunks)
        console.log(`📄 Cached chunks for section "${section.title}" (${contextChunks.length} chunks)`)
      } catch (error) {
        console.warn(`⚠️ No relevant chunks found for section "${section.title}": ${error}`)
        console.warn(`⚠️ This section may have limited content quality due to lack of relevant source material`)
        contextChunks = []
        chunkCache.set(cacheKey, contextChunks)
      }
    } else {
      console.log(`📄 Using cached chunks for section "${section.title}" (${contextChunks.length} chunks)`)
    }

    sectionContexts.push({
      sectionKey: section.sectionKey,
      title: section.title,
      candidatePaperIds: ids,
      contextChunks,
      expectedWords: section.expectedWords,
    })
  }

  return sectionContexts
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

// GET - EventSource endpoint for streaming (unified approach)
export async function GET(request: NextRequest) {
  if (isDev) console.log('🚀 Starting unified streaming generation')
  
  let user: { id: string }
  
  try {
    // Authenticate user using service layer
    const authenticatedUser = await authenticateUser()
    
    if (!authenticatedUser) {
      if (isDev) {
        console.log('❌ Authentication failed: No user found')
      }
      
      // For streaming endpoints, we need to return a proper event-stream response even for errors
      const encoder = new TextEncoder()
      const errorStream = new ReadableStream({
        start(controller) {
          const errorData = JSON.stringify({
            type: 'error',
            error: 'Authentication required. Please refresh the page and try again.',
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
    } else {
      user = authenticatedUser
      if (isDev) console.log('✅ User authenticated:', user.id)
    }

    // Get query parameters for the generation request
    const url = new URL(request.url)
    const topic = url.searchParams.get('topic')
    const useLibraryOnly = url.searchParams.get('useLibraryOnly') === 'true'
    const length = url.searchParams.get('length') || 'medium'
    const paperType = url.searchParams.get('paperType') || 'researchArticle'
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

    if (isDev) console.log('🎯 Creating research project for streaming generation...')
    console.log('📝 Creating research project for user:', user.id)
    console.log('📝 Topic:', topic)
    
    // Simple generation config - no complex validation or feature flags
    const generationConfig = {
      temperature: 0.2,
      max_tokens: 16000,
      sources: ['arxiv', 'openalex', 'crossref', 'semantic_scholar'],
      limit: 25,
      library_papers_used: libraryPaperIds,
      length: length as 'short' | 'medium' | 'long',
      paperType: paperType as 'researchArticle' | 'literatureReview' | 'capstoneProject' | 'mastersThesis' | 'phdDissertation',
      useLibraryOnly,
      localRegion: undefined // Simple regional support
    }

    console.log('📝 Config:', generationConfig)

    // Create research project using service layer
    const project = await createProject(user.id, topic, generationConfig)
    console.log('✅ Research project created successfully:', project.id)
    if (isDev) console.log('✅ Research project created:', project.id)

    // 🔧 FIX: Complete Discovery Pipeline BEFORE Streaming
    // Run Discovery → PDF extraction → Embedding → RAG context selection first
    console.log('🔍 Starting complete discovery pipeline before streaming...')
    
    try {
      // Step 1: Complete discovery pipeline
      const { collectPapers } = await import('@/lib/generation/discovery')
      const { getRelevantChunks } = await import('@/lib/generation/chunks')
      const { generateOutline } = await import('@/lib/prompts/generators')
      
      const paperType = generationConfig.paperType || 'researchArticle'
      const discoveryOptions: import('@/lib/generation/types').EnhancedGenerationOptions = {
        projectId: project.id,
        userId: user.id,
        topic,
        paperType: paperType as import('@/lib/prompts/types').PaperTypeKey,
        libraryPaperIds,
        sourceIds: libraryPaperIds,
        useLibraryOnly: generationConfig.useLibraryOnly || false,
        config: generationConfig
      }

      console.log('📋 Step 1: Collecting papers...')
      const allPapers = await collectPapers(discoveryOptions)
      
      if (allPapers.length === 0) {
        throw new Error('No papers found for the given topic')
      }
      
      console.log(`✅ Discovery complete: ${allPapers.length} papers collected`)

      console.log('📄 Step 2: Content ingestion handled by discovery pipeline')
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
      const rawOutline = await generateOutline(
        paperType,
        topic
      )
      
      // Build properly typed outline for buildSectionContexts
      const typedOutline: import('@/lib/prompts/types').GeneratedOutline = {
        paperType: paperType as import('@/lib/prompts/types').PaperTypeKey,
        topic,
        sections: rawOutline.sections as import('@/lib/prompts/types').OutlineSection[],
        localRegion: generationConfig.localRegion
      }
      
      // Assign all papers to sections
      const allPaperIds = allPapers.map(p => p.id)
      typedOutline.sections.forEach((section: { candidatePaperIds?: string[] }) => {
        section.candidatePaperIds = allPaperIds
      })
      
      console.log('📋 Step 5: Building section contexts...')
      const rawSectionContexts = await buildSectionContexts(typedOutline, topic, allPapers)
      
      // Convert to unified generator format
      const sectionContexts: import('@/lib/prompts/unified/prompt-builder').SectionContext[] = rawSectionContexts.map((ctx, index) => ({
        projectId: project.id,
        sectionId: `section-${index}`,
        paperType: paperType as import('@/lib/prompts/types').PaperTypeKey,
        sectionKey: ctx.sectionKey as import('@/lib/prompts/types').SectionKey,
        availablePapers: ctx.candidatePaperIds,
        contextChunks: ctx.contextChunks.map(chunk => ({
          paper_id: chunk.paper_id,
          content: chunk.content,
          title: allPapers.find(p => p.id === chunk.paper_id)?.title,
          doi: allPapers.find(p => p.id === chunk.paper_id)?.doi
        }))
      }))
      
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

            // Stream content generation with prepared context
            sendProgress('generation', 30, 'Starting unified content generation...')
            
            try {
              const { generateMultipleSectionsUnified } = await import('@/lib/generation/unified-generator')
              
              console.log(`🚀 Starting unified generation for ${sectionContexts.length} sections`)
              
              let completedSections = 0
              let fullContent = ''
              const allCitations: Array<{ paperId: string; citationText: string }> = []
              
              // Generate all sections using unified template
              const results = await generateMultipleSectionsUnified(
                sectionContexts,
                {
                  temperature: generationConfig.temperature || 0.3,
                  maxTokens: Math.floor((generationConfig.max_tokens || 8000) / sectionContexts.length)
                },
                (completed, total, currentSection) => {
                  const progress = Math.round((completed / total) * 70) + 30 // 30-100%
                  sendProgress('generation', progress, `Generating ${currentSection} (${completed}/${total})`)
                }
              )
              
              // Combine all section results
              for (const result of results) {
                fullContent += result.content + '\n\n'
                allCitations.push(...result.citations)
                completedSections++
              }
              
              console.log(`✅ Generated ${completedSections} sections, ${fullContent.length} chars total`)
              
              // Send final completion with full content
              if (!isControllerClosed) {
                const citationsMap: Record<string, { paperId: string; citationText: string }> = {}
                allCitations.forEach((citation, index) => {
                  citationsMap[`citation-${index}`] = citation
                })
                
                const completionData = JSON.stringify({
                  type: 'complete',
                  projectId: project.id,
                  content: fullContent.trim(),
                  citations: citationsMap,
                  timestamp: new Date().toISOString()
                })
                controller.enqueue(encoder.encode(`data: ${completionData}\n\n`))
              }
              
            } catch (generationError) {
              console.error('Unified generation failed:', generationError)
              sendError(`Generation failed: ${generationError instanceof Error ? generationError.message : 'Unknown error'}`)
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

// POST handler removed - only SSE streaming via GET is supported
// All clients should use EventSource to connect to the GET endpoint 