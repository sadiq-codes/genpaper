import { createClient } from '@/lib/supabase/server'
import { getLanguageModel } from '@/lib/ai/vercel-client'
import { generateText } from 'ai'
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

    // Get citation style for this project
    const citationStyle: CitationStyle = await getProjectCitationStyle(projectId, user.id)

    // RAG RETRIEVAL: Get relevant chunks and claims
    const queryText = `${context.currentSection}: ${context.currentParagraph} ${context.precedingText}`
    
    const ragContext = await retrieveEditorContext(queryText, effectivePaperIds, {
      maxChunks: 8,
      maxClaims: 6,
      minChunkScore: 0.25,
      minClaimScore: 0.25
    })

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

    // Generate completion with timeout
    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), 30000)
    
    let rawResponse: string
    try {
      const result = await generateText({
        model: getLanguageModel(),
        system,
        prompt: userPrompt,
        maxTokens: 300,
        temperature: 0.5,
        abortSignal: abortController.signal,
      })
      rawResponse = result.text
    } finally {
      clearTimeout(timeout)
    }

    // Parse response
    let suggestion: string
    let contextHint: string

    try {
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        suggestion = parsed.text || ''
        contextHint = parsed.contextHint || 'Continuing...'
      } else {
        suggestion = rawResponse.trim()
        contextHint = 'Continuing...'
      }
    } catch {
      suggestion = rawResponse.trim()
      contextHint = 'Continuing...'
    }

    // Clean up
    suggestion = suggestion.replace(/^["'\s]+|["'\s]+$/g, '').trim()

    if (!suggestion) {
      return NextResponse.json({ 
        error: 'Could not generate completion' 
      }, { status: 422 })
    }

    // Extract and process citation markers
    const papers = ragContextToPaperMetadata(ragContext)
    
    // Keep the raw suggestion with [CITE: id] markers for the accept path
    const rawSuggestion = suggestion
    
    // Process markers to get formatted display version
    const processResult = processCitationMarkersSync(suggestion, papers, citationStyle)
    const formattedSuggestion = processResult.content
    
    // Build citations array with positions in BOTH formats
    const citations: CitationInSuggestion[] = []
    
    // Track positions by finding markers in raw and formatted in display
    // We need to account for the length difference as we process
    let rawOffset = 0
    let displayOffset = 0
    
    for (const citation of processResult.citations) {
      // Find position of marker in raw text (starting from last position)
      const rawPos = rawSuggestion.indexOf(citation.marker, rawOffset)
      // Find position of formatted citation in display text
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
      
      // Update offsets for next search
      if (rawPos >= 0) rawOffset = rawPos + citation.marker.length
      if (displayPos >= 0) displayOffset = displayPos + citation.formatted.length
    }

    // Log invalid paper IDs (AI hallucinated or used wrong ID)
    if (processResult.invalidPaperIds.length > 0) {
      console.warn('Autocomplete: Invalid paper IDs in suggestion:', processResult.invalidPaperIds)
    }

    const response: CompletionResponse = {
      suggestion: rawSuggestion,           // Original text with [CITE: id] markers (for processing)
      displaySuggestion: formattedSuggestion, // Display text with formatted citations
      citations,
      contextHint,
      ragInfo: {
        chunksUsed: ragContext.chunks.length,
        claimsUsed: ragContext.claims.length,
        papersReferenced: ragContext.papers.size
      }
    }

    return NextResponse.json(response)

  } catch (error) {
    console.error('Editor completion error:', error)
    return NextResponse.json(
      { error: 'Failed to generate completion' },
      { status: 500 }
    )
  }
}
