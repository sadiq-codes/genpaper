import { createClient } from '@/lib/supabase/server'
import { getAutocompleteLanguageModel, getFastAutocompleteLanguageModel } from '@/lib/ai/vercel-client'
import { streamText } from 'ai'
import { NextRequest, NextResponse } from 'next/server'
import { 
  retrieveEditorContext, 
  formatEditorContextForPrompt, 
  type EditorContext 
} from '@/lib/rag'
import {
  processNumberedCitations,
  type PaperMetadata,
  type CitationStyle,
  type NumberedCitation
} from '@/lib/citations/unified-service'
import { getProjectCitationStyle } from '@/lib/citations/citation-settings'
import { PromptService } from '@/lib/prompts/prompt-service'
import { buildCompleteContext, formatPapersForContext } from '@/lib/prompts/costar-context'
import { getUserLibraryPapers } from '@/lib/db/library'

// Note: SuggestionType removed - the unified prompt now handles all cases
// by having the LLM analyze writing intent semantically

interface CompletionRequest {
  projectId: string
  context: {
    precedingText: string
    followingText?: string  // FIM: text after cursor (suffix)
    currentParagraph: string
    currentSection: string
    documentOutline: string[]
  }
  paperIds: string[]
  topic: string
  // When true, skip RAG entirely for faster completions (no citations mode)
  skipRAG?: boolean
}

// Citation info returned to client
interface CitationInSuggestion {
  paperId: string
  instanceId: string       // UUID for this specific instance
  marker: string           // [@id#instanceId] marker format
  formatted: string        // (Smith et al., 2023)
  citedContent: string     // The exact content from the paper that was cited
  index: number            // The original [N] index
  // Position offsets for ghost text highlighting
  displayStartOffset: number
  displayEndOffset: number
  paper?: PaperMetadata
}

/**
 * Save citation instances to database
 */
async function saveCitationInstances(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  instances: Array<{ instanceId: string; paperId: string; quote: string }>
): Promise<void> {
  if (instances.length === 0) return
  
  try {
    // Keep quote sizes bounded (same intent as /api/citation-instances)
    const MAX_QUOTE_WORDS = 100
    const truncateQuote = (quote: string) => {
      const words = quote.split(/\s+/)
      if (words.length <= MAX_QUOTE_WORDS) return quote
      return words.slice(0, MAX_QUOTE_WORDS).join(' ') + '...'
    }

    const inserts = instances
      .filter(i => i.instanceId && i.paperId && i.quote)
      .map(i => ({
        id: i.instanceId,
        project_id: projectId,
        paper_id: i.paperId,
        quote: truncateQuote(i.quote),
      }))

    if (inserts.length === 0) return

    const { error } = await supabase
      .from('citation_instances')
      .upsert(inserts, { onConflict: 'id', ignoreDuplicates: true })

    if (error) {
      // If migration not applied yet, treat as optional
      if ((error as { code?: string }).code === 'PGRST205') {
        console.warn('[Autocomplete] citation_instances not available (migration not applied); skipping')
        return
      }
      console.error('[Autocomplete] Failed to save citation instances:', error)
      return
    }

    console.log(`[Autocomplete] Saved ${inserts.length} citation instances`)
  } catch (error) {
    console.error('[Autocomplete] Error saving citation instances:', error)
  }
}

/**
 * Build system prompt using CO-STAR framework template
 * 
 * Note: suggestionType removed - the unified prompt instructs the LLM
 * to analyze writing intent semantically rather than using pre-classified types.
 */
async function buildSystemPromptFromTemplate(
  context: CompletionRequest['context'],
  topic: string,
  paperType: string,
  ragFormatted: { chunksText: string; claimsText: string },
  papersContext: string,
  outlineContext: string,
  voiceProfileId?: string | null
): Promise<string> {
  // Validate voice profile ID
  type VoiceProfileId = 'conservative-reviewer' | 'confident-researcher' | 'senior-scholar' | 'balanced-academic'
  const validVoiceIds: VoiceProfileId[] = ['conservative-reviewer', 'confident-researcher', 'senior-scholar', 'balanced-academic']
  const validatedVoiceId = voiceProfileId && validVoiceIds.includes(voiceProfileId as VoiceProfileId)
    ? voiceProfileId as VoiceProfileId
    : undefined
  
  const costarContext = buildCompleteContext({
    topic,
    paperType: paperType || 'research-article',
    currentSection: context.currentSection,
    precedingText: context.precedingText,
    followingText: context.followingText,  // FIM: pass suffix for better context
    outlineContext,
    chunksText: ragFormatted.chunksText,
    claimsText: ragFormatted.claimsText,
    papersContext,
    voiceProfileId: validatedVoiceId,
  })

  return PromptService.buildCompletePrompt(costarContext)
}

/**
 * Build user prompt - minimal trigger approach
 */
function buildUserPrompt(context: CompletionRequest['context']): string {
  const preceding = context.precedingText.trim()
  
  if (!preceding) {
    return `[START OF ${context.currentSection.toUpperCase()}]`
  }
  
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

/**
 * Single sentence with its own citations
 */
interface AISentence {
  text: string
  citations: NumberedCitation[]
}

/**
 * Parse structured AI response with multiple sentences
 * Each sentence has its own text and citations array
 */
interface AIStructuredResponse {
  sentences: AISentence[]
  contextHint: string
  // Legacy single-text format (for backwards compatibility)
  text?: string
  citations?: NumberedCitation[]
}

function parseAIResponse(rawText: string): AIStructuredResponse | null {
  try {
    // Strip markdown code blocks if present
    let cleanedText = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    
    // Find the JSON object
    const jsonMatch = cleanedText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.log('[Autocomplete] No JSON found in response')
      return null
    }
    
    const parsed = JSON.parse(jsonMatch[0])
    
    // NEW FORMAT: sentences array
    if (Array.isArray(parsed.sentences) && parsed.sentences.length > 0) {
      const sentences: AISentence[] = []
      
      for (const s of parsed.sentences) {
        if (typeof s.text !== 'string' || !s.text.trim()) {
          continue // Skip invalid sentences
        }
        
        const citations: NumberedCitation[] = []
        if (Array.isArray(s.citations)) {
          for (const c of s.citations) {
            if (typeof c.index === 'number' && typeof c.paperId === 'string') {
              citations.push({
                index: c.index,
                paperId: c.paperId,
                citedContent: c.citedContent || ''
              })
            }
          }
        }
        
        sentences.push({
          text: s.text.trim(),
          citations
        })
      }
      
      // Limit to 2 sentences max (default is 1, but allow 2 if naturally connected)
      const finalSentences = sentences.slice(0, 2)
      
      if (finalSentences.length === 0) {
        console.log('[Autocomplete] No valid sentences in response')
        return null
      }
      
      console.log(`[Autocomplete] Parsed ${finalSentences.length} sentences`)
      
      return {
        sentences: finalSentences,
        contextHint: parsed.contextHint || 'Continuing...'
      }
    }
    
    // LEGACY FORMAT: single text + citations (backwards compatibility)
    if (typeof parsed.text === 'string' && parsed.text.trim()) {
      console.log('[Autocomplete] Using legacy single-text format')
      
      const citations: NumberedCitation[] = []
      if (Array.isArray(parsed.citations)) {
        for (const c of parsed.citations) {
          if (typeof c.index === 'number' && typeof c.paperId === 'string') {
            citations.push({
              index: c.index,
              paperId: c.paperId,
              citedContent: c.citedContent || ''
            })
          }
        }
      }
      
      // Convert to sentences format for consistency
      return {
        sentences: [{
          text: parsed.text.trim(),
          citations
        }],
        contextHint: parsed.contextHint || 'Continuing...',
        // Keep legacy fields for debugging
        text: parsed.text.trim(),
        citations
      }
    }
    
    console.log('[Autocomplete] Missing both sentences array and text field')
    return null
  } catch (err) {
    console.error('[Autocomplete] Failed to parse AI response:', err)
    return null
  }
}

export async function POST(request: NextRequest) {
  const requestStartTime = Date.now()
  const timings: Record<string, number> = {}
  
  try {
    // Auth check
    const authStartTime = Date.now()
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    timings.auth = Date.now() - authStartTime

    // Parse request body
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

    const { projectId, context, paperIds, topic, skipRAG } = body

    if (!projectId) {
      return NextResponse.json({ error: 'Missing projectId' }, { status: 400 })
    }

    // Build query text early for parallel operations
    const queryText = `${context.currentSection}: ${context.currentParagraph} ${context.precedingText}`
    
    // OPTIMIZATION: Fetch project and determine paper IDs in parallel when possible
    const projectFetchStart = Date.now()
    
    // Start project fetch (include generation_config for voice profile)
    const projectPromise = supabase
      .from('research_projects')
      .select('id, topic, paper_type, generation_config')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()
    
    let effectivePaperIds = paperIds || []
    let libraryFallbackUsed = false
    
    // FAST MODE: Skip RAG entirely when citations are disabled
    // This avoids the expensive library fallback + relevance RAG pass
    if (skipRAG) {
      console.log('[Autocomplete] skipRAG=true - skipping RAG for fast completion')
      effectivePaperIds = []
    }
    // If no paper IDs provided AND RAG not skipped, we need library fallback
    else if (effectivePaperIds.length === 0) {
      console.log('[Autocomplete] No project papers, falling back to user library')
      libraryFallbackUsed = true
      
      // OPTIMIZATION: Fetch only 12 recent papers instead of 50
      // The actual RAG retrieval (4 chunks) will filter to relevant content anyway
      // This saves ~200-400ms by skipping the separate relevance check pass
      const libraryStartTime = Date.now()
      const libraryPapers = await getUserLibraryPapers(user.id, {}, 12, 0)
      timings.libraryFetch = Date.now() - libraryStartTime
      
      if (libraryPapers.length === 0) {
        return NextResponse.json({ 
          error: 'No papers available',
          message: 'Add papers to your library to enable AI-assisted writing.'
        }, { status: 422 })
      }
      
      // OPTIMIZATION: Skip the separate relevance check - just use recent papers directly
      // The main RAG retrieval (4 chunks with 0.25 min score) handles relevance filtering
      effectivePaperIds = libraryPapers.map(lp => lp.paper.id)
      console.log(`[Autocomplete] Using ${effectivePaperIds.length} recent library papers (fast mode)`)
    }

    // Wait for project fetch (may already be done)
    const { data: project, error: projectError } = await projectPromise
    timings.projectFetch = Date.now() - projectFetchStart

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }
    
    // Extract voice profile from generation config
    const generationConfig = (project as { generation_config?: { voiceProfileId?: string } | null }).generation_config
    const voiceProfileId = generationConfig?.voiceProfileId || null
    
    if (voiceProfileId) {
      console.log('[Autocomplete] Using project voice profile:', voiceProfileId)
    }
    
    // OPTIMIZATION: Parallel RAG + citation style fetch
    // OPTIMIZATION: Reduced chunks (4) and skip claims for autocomplete
    const ragStartTime = Date.now()
    
    // When skipRAG is true, don't retrieve any context - just fetch citation style
    let ragContext: Awaited<ReturnType<typeof retrieveEditorContext>>
    let citationStyle: CitationStyle | null = null
    
    if (skipRAG) {
      // Fast mode: no RAG, no citation style fetch (nothing to cite)
      ragContext = {
        hasContent: true, // Pretend we have content so we don't error out
        chunks: [],
        claims: [],
        papers: new Map(),
      }
      timings.rag = Date.now() - ragStartTime
      console.log('[Autocomplete] RAG skipped - fast mode enabled')
    } else {
      // Normal mode: retrieve context + citation style in parallel
      const [retrievedContext, style] = await Promise.all([
        retrieveEditorContext(queryText, effectivePaperIds, {
          maxChunks: 4,   // Reduced from 8 - 4 chunks is enough for 1-2 sentences
          maxClaims: 0,   // Skip claims for autocomplete - chunks have the evidence
          minChunkScore: 0.25,
          minClaimScore: 0.25
        }),
        getProjectCitationStyle(projectId, user.id) as Promise<CitationStyle>
      ])
      ragContext = retrievedContext
      citationStyle = style
      timings.rag = Date.now() - ragStartTime

      if (!ragContext.hasContent) {
        return NextResponse.json({ 
          error: 'No relevant content found',
          message: 'The papers in your project don\'t have processed content yet. Try processing the papers first, or add papers with more relevant content.'
        }, { status: 422 })
      }
    }
    
    // Log timing breakdown
    console.log('[Autocomplete] Timing breakdown (ms):', {
      ...timings,
      skipRAG: !!skipRAG,
      libraryFallback: libraryFallbackUsed,
      chunksRetrieved: ragContext.chunks.length,
      papersUsed: ragContext.papers.size
    })

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

    const paperType = project.paper_type || 'literatureReview'

    const system = await buildSystemPromptFromTemplate(
      context,
      topic || project.topic,
      paperType,
      ragFormatted,
      papersContext,
      outlineContext,
      voiceProfileId  // Pass voice profile for consistent completions
    )
    
    const userPrompt = buildUserPrompt(context)

    const abortController = new AbortController()
    const timeout = setTimeout(() => {
      abortController.abort(new DOMException('Autocomplete timed out', 'AbortError'))
    }, 30000)

    // Abort upstream generation immediately if the client disconnects
    const onRequestAbort = () => {
      abortController.abort(new DOMException('Client disconnected', 'AbortError'))
    }
    request.signal.addEventListener('abort', onRequestAbort, { once: true })
    
    // Track LLM timing
    const llmStartTime = Date.now()
    
    try {
      // Use ultra-fast model when RAG is skipped (no citations mode)
      // This provides much lower latency for simple prose completions
      const model = skipRAG 
        ? getFastAutocompleteLanguageModel() 
        : getAutocompleteLanguageModel()
      
      console.log('[Autocomplete] Using model:', skipRAG ? 'fast (gpt-4o-mini)' : 'standard')
      
      const result = streamText({
        model,
        system,
        prompt: userPrompt,
        // Reduced tokens when RAG skipped since no citations needed
        maxOutputTokens: skipRAG ? 150 : 250,
        temperature: 0.5,
        abortSignal: abortController.signal,
      })

      const papers = ragContextToPaperMetadata(ragContext)
      const encoder = new TextEncoder()
      
      // Flag to prevent enqueue after close
      let streamClosed = false
      
      const stream = new ReadableStream({
        async start(controller) {
          try {
            let fullText = ''
            let firstTokenTime: number | null = null
            
            for await (const chunk of result.textStream) {
              if (abortController.signal.aborted) {
                streamClosed = true
                try { controller.close() } catch {}
                return
              }
              // Track time to first token
              if (firstTokenTime === null) {
                firstTokenTime = Date.now()
                timings.llmFirstToken = firstTokenTime - llmStartTime
              }
              
              fullText += chunk
              
              // Guard against closed controller
              if (!streamClosed) {
                try {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', content: chunk })}\n\n`))
                } catch {
                  // Controller may be closed if client disconnected
                  streamClosed = true
                  return
                }
              }
            }
            
            timings.llmTotal = Date.now() - llmStartTime
            
            console.log('[Autocomplete] Raw AI response:', fullText.slice(0, 500))
            
            const parsed = parseAIResponse(fullText)
            
            if (!parsed || parsed.sentences.length === 0) {
              console.log('[Autocomplete] Failed to parse response or no sentences')
              if (!streamClosed) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                  type: 'error', 
                  error: 'Could not generate completion - invalid response format' 
                })}\n\n`))
                streamClosed = true
                controller.close()
              }
              return
            }
            
            console.log(`[Autocomplete] Parsed ${parsed.sentences.length} sentences`)
            
            // Process each sentence independently with its own citations
            interface ProcessedSentence {
              text: string           // Raw text with [@id#instanceId] markers
              displayText: string    // Formatted with (Author, Year)
              citations: CitationInSuggestion[]
            }
            
            const processedSentences: ProcessedSentence[] = []
            const allInstancesToCreate: Array<{ instanceId: string; paperId: string; quote: string }> = []
            
            for (let i = 0; i < parsed.sentences.length; i++) {
              const sentence = parsed.sentences[i]
              console.log(`[Autocomplete] Processing sentence ${i + 1}:`, sentence.text.slice(0, 80))
              
              // Process numbered citations [1], [2], etc. for this sentence
              // When skipRAG is true, citationStyle is null but papers is empty anyway
              // so citation processing will be a no-op. Use 'apa' as fallback.
              const processResult = processNumberedCitations(
                sentence.text,
                sentence.citations,
                papers,
                citationStyle || 'apa'
              )
              
              if (processResult.failedCitations.length > 0) {
                console.log(`[Autocomplete] Sentence ${i + 1} failed citations:`, processResult.failedCitations)
              }
              
              // Collect instances to create
              allInstancesToCreate.push(...processResult.instancesToCreate)
              
              // Build citations array for this sentence with position offsets
              const displayText = processResult.contentFormatted
              const sentenceCitations: CitationInSuggestion[] = []
              
              for (const c of processResult.processedCitations) {
                // Find the position of this formatted citation in the display text
                const searchStart = sentenceCitations.length > 0 
                  ? sentenceCitations[sentenceCitations.length - 1].displayEndOffset 
                  : 0
                const displayStartOffset = displayText.indexOf(c.formatted, searchStart)
                const displayEndOffset = displayStartOffset >= 0 
                  ? displayStartOffset + c.formatted.length 
                  : 0
                
                sentenceCitations.push({
                  paperId: c.paperId,
                  instanceId: c.instanceId,
                  marker: c.marker,
                  formatted: c.formatted,
                  citedContent: c.citedContent,
                  index: c.index,
                  displayStartOffset: displayStartOffset >= 0 ? displayStartOffset : 0,
                  displayEndOffset,
                  paper: c.paper
                })
              }
              
              processedSentences.push({
                text: processResult.contentWithMarkers,
                displayText: processResult.contentFormatted,
                citations: sentenceCitations
              })
            }
            
            // Save all citation instances to database (async, don't block)
            if (allInstancesToCreate.length > 0) {
              void saveCitationInstances(supabase, projectId, allInstancesToCreate)
            }

            // Log final timing
            timings.total = Date.now() - requestStartTime
            console.log('[Autocomplete] Total timing (ms):', timings)

            if (!streamClosed) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'done',
                // Array of sentences for progressive display
                sentences: processedSentences,
                contextHint: parsed.contextHint,
                ragInfo: {
                  chunksUsed: ragContext.chunks.length,
                  claimsUsed: ragContext.claims.length,
                  papersReferenced: ragContext.papers.size
                },
                timing: timings  // Include timing in response for debugging
              })}\n\n`))
              
              streamClosed = true
              controller.close()
            }
          } catch (err) {
            console.error('Streaming error:', err)
            if (!streamClosed) {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: 'Streaming failed' })}\n\n`))
                controller.close()
              } catch {
                // Ignore - controller already closed
              }
              streamClosed = true
            }
          } finally {
            clearTimeout(timeout)
            request.signal.removeEventListener('abort', onRequestAbort)
          }
        },
        cancel() {
          streamClosed = true
          clearTimeout(timeout)
          request.signal.removeEventListener('abort', onRequestAbort)
          abortController.abort(new DOMException('Stream cancelled', 'AbortError'))
        },
      })

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      })
    } catch (err) {
      clearTimeout(timeout)
      request.signal.removeEventListener('abort', onRequestAbort)
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
