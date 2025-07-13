import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateWithUnifiedTemplate, StreamEvent } from '@/lib/generation/unified-generator'
import {
  executeAddCitation,
  runWithCitationContext,
  type CitationContext,
  type CitationPayload,
} from '@/lib/ai/tools/addCitation'
import type { SectionContext } from '@/lib/prompts/unified/prompt-builder'

/**
 * Unified Generation API - Single endpoint for all content generation levels 
 * 
 * Streams sentences and citations for a given prompt.
 */

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const body = await request.json()
    const { 
      projectId, 
      sectionKey = 'introduction',
      paperType = 'researchArticle',
      topic,
      selectedText
    } = body

    if (!projectId || !topic) {
      return new NextResponse('Missing required fields: projectId and topic are required.', { status: 400 })
    }
    
    // Fetch project details for citation style
    const { data: project, error: projectError } = await supabase
        .from('research_projects')
        .select('citation_style')
        .eq('id', projectId)
        .single()

    if (projectError) throw projectError

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        
        const writer = (event: StreamEvent) => {
            controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
        }

        let fullContent = ''

        try {
          const sectionContext: SectionContext = {
            projectId,
            sectionId: crypto.randomUUID(),
            paperType,
            sectionKey,
            availablePapers: [], // This should be populated based on user's library/sources
            contextChunks: selectedText ? [{
              paper_id: 'current_selection',
              content: selectedText,
              title: 'Selected Text'
            }] : []
          }

          const citationContext: Omit<CitationContext, 'draftStore'> = {
              projectId,
              userId: user.id,
              citationStyle: project?.citation_style || 'apa'
          }

          await generateWithUnifiedTemplate({
            context: sectionContext,
            options: {
              targetWords: 300
            },
            onStreamEvent: async (event) => {
              writer(event) // forward progress and errors to client
              if (event.type === 'sentence') {
                fullContent += event.data.text
              } else if (event.type === 'citation') {
                const citationResult = await runWithCitationContext(citationContext, () => executeAddCitation(event.data.args as CitationPayload))
                if (citationResult.success && citationResult.formatted_citation) {
                    const citationText = ` ${citationResult.formatted_citation} `
                    fullContent += citationText
                    writer({ type: 'sentence', data: { text: citationText }})
                }
              }
            }
          })

          // After generation, save the full content to the project
          const { error: updateError } = await supabase
            .from('research_projects')
            .update({ 
                content: fullContent,
                status: 'complete',
                completed_at: new Date().toISOString() 
            })
            .eq('id', projectId)

          if (updateError) {
              console.error('Failed to save full content:', updateError)
              writer({ type: 'error', data: { message: `Failed to save content: ${updateError.message}` }})
          }

          writer({ type: 'progress', data: { stage: 'complete', progress: 100, message: 'Content saved successfully' }})

        } catch (error) {
          console.error('Generation error:', error)
          writer({ type: 'error', data: { message: error instanceof Error ? error.message : 'Generation failed' }})
        } finally {
          controller.close()
        }
      }
    })

    return new NextResponse(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      },
    })

  } catch (error) {
    console.error('API error:', error)
    return new NextResponse(
      JSON.stringify({ error: 'Internal server error' }), 
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
}

/**
 * GET endpoint for testing the unified approach
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const demo = searchParams.get('demo')
  
  if (demo === 'examples') {
    // Return example usage patterns
    return NextResponse.json({
      examples: {
        full_section: {
          action: 'generate',
          context: {
            projectId: 'proj-123',
            sectionId: 'results-001',
            paperType: 'researchArticle',
            sectionKey: 'results',
            availablePapers: ['paper1', 'paper2'],
            contextChunks: [
              { paper_id: 'paper1', content: 'Statistical analysis showed...' }
            ]
          },
          options: { targetWords: 1000 }
        },
        
        block_rewrite: {
          action: 'rewrite',
          context: {
            projectId: 'proj-123',
            sectionId: 'methods-001',
            blockId: 'block-456',
            paperType: 'researchArticle',
            sectionKey: 'methodology',
            availablePapers: ['paper1', 'paper2'],
            contextChunks: [
              { paper_id: 'paper1', content: 'Methodology details...' }
            ]
          },
          options: { forceRewrite: true }
        },
        
        sentence_edit: {
          action: 'edit',
          context: {
            projectId: 'proj-123',
            sectionId: 'discussion-001',
            blockId: 'block-789',
            paperType: 'researchArticle', 
            sectionKey: 'discussion',
            availablePapers: ['paper1'],
            contextChunks: [
              { paper_id: 'paper1', content: 'Discussion points...' }
            ]
          },
          options: { sentenceMode: true, targetWords: 30 }
        },
        
        batch_generation: {
          action: 'batch',
          batch_contexts: [
            // Multiple section contexts...
          ],
          options: { targetWords: 800 }
        }
      },
      
      benefits: {
        unified_template: 'Single YAML skeleton adapts to any content level',
        coherence: 'Rolling summaries maintain document coherence',
        scalability: 'Same system works for sentences, blocks, sections, or papers',
        maintainability: 'Change style in one place, affects all generations',
        quality: 'Consistent reflection and drift detection across all levels'
      }
    })
  }
  
  return NextResponse.json({
    message: 'Unified Generation API',
    description: 'Single endpoint for all content generation using unified skeleton template',
    supported_actions: ['generate', 'rewrite', 'edit', 'batch'],
    examples_url: '/api/generate/unified?demo=examples'
  })
}

/**
 * Example usage from frontend:
 * 
 * // Full section generation
 * const response = await fetch('/api/generate/unified', {
 *   method: 'POST',
 *   body: JSON.stringify({
 *     action: 'generate',
 *     context: { ... },
 *     options: { targetWords: 1000 }
 *   })
 * })
 * 
 * // Block rewrite
 * const response = await fetch('/api/generate/unified', {
 *   method: 'POST', 
 *   body: JSON.stringify({
 *     action: 'rewrite',
 *     context: { ..., blockId: 'block-123' },
 *     options: { forceRewrite: true }
 *   })
 * })
 * 
 * // Sentence edit
 * const response = await fetch('/api/generate/unified', {
 *   method: 'POST',
 *   body: JSON.stringify({
 *     action: 'edit', 
 *     context: { ..., blockId: 'block-123' },
 *     options: { sentenceMode: true, targetWords: 25 }
 *   })
 * })
 */ 