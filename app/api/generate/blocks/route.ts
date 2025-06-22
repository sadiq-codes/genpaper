import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateSectionsAsBlocks } from '@/lib/generation/block-runner'
import { collectPapers } from '@/lib/generation/discovery'
import { ensureChunksForPapers, getRelevantChunks } from '@/lib/generation/chunks'
import { generateOutline } from '@/lib/prompts/generators'
import { mergeWithDefaults } from '@/lib/generation/config'
import type { EnhancedGenerationOptions } from '@/lib/generation/types'
import type { SectionContext } from '@/lib/prompts/types'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { topic, libraryPaperIds = [], useLibraryOnly = false, config: rawConfig } = body

    if (!topic?.trim()) {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 })
    }

    const config = mergeWithDefaults(rawConfig)

    // Create research project first
    const { data: project, error: projectError } = await supabase
      .from('research_projects')
      .insert({
        user_id: user.id,
        topic: topic.trim(),
        status: 'generating',
        generation_config: {
          ...config,
          paper_settings: {
            ...config.paper_settings,
            length: config.paper_settings?.length || 'medium',
            paperType: config.paper_settings?.paperType || 'researchArticle',
            useLibraryOnly,
            selectedPaperIds: libraryPaperIds
          }
        }
      })
      .select()
      .single()

    if (projectError || !project) {
      console.error('Failed to create project:', projectError)
      return NextResponse.json({ error: 'Failed to create project' }, { status: 500 })
    }

    // Create document for this project
    const { data: document, error: docError } = await supabase
      .from('documents')
      .insert({
        project_id: project.id,
        title: topic.trim(),
        user_id: user.id
      })
      .select()
      .single()

    if (docError || !document) {
      console.error('Failed to create document:', docError)
      return NextResponse.json({ error: 'Failed to create document' }, { status: 500 })
    }

    console.log(`🔧 Starting block-based generation for project ${project.id}`)

    // Set up streaming response
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Step 1: Collect papers
          const options: EnhancedGenerationOptions = {
            projectId: project.id,
            userId: user.id,
            topic: topic.trim(),
            libraryPaperIds,
            useLibraryOnly,
            config
          }

          const allPapers = await collectPapers(options)
          
          // Send progress update
          controller.enqueue(encoder.encode(JSON.stringify({
            type: 'progress',
            progress: 20,
            message: `Found ${allPapers.length} papers`
          }) + '\n'))

          // Step 2: Ensure chunks and generate outline
          await ensureChunksForPapers(allPapers)
          
          const outline = await generateOutline(
            config.paper_settings?.paperType || 'researchArticle',
            topic.trim(),
            allPapers.map(p => p.id)
          )

          controller.enqueue(encoder.encode(JSON.stringify({
            type: 'progress',
            progress: 40,
            message: `Generated outline with ${outline.sections.length} sections`
          }) + '\n'))

          // Step 3: Build section contexts
          const sectionContexts: SectionContext[] = []
          const chunkCache = new Map<string, Array<{ paper_id: string; content: string; score?: number }>>()
          
          for (const section of outline.sections) {
            const cacheKey = section.candidatePaperIds.sort().join(',')
            
            let contextChunks = chunkCache.get(cacheKey)
            if (!contextChunks) {
              contextChunks = await getRelevantChunks(
                topic.trim(),
                section.candidatePaperIds,
                Math.min(20, section.candidatePaperIds.length * 3)
              )
              chunkCache.set(cacheKey, contextChunks)
            }
            
            sectionContexts.push({
              sectionKey: section.sectionKey,
              title: section.title,
              candidatePaperIds: section.candidatePaperIds,
              contextChunks,
              expectedWords: section.expectedWords
            })
          }

          controller.enqueue(encoder.encode(JSON.stringify({
            type: 'progress',
            progress: 60,
            message: 'Starting section generation...'
          }) + '\n'))

          // Step 4: Generate sections as blocks
          const { blocks, capturedToolCalls } = await generateSectionsAsBlocks(
            document.id,
            topic.trim(),
            sectionContexts,
            allPapers,
            config,
            supabase,
            (progress, message) => {
              controller.enqueue(encoder.encode(JSON.stringify({
                type: 'progress',
                progress: 60 + (progress * 0.35), // 60% to 95%
                message
              }) + '\n'))
            },
            (block) => {
              // Stream each block as it's created
              controller.enqueue(encoder.encode(JSON.stringify({
                type: 'block',
                block
              }) + '\n'))
            }
          )

          // Step 5: Update project status
          await supabase
            .from('research_projects')
            .update({ 
              status: 'completed',
              updated_at: new Date().toISOString()
            })
            .eq('id', project.id)

          // Send completion
          controller.enqueue(encoder.encode(JSON.stringify({
            type: 'complete',
            projectId: project.id,
            documentId: document.id,
            blocksCount: blocks.length,
            toolCallsCount: capturedToolCalls.length
          }) + '\n'))

          controller.close()

        } catch (error) {
          console.error('Block generation error:', error)
          
          // Update project status to failed
          try {
            await supabase
              .from('research_projects')
              .update({ status: 'failed' })
              .eq('id', project.id)
          } catch (updateError) {
            console.error('Failed to update project status:', updateError)
          }

          controller.enqueue(encoder.encode(JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
          }) + '\n'))
          
          controller.close()
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })

  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes 