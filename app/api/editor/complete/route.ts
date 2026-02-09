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
import { checkAndIncrementAutocompleteUsage, formatTimeUntilReset } from '@/lib/billing/usage-limits'

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
  confidence: number  // 0.0-1.0, how confident the model is in this completion
  // Legacy single-text format (for backwards compatibility)
  text?: string
  citations?: NumberedCitation[]
}

/**
 * Try to repair truncated JSON by closing open brackets/braces
 */
function tryRepairJSON(text: string): string | null {
  // Count open brackets
  let braces = 0
  let brackets = 0
  let inString = false
  let escaped = false
  
  for (const char of text) {
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    
    if (char === '{') braces++
    else if (char === '}') braces--
    else if (char === '[') brackets++
    else if (char === ']') brackets--
  }
  
  // If we're inside a string, close it
  let repaired = text
  if (inString) {
    repaired += '"'
  }
  
  // Close open brackets and braces
  while (brackets > 0) {
    repaired += ']'
    brackets--
  }
  while (braces > 0) {
    repaired += '}'
    braces--
  }
  
  return repaired
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
    
    let parsed: any
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch (parseError) {
      // JSON is truncated - try to repair it
      console.log('[Autocomplete] JSON parse failed, attempting repair...')
      const repaired = tryRepairJSON(jsonMatch[0])
      if (repaired) {
        try {
          parsed = JSON.parse(repaired)
          console.log('[Autocomplete] JSON repair successful')
        } catch {
          console.log('[Autocomplete] JSON repair failed:', parseError)
          return null
        }
      } else {
        console.log('[Autocomplete] Failed to parse AI response:', parseError)
        return null
      }
    }
    
    // NEW FORMAT: sentences array
    if (Array.isArray(parsed.sentences) && parsed.sentences.length > 0) {
      const sentences: AISentence[] = []
      
      for (const s of parsed.sentences) {
        if (typeof s.text !== 'string' || !s.text.trim()) {
          continue // Skip invalid sentences
        }
        
        let text = s.text.trim()
        
        // Strip trailing citation markers to expose the actual last character
        // e.g. "some claim [1]" → check "some claim" for sentence-ending punctuation
        const textWithoutTrailingCitations = text.replace(/(\s*\[\d+\])+\s*$/, '').trim()
        
        // COMPLETENESS CHECK: Reject sentences truncated mid-flow by token limit.
        // A complete sentence must end with sentence-terminating punctuation.
        // Allow closing parens/quotes after the period: "end." or 'end."' or "end.)"
        const endsWithPunctuation = /[.!?]['")]*$/.test(textWithoutTrailingCitations)
        
        if (!endsWithPunctuation) {
          console.log(`[Autocomplete] Dropping truncated sentence: "${text.slice(-40)}"`)
          continue
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
          text,
          citations
        })
      }
      
      // Limit to 2 sentences max (default is 1, but allow 2 if naturally connected)
      const finalSentences = sentences.slice(0, 2)
      
      if (finalSentences.length === 0) {
        console.log('[Autocomplete] No valid sentences in response')
        return null
      }
      
      console.log(`[Autocomplete] Parsed ${finalSentences.length} sentences, confidence: ${parsed.confidence}`)
      
      // Extract confidence score (default to 0.7 if not provided)
      const confidence = typeof parsed.confidence === 'number' 
        ? Math.max(0, Math.min(1, parsed.confidence)) 
        : 0.7
      
      return {
        sentences: finalSentences,
        contextHint: parsed.contextHint || 'Continuing...',
        confidence
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
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
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

    // Check daily usage limits (free tier: 10 autocompletes/day, paid: unlimited)
    const usageCheck = await checkAndIncrementAutocompleteUsage(user.id)
    if (!usageCheck.allowed) {
      const timeUntilReset = formatTimeUntilReset(usageCheck.resetsAt)
      return NextResponse.json({ 
        error: 'Daily autocomplete limit reached',
        code: 'AUTOCOMPLETE_LIMIT_REACHED',
        message: `You've used all ${usageCheck.dailyLimit} daily autocomplete requests. Upgrade to a paid plan for unlimited autocomplete, or wait ${timeUntilReset} for your limit to reset.`,
        usage: {
          current: usageCheck.currentUses,
          limit: usageCheck.dailyLimit,
          resetsAt: usageCheck.resetsAt.toISOString(),
        }
      }, { status: 429 })
    }

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
    
    // Start project fetch + library paper IDs fetch in parallel
    const projectPromise = supabase
      .from('research_projects')
      .select('id, topic, paper_type, generation_config')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()
    
    // Fetch user's library paper IDs (lightweight — IDs only, max 50)
    // Used to boost library papers in global search results
    const libraryIdsPromise = supabase
      .from('library_papers')
      .select('paper_id')
      .eq('user_id', user.id)
      .limit(50)
    
    // Use project paper IDs if provided; otherwise search global corpus
    let effectivePaperIds = paperIds || []
    
    // FAST MODE: Skip RAG entirely when citations are disabled
    if (skipRAG) {
      console.log('[Autocomplete] skipRAG=true - skipping RAG for fast completion')
      effectivePaperIds = []
    }
    // No project papers → search the global pre-indexed corpus (empty array = global search)
    else if (effectivePaperIds.length === 0) {
      console.log('[Autocomplete] No project papers — using global corpus search')
    }

    // Wait for project + library fetches (both started in parallel above)
    const [{ data: project, error: projectError }, { data: libraryRows }] = await Promise.all([
      projectPromise,
      libraryIdsPromise,
    ])
    timings.projectFetch = Date.now() - projectFetchStart

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }
    
    // Extract library paper IDs for search boosting
    const boostedPaperIds = libraryRows?.map((r: { paper_id: string }) => r.paper_id) || []
    
    // Extract voice profile and planned outline from generation config
    const generationConfig = (project as { generation_config?: { voiceProfileId?: string; plannedOutline?: string[] } | null }).generation_config
    const voiceProfileId = generationConfig?.voiceProfileId || null
    const plannedOutline: string[] = generationConfig?.plannedOutline || []
    
    if (voiceProfileId) {
      console.log('[Autocomplete] Using project voice profile:', voiceProfileId)
    }

    // -----------------------------------------------------------------------
    // OUTLINE-AWARE HEADING SUGGESTION
    // If there's a planned outline and the next section heading is missing from
    // the document, return it instantly — no LLM call needed.
    // -----------------------------------------------------------------------
    if (plannedOutline.length > 0) {
      const docHeadingsLower = (context.documentOutline || []).map(h => h.toLowerCase().trim())
      // Find the first planned heading not yet present in the document
      const nextHeading = plannedOutline.find(
        planned => !docHeadingsLower.some(
          existing => existing === planned.toLowerCase().trim() || 
                      existing.includes(planned.toLowerCase().trim()) ||
                      planned.toLowerCase().trim().includes(existing)
        )
      )

      // Suggest a heading when:
      // - There's a next heading to suggest
      // - The cursor is in an empty paragraph (currentParagraph is empty/whitespace)
      // - Either the document has no headings at all, or we're at the end of a section
      const isEmptyParagraph = !context.currentParagraph?.trim()
      if (nextHeading && isEmptyParagraph) {
        console.log(`[Autocomplete] Suggesting next heading: "${nextHeading}"`)
        timings.total = Date.now() - requestStartTime

        // Return heading as a markdown-formatted suggestion (## Heading)
        const headingText = `## ${nextHeading}\n`
        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'done',
              sentences: [{
                text: headingText,
                displayText: nextHeading,
                citations: []
              }],
              contextHint: 'Next section',
              ragInfo: { chunksUsed: 0, claimsUsed: 0, papersReferenced: 0 },
              timing: timings,
              isHeadingSuggestion: true,
            })}\n\n`))
            controller.close()
          }
        })

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        })
      }
    }

    // RAG + citation style fetch in parallel
    // effectivePaperIds=[] triggers global corpus search in retrieveEditorContext
    const ragStartTime = Date.now()
    
    let ragContext: Awaited<ReturnType<typeof retrieveEditorContext>>
    let citationStyle: CitationStyle | null = null
    let usesFastModel = false
    
    if (skipRAG) {
      // No RAG, no citation style fetch (citations disabled)
      ragContext = {
        hasContent: true,
        chunks: [],
        claims: [],
        papers: new Map(),
      }
      usesFastModel = true
      timings.rag = Date.now() - ragStartTime
      console.log('[Autocomplete] RAG skipped — citations disabled')
    } else {
      const [retrievedContext, style] = await Promise.all([
        retrieveEditorContext(queryText, effectivePaperIds, {
          maxChunks: 4,
          maxClaims: 0,
          minChunkScore: 0.25,
          minClaimScore: 0.25,
          boostedPaperIds,
        }),
        getProjectCitationStyle(projectId, user.id) as Promise<CitationStyle>
      ])
      ragContext = retrievedContext
      citationStyle = style
      timings.rag = Date.now() - ragStartTime

      if (ragContext.hasContent) {
        console.log(`[Autocomplete] RAG context: ${ragContext.chunks.length} chunks, ${ragContext.papers.size} papers`)
      } else {
        // No chunks found — use fast model for topic-only completion
        usesFastModel = true
        ragContext = { hasContent: true, chunks: [], claims: [], papers: new Map() }
        console.log('[Autocomplete] No RAG chunks found — topic-only mode')
      }
    }
    
    // Log timing breakdown
    console.log('[Autocomplete] Timing breakdown (ms):', {
      ...timings,
      skipRAG: !!skipRAG,
      globalSearch: effectivePaperIds.length === 0,
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

    // Build outline context: show current document headings + planned outline awareness
    let outlineContext: string
    if (context.documentOutline.length > 0) {
      outlineContext = 'Current document sections:\n' + context.documentOutline.map(h => `- ${h}`).join('\n')
      if (plannedOutline.length > 0) {
        const docHeadingsLower = context.documentOutline.map(h => h.toLowerCase().trim())
        const remaining = plannedOutline.filter(planned => !docHeadingsLower.some(
          existing => existing === planned.toLowerCase().trim() || 
                      existing.includes(planned.toLowerCase().trim()) ||
                      planned.toLowerCase().trim().includes(existing)
        ))
        if (remaining.length > 0) {
          outlineContext += '\n\nUpcoming planned sections:\n' + remaining.map(h => `- ${h}`).join('\n')
        }
      }
    } else if (plannedOutline.length > 0) {
      outlineContext = 'Planned paper outline:\n' + plannedOutline.map(h => `- ${h}`).join('\n')
    } else {
      outlineContext = 'No outline.'
    }

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
      // Fast model when no RAG context (no citations to generate)
      // Standard model when RAG context available (grounded completions)
      const model = usesFastModel
        ? getFastAutocompleteLanguageModel() 
        : getAutocompleteLanguageModel()
      
      console.log(`[Autocomplete] model: ${usesFastModel ? 'fast' : 'standard'}, chunks: ${ragContext.chunks.length}`)
      
      const result = streamText({
        model,
        system,
        prompt: userPrompt,
        // Increased from 250 to 500 to allow complete JSON with citations
        // The citedContent field can be long (quotes from papers)
        maxOutputTokens: usesFastModel ? 150 : 500,
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
            let sentInterim = false
            
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
              
              // STREAMING PREVIEW: Try to extract and send interim text early
              // Look for first complete sentence in the "text" field of the JSON
              if (!sentInterim && !streamClosed) {
                // Try to extract text from partial JSON - look for "text": "..." pattern
                const textMatch = fullText.match(/"text"\s*:\s*"([^"]*(?:\\.[^"]*)*)/)
                if (textMatch && textMatch[1]) {
                  // Unescape JSON string
                  let previewText = textMatch[1]
                    .replace(/\\n/g, '\n')
                    .replace(/\\"/g, '"')
                    .replace(/\\\\/g, '\\')
                  
                  // Check if we have at least one complete sentence (ends with . ! or ?)
                  const sentenceEnd = previewText.match(/[.!?](?:\s|$)/)
                  if (sentenceEnd) {
                    // Extract just the first sentence for preview
                    const firstSentenceEnd = previewText.search(/[.!?](?:\s|$)/) + 1
                    previewText = previewText.slice(0, firstSentenceEnd).trim()
                    
                    // Remove citation markers [1], [2] etc for clean preview
                    previewText = previewText.replace(/\s*\[\d+\]/g, '')
                    
                    if (previewText.length > 10) {
                      try {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                          type: 'interim', 
                          preview: previewText 
                        })}\n\n`))
                        sentInterim = true
                        console.log('[Autocomplete] Sent interim preview:', previewText.slice(0, 50))
                      } catch {
                        streamClosed = true
                        return
                      }
                    }
                  }
                }
              }
              
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
            
            // CONFIDENCE THRESHOLD: Suppress low-confidence suggestions
            const CONFIDENCE_THRESHOLD = 0.5
            if (parsed.confidence < CONFIDENCE_THRESHOLD) {
              console.log(`[Autocomplete] Low confidence (${parsed.confidence}) - suppressing suggestion`)
              if (!streamClosed) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                  type: 'error', 
                  error: 'No confident suggestion available for this context' 
                })}\n\n`))
                streamClosed = true
                controller.close()
              }
              return
            }
            
            // BANNED PHRASE ENFORCEMENT: Reject suggestions containing filler phrases
            // These are explicitly banned in the prompt but models sometimes ignore
            const BANNED_PHRASES = [
              'encompasses a diverse array',
              'plays a crucial role',
              'a wide range of',
              'various aspects of',
              'it is important to note',
              'it should be noted',
              'in recent years',
              'has gained significant attention',
              'has been widely studied',
              'is of paramount importance',
              'a plethora of',
              'myriad of',
            ]
            
            const allText = parsed.sentences.map(s => s.text.toLowerCase()).join(' ')
            const foundBannedPhrase = BANNED_PHRASES.find(phrase => allText.includes(phrase.toLowerCase()))
            
            if (foundBannedPhrase) {
              console.log(`[Autocomplete] Banned phrase detected: "${foundBannedPhrase}" - suppressing suggestion`)
              if (!streamClosed) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                  type: 'error', 
                  error: 'Suggestion contained generic filler - please try again' 
                })}\n\n`))
                streamClosed = true
                controller.close()
              }
              return
            }
            
            console.log(`[Autocomplete] Parsed ${parsed.sentences.length} sentences, confidence: ${parsed.confidence}`)
            
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
            
            // Save all citation instances to database
            if (allInstancesToCreate.length > 0) {
              await saveCitationInstances(supabase, projectId, allInstancesToCreate)
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
          'X-Global-Search': effectivePaperIds.length === 0 ? '1' : '0',
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
