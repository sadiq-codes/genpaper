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
  buildCitationInstructions,
  type PaperMetadata,
  type CitationStyle
} from '@/lib/citations/unified-service'
import { getProjectCitationStyle } from '@/lib/citations/citation-settings'

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
  marker: string           // Original marker [CITE: id]
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
  suggestion: string       // Text with [CITE: id] markers (for accept/processing)
  displaySuggestion: string // Text with formatted citations (for display)
  citations: CitationInSuggestion[]
  contextHint: string
  ragInfo?: {
    chunksUsed: number
    claimsUsed: number
    papersReferenced: number
  }
}

// Get section-specific writing guidance
function getSectionGuidance(section: string): string {
  const sectionLower = section.toLowerCase()
  
  if (sectionLower.includes('introduction') || sectionLower.includes('background')) {
    return 'Focus on establishing context, defining key terms, and stating the research problem or motivation.'
  }
  if (sectionLower.includes('method')) {
    return 'Focus on describing procedures, materials, participants, or analytical approaches.'
  }
  if (sectionLower.includes('result')) {
    return 'Focus on reporting findings and observations without interpretation.'
  }
  if (sectionLower.includes('discussion')) {
    return 'Focus on interpreting results, comparing with prior work, and explaining implications.'
  }
  if (sectionLower.includes('conclusion')) {
    return 'Focus on summarizing key findings and their broader significance.'
  }
  if (sectionLower.includes('literature') || sectionLower.includes('review')) {
    return 'Focus on synthesizing prior research, identifying themes, and positioning the current work.'
  }
  
  return 'Continue in an appropriate academic tone.'
}

// Format papers list for AI prompt with explicit IDs
function formatPapersForAI(ragContext: EditorContext): string {
  const papers: string[] = []
  
  for (const [id, paper] of ragContext.papers) {
    const authorStr = paper.authors?.length > 0 
      ? paper.authors.slice(0, 2).join(', ') + (paper.authors.length > 2 ? ' et al.' : '')
      : 'Unknown'
    
    papers.push(`- Paper ID: ${id}
  Title: "${paper.title}"
  Authors: ${authorStr}
  Year: ${paper.year}`)
  }
  
  return papers.length > 0 ? papers.join('\n\n') : 'No papers available.'
}

// Build RAG-grounded prompt with unified citation format
function buildRAGPrompt(
  suggestionType: SuggestionType,
  context: CompletionRequest['context'],
  topic: string,
  sectionGuidance: string,
  ragFormatted: { chunksText: string; claimsText: string },
  papersForAI: string,
  outlineContext: string
): { system: string; user: string } {
  
  const citationInstructions = buildCitationInstructions()
  
  const baseSystemPrompt = `You are an expert academic writing assistant. You MUST ground your writing in the provided source material.

## Research Topic
${topic}

## Current Section: ${context.currentSection}
${sectionGuidance}

## Document Structure
${outlineContext}

## SOURCE MATERIAL (Ground your writing in these sources)

### Relevant Text Excerpts from Papers:
${ragFormatted.chunksText}

### Key Claims from Research:
${ragFormatted.claimsText}

### Available Papers for Citation:
${papersForAI}

${citationInstructions}

## CRITICAL RULES
- You MUST ONLY make claims that are supported by the source material above
- You MUST cite sources using [CITE: paper_id] format when referencing their content
- You MUST ONLY cite papers from the "Available Papers for Citation" list - use the exact Paper ID
- Do NOT invent facts or citations - if you can't support a claim, don't make it
- Write 1-2 sentences maximum
- Use academic tone

## Output Format
Return ONLY a JSON object:
{"text": "your completion with [CITE: paper_id] markers", "contextHint": "2-4 word description"}`

  let userPrompt: string
  let systemAddendum = ''

  switch (suggestionType) {
    case 'opening_sentence':
      systemAddendum = '\n\n## Task: Write an Opening Sentence\nStart this section with a clear topic sentence based on the source material.'
      userPrompt = `Write an opening sentence for the "${context.currentSection}" section using the provided sources.`
      break

    case 'complete_sentence':
      systemAddendum = '\n\n## Task: Complete the Sentence\nFinish the incomplete sentence using information from the sources.'
      userPrompt = `Complete this sentence using the source material:\n"${context.precedingText.slice(-200)}"`
      break

    case 'next_sentence':
      systemAddendum = '\n\n## Task: Continue with Next Sentence\nAdd the next logical sentence based on the source material.'
      userPrompt = `Continue after this text using the sources:\n"${context.precedingText.slice(-300)}"`
      break

    case 'provide_examples':
      systemAddendum = '\n\n## Task: Provide Examples\nProvide specific examples FROM the source material with citations.'
      userPrompt = `Provide examples from the sources following:\n"${context.precedingText.slice(-200)}"`
      break

    case 'contrast_point':
      systemAddendum = '\n\n## Task: Complete Contrasting Point\nComplete the contrast using evidence from the sources.'
      userPrompt = `Complete this contrasting statement using the sources:\n"${context.precedingText.slice(-200)}"`
      break

    case 'contextual':
    default:
      systemAddendum = '\n\n## Task: Contextual Completion\nContinue appropriately using the source material.'
      if (!context.precedingText.trim()) {
        userPrompt = `Write an appropriate opening for the "${context.currentSection}" section using the provided sources.`
      } else {
        userPrompt = `Continue this text using the sources:\n"${context.precedingText.slice(-300)}"`
      }
      break
  }

  return {
    system: baseSystemPrompt + systemAddendum,
    user: userPrompt
  }
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

    // Verify project ownership
    const { data: project, error: projectError } = await supabase
      .from('research_projects')
      .select('id, topic')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Check if papers are available
    if (!paperIds || paperIds.length === 0) {
      return NextResponse.json({ 
        error: 'No papers available',
        message: 'Add papers to your project to enable AI-assisted writing. This ensures suggestions are grounded in real sources.'
      }, { status: 422 })
    }

    // Get citation style for this project
    const citationStyle: CitationStyle = await getProjectCitationStyle(projectId, user.id)

    // RAG RETRIEVAL: Get relevant chunks and claims
    const queryText = `${context.currentSection}: ${context.currentParagraph} ${context.precedingText}`
    
    const ragContext = await retrieveEditorContext(queryText, paperIds, {
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
    const papersForAI = formatPapersForAI(ragContext)

    const outlineContext = context.documentOutline.length > 0
      ? context.documentOutline.map(h => `- ${h}`).join('\n')
      : 'No outline.'

    const sectionGuidance = getSectionGuidance(context.currentSection)

    // Build RAG-grounded prompt with unified citation format
    const { system, user: userPrompt } = buildRAGPrompt(
      suggestionType,
      context,
      topic || project.topic,
      sectionGuidance,
      ragFormatted,
      papersForAI,
      outlineContext
    )

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
