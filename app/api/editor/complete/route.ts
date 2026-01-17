import { createClient } from '@/lib/supabase/server'
import { getAutocompleteLanguageModel } from '@/lib/ai/vercel-client'
import { streamText } from 'ai'
import { NextRequest, NextResponse } from 'next/server'
import { 
  retrieveEditorContext, 
  formatEditorContextForPrompt, 
  type EditorContext 
} from '@/lib/rag'
import {
  processCitationMarkersSync,
  type PaperMetadata,
  type CitationStyle
} from '@/lib/citations/unified-service'
import { getProjectCitationStyle } from '@/lib/citations/citation-settings'
import { PromptService } from '@/lib/prompts/prompt-service'
import { buildCompleteContext, formatPapersForContext } from '@/lib/prompts/costar-context'
import { getUserLibraryPapers } from '@/lib/db/library'

// Suggestion types for smart context-aware completion
type SuggestionType =
  | 'opening_sentence'   // Start of section paragraph
  | 'complete_sentence'  // Finish incomplete sentence
  | 'next_sentence'      // Continue after complete sentence
  | 'provide_examples'   // After "such as", "for example"
  | 'contrast_point'     // After "however", "although"
  | 'contextual'         // Manual trigger - AI decides

interface CompletionRequest {
  projectId: string
  context: {
    precedingText: string
    currentParagraph: string
    currentSection: string
    documentOutline: string[]
  }
  paperIds: string[]
  topic: string
  suggestionType?: SuggestionType
}

interface CitationInSuggestion {
  paperId: string
  marker: string           // Original marker [@id] (Pandoc format)
  formatted: string        // Formatted (Smith et al., 2023)
  // Positions in the DISPLAY text (formattedSuggestion)
  displayStartOffset: number
  displayEndOffset: number
  // Positions in the RAW text (rawSuggestion) 
  rawStartOffset: number
  rawEndOffset: number
  paper?: PaperMetadata
}

interface CompletionResponse {
  suggestion: string       // Text with [@id] markers (for accept/processing)
  displaySuggestion: string // Text with formatted citations (for display)
  citations: CitationInSuggestion[]
  contextHint: string
  ragInfo?: {
    chunksUsed: number
    claimsUsed: number
    papersReferenced: number
  }
}

// Section guidance is now provided by costar-context.ts

// Paper formatting is now handled by formatPapersForContext from costar-context.ts

/**
 * Build system prompt using CO-STAR framework template
 */
async function buildSystemPromptFromTemplate(
  suggestionType: SuggestionType,
  context: CompletionRequest['context'],
  topic: string,
  paperType: string,
  ragFormatted: { chunksText: string; claimsText: string },
  papersContext: string,
  outlineContext: string
): Promise<string> {
  // Get objective for this suggestion type
  const suggestionObjective = await PromptService.getSuggestionObjective(suggestionType)
  
  // Build CO-STAR context
  const costarContext = buildCompleteContext({
    topic,
    paperType: paperType || 'research-article',
    currentSection: context.currentSection,
    suggestionType,
    suggestionObjective,
    precedingText: context.precedingText,
    outlineContext,
    chunksText: ragFormatted.chunksText,
    claimsText: ragFormatted.claimsText,
    papersContext,
  })

  // Build prompt from template
  return PromptService.buildCompletePrompt(costarContext)
}

/**
 * Build user prompt - minimal trigger approach
 * 
 * The system prompt (CO-STAR template) already contains:
 * - suggestionType and suggestionObjective
 * - precedingText and section context
 * - All source material and instructions
 * 
 * The user prompt just shows cursor position for the model to continue from.
 */
function buildUserPrompt(context: CompletionRequest['context']): string {
  const preceding = context.precedingText.trim()
  
  if (!preceding) {
    // Starting fresh - indicate section start
    return `[START OF ${context.currentSection.toUpperCase()}]`
  }
  
  // Show where cursor is - model continues from here
  // Use last 150 chars to give enough context without redundancy
  const snippet = preceding.slice(-150)
  const ellipsis = preceding.length > 150 ? '...' : ''
  
  return `${ellipsis}"${snippet}" [CURSOR]`
}

// Convert RAG context papers to PaperMetadata format
function ragContextToPaperMetadata(ragContext: EditorContext): PaperMetadata[] {
  const papers: PaperMetadata[] = []
  
  for (const [id, paper] of ragContext.papers) {
    papers.push({
      id,
      title: paper.title,
      authors: paper.authors || [],
      year: paper.year,
      doi: paper.doi,
      venue: paper.venue
    })
  }
  
  return papers
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse request body with error handling
    let body: CompletionRequest
    try {
      const text = await request.text()
      if (!text || text.trim() === '') {
        return NextResponse.json({ error: 'Empty request body' }, { status: 400 })
      }
      body = JSON.parse(text)
    } catch (parseError: unknown) {
      if (parseError instanceof Error) {
        if (parseError.message === 'aborted' || parseError.message.includes('ECONNRESET')) {
          return new NextResponse(null, { status: 499 })
        }
      }
      console.error('Failed to parse request body:', parseError)
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 })
    }

    const { projectId, context, paperIds, topic, suggestionType = 'contextual' } = body

    if (!projectId) {
      return NextResponse.json({ error: 'Missing projectId' }, { status: 400 })
    }

    // Verify project ownership and get metadata
    const { data: project, error: projectError } = await supabase
      .from('research_projects')
      .select('id, topic, paper_type')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Determine effective paper IDs - fall back to library if no project papers
    let effectivePaperIds = paperIds || []
    
    if (effectivePaperIds.length === 0) {
      console.log('[Autocomplete] No project papers, falling back to user library')
      
      // Get user's library papers
      const libraryPapers = await getUserLibraryPapers(user.id, {}, 50, 0)
      
      if (libraryPapers.length === 0) {
        return NextResponse.json({ 
          error: 'No papers available',
          message: 'Add papers to your library to enable AI-assisted writing.'
        }, { status: 422 })
      }
      
      // Use RAG to find top N most relevant papers to current context
      const queryText = `${context.currentSection}: ${context.currentParagraph} ${context.precedingText}`
      const allLibraryIds = libraryPapers.map(lp => lp.paper.id)
      
      // Retrieve with broader pool to find most relevant papers
      const relevanceCheck = await retrieveEditorContext(queryText, allLibraryIds, {
        maxChunks: 20,
        maxClaims: 0,
        minChunkScore: 0.2,
        minClaimScore: 0.5
      })
      
      // Get unique paper IDs from top chunks (preserves relevance order)
      const relevantPaperIds = [...new Set(
        relevanceCheck.chunks.map(c => c.paper_id)
      )].slice(0, 10)  // Top 10 most relevant
      
      if (relevantPaperIds.length > 0) {
        effectivePaperIds = relevantPaperIds
        console.log(`[Autocomplete] Using ${effectivePaperIds.length} relevant library papers`)
      } else {
        // Fallback: use most recent library papers if RAG finds nothing
        effectivePaperIds = allLibraryIds.slice(0, 10)
        console.log(`[Autocomplete] RAG found no relevant content, using ${effectivePaperIds.length} recent library papers`)
      }
    }

    // RAG RETRIEVAL + Citation style in parallel for better performance
    const queryText = `${context.currentSection}: ${context.currentParagraph} ${context.precedingText}`
    
    const [ragContext, citationStyle] = await Promise.all([
      // RAG retrieval (uses LRU cache for repeated queries)
      retrieveEditorContext(queryText, effectivePaperIds, {
        maxChunks: 8,
        maxClaims: 6,
        minChunkScore: 0.25,
        minClaimScore: 0.25
      }),
      // Citation style lookup
      getProjectCitationStyle(projectId, user.id) as Promise<CitationStyle>
    ])

    // Check if we have any content to work with
    if (!ragContext.hasContent) {
      return NextResponse.json({ 
        error: 'No relevant content found',
        message: 'The papers in your project don\'t have processed content yet. Try processing the papers first, or add papers with more relevant content.'
      }, { status: 422 })
    }

    // Format RAG context for the prompt
    const ragFormatted = formatEditorContextForPrompt(ragContext)
    const papersContext = formatPapersForContext(
      Array.from(ragContext.papers.entries()).map(([id, paper]) => ({
        id,
        title: paper.title,
        authors: paper.authors,
        year: paper.year,
      }))
    )

    const outlineContext = context.documentOutline.length > 0
      ? context.documentOutline.map(h => `- ${h}`).join('\n')
      : 'No outline.'

    // Get paper type from project
    const paperType = project.paper_type || 'literatureReview'

    // Build system prompt using CO-STAR framework
    const system = await buildSystemPromptFromTemplate(
      suggestionType,
      context,
      topic || project.topic,
      paperType,
      ragFormatted,
      papersContext,
      outlineContext
    )
    
    // Build minimal user prompt - just cursor position
    const userPrompt = buildUserPrompt(context)

    // Generate completion with streaming for faster perceived performance
    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), 30000)
    
    try {
      const result = streamText({
        model: getAutocompleteLanguageModel(),
        system,
        prompt: userPrompt,
        maxOutputTokens: 300,
        temperature: 0.5,
        abortSignal: abortController.signal,
      })

      // Get papers for citation processing
      const papers = ragContextToPaperMetadata(ragContext)

      // Create a custom stream that:
      // 1. Streams the text as it comes
      // 2. Sends citation metadata at the end
      const encoder = new TextEncoder()
      
      const stream = new ReadableStream({
        async start(controller) {
          try {
            let fullText = ''
            
            // Stream text chunks
            for await (const chunk of result.textStream) {
              fullText += chunk
              // Send text chunk as SSE
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', content: chunk })}\n\n`))
            }
            
            // Parse the full response for JSON structure (if any)
            let suggestion: string
            let contextHint: string = 'Continuing...'
            
            // Log raw response for debugging
            console.log('[Autocomplete] Raw AI response:', fullText.slice(0, 500))
            
            try {
              // Strip markdown code blocks if present (AI sometimes wraps JSON in ```json...```)
              let cleanedText = fullText.replace(/```json\s*/gi, '').replace(/```\s*/g, '')
              
              const jsonMatch = cleanedText.match(/\{[\s\S]*\}/)
              if (jsonMatch) {
                console.log('[Autocomplete] JSON match found:', jsonMatch[0].slice(0, 200))
                const parsed = JSON.parse(jsonMatch[0])
                suggestion = parsed.text || ''
                contextHint = parsed.contextHint || 'Continuing...'
                
                // If text field was empty, try using content outside JSON
                if (!suggestion.trim()) {
                  console.log('[Autocomplete] Empty text field in JSON, checking for content outside JSON')
                  const outsideJson = cleanedText.replace(/\{[\s\S]*\}/, '').trim()
                  if (outsideJson) {
                    suggestion = outsideJson
                  }
                }
              } else {
                console.log('[Autocomplete] No JSON found, using raw text')
                suggestion = cleanedText.trim()
              }
            } catch (parseErr) {
              console.log('[Autocomplete] JSON parse error:', parseErr)
              suggestion = fullText.trim()
            }
            
            // Clean up
            suggestion = suggestion.replace(/^["'\s]+|["'\s]+$/g, '').trim()
            
            console.log('[Autocomplete] Final suggestion:', suggestion ? suggestion.slice(0, 100) : '(empty)')
            
            if (!suggestion) {
              console.log('[Autocomplete] Empty suggestion, sending error')
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: 'Could not generate completion' })}\n\n`))
              controller.close()
              return
            }

            // Process citation markers
            const processResult = processCitationMarkersSync(suggestion, papers, citationStyle)
            const formattedSuggestion = processResult.content
            
            // Build citations array
            const citations: CitationInSuggestion[] = []
            let rawOffset = 0
            let displayOffset = 0
            
            for (const citation of processResult.citations) {
              const rawPos = suggestion.indexOf(citation.marker, rawOffset)
              const displayPos = formattedSuggestion.indexOf(citation.formatted, displayOffset)
              
              citations.push({
                paperId: citation.paperId,
                marker: citation.marker,
                formatted: citation.formatted,
                rawStartOffset: rawPos >= 0 ? rawPos : 0,
                rawEndOffset: rawPos >= 0 ? rawPos + citation.marker.length : 0,
                displayStartOffset: displayPos >= 0 ? displayPos : 0,
                displayEndOffset: displayPos >= 0 ? displayPos + citation.formatted.length : 0,
                paper: citation.paper
              })
              
              if (rawPos >= 0) rawOffset = rawPos + citation.marker.length
              if (displayPos >= 0) displayOffset = displayPos + citation.formatted.length
            }

            // Send final metadata
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'done',
              suggestion,
              displaySuggestion: formattedSuggestion,
              citations,
              contextHint,
              ragInfo: {
                chunksUsed: ragContext.chunks.length,
                claimsUsed: ragContext.claims.length,
                papersReferenced: ragContext.papers.size
              }
            })}\n\n`))
            
            controller.close()
          } catch (err) {
            console.error('Streaming error:', err)
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: 'Streaming failed' })}\n\n`))
            controller.close()
          }
        }
      })

      clearTimeout(timeout)

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      })
    } catch (err) {
      clearTimeout(timeout)
      throw err
    }

  } catch (error) {
    console.error('Editor completion error:', error)
    return NextResponse.json(
      { error: 'Failed to generate completion' },
      { status: 500 }
    )
  }
}
