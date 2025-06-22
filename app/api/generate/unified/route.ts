import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateWithUnifiedTemplate } from '@/lib/generation/unified-generator'
import type { SectionContext } from '@/lib/prompts/unified/prompt-builder'

// Command to section mapping - this could be made more flexible
const COMMAND_SECTION_MAP = {
  write: 'introduction',
  rewrite: 'discussion', 
  cite: 'references',
  outline: 'structure'
} as const

/**
 * Unified Generation API - Single endpoint for all content generation levels 
 * 
 * Supports:
 * - Full section generation
 * - Block-level rewrites  
 * - Sentence-level edits
 * - Multi-section batch processing
 * 
 * All using the same underlying skeleton template with contextual data
 */

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get user - this could be optimized with signed cookies for streaming
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const body = await request.json()
    const { 
      command, 
      projectId, 
      selectedText, 
      sectionKey = COMMAND_SECTION_MAP[command as keyof typeof COMMAND_SECTION_MAP] || 'general'
    } = body

    if (!command || !projectId) {
      return new NextResponse('Missing required fields', { status: 400 })
    }

    // Create a streaming response with proper headers for Safari compatibility
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Generate unique block ID using crypto
          const blockId = crypto.randomUUID()

          // Build section context for unified generator
          const sectionContext: SectionContext = {
            projectId,
            sectionId: blockId,
            paperType: 'researchArticle',
            sectionKey,
            availablePapers: [],
            contextChunks: selectedText ? [{
              paper_id: 'current_selection',
              content: selectedText,
              title: 'Selected Text'
            }] : []
          }

          // Generate content using the unified generator
          const result = await generateWithUnifiedTemplate({
            context: sectionContext,
            options: {
              targetWords: command === 'cite' ? 100 : command === 'outline' ? 200 : 300,
              sentenceMode: command === 'cite',
              forceRewrite: command === 'rewrite'
            },
            onProgress: (stage: string, progress: number, message: string) => {
              controller.enqueue(
                encoder.encode(JSON.stringify({ 
                  type: 'progress',
                  stage,
                  progress,
                  message
                }) + '\n')
              )
            }
          })

          // Stream the final content
          controller.enqueue(
            encoder.encode(JSON.stringify({ 
              type: 'content', 
              content: result.content,
              blockId 
            }) + '\n')
          )

          // Store block in database
          await supabase
            .from('blocks')
            .upsert({
              id: blockId,
              document_id: projectId,
              type: command === 'outline' ? 'heading' : 'paragraph',
              content: {
                type: command === 'outline' ? 'heading' : 'paragraph',
                attrs: command === 'outline' ? { level: 2 } : {},
                content: [{ type: 'text', text: result.content }]
              },
              position: Date.now(),
              metadata: {
                command,
                generatedAt: new Date().toISOString(),
                wordCount: result.wordCount
              }
            })

          controller.enqueue(
            encoder.encode(JSON.stringify({ 
              type: 'complete',
              blockId,
              message: 'Content generated successfully'
            }) + '\n')
          )

        } catch (error) {
          console.error('Generation error:', error)
          controller.enqueue(
            encoder.encode(JSON.stringify({ 
              type: 'error', 
              message: error instanceof Error ? error.message : 'Generation failed' 
            }) + '\n')
          )
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
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })

  } catch (error) {
    console.error('API error:', error)
    return new NextResponse(
      JSON.stringify({ error: 'Internal server error' }), 
      { 
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '60' // Add retry header for rate limit cases
        }
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