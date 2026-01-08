import { createClient } from '@/lib/supabase/server'
import { openai } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { NextRequest, NextResponse } from 'next/server'
import { 
  retrieveEditorContext, 
  formatEditorContextForPrompt, 
  verifyAllCitations,
  getFirstAuthorLastName,
  type EditorContext 
} from '@/lib/rag'

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
  // Paper IDs from the project - we'll retrieve chunks/claims from DB
  paperIds: string[]
  topic: string
  suggestionType?: SuggestionType
}

interface CitationInSuggestion {
  paperId: string
  marker: string
  startOffset: number
  endOffset: number
  verified?: boolean
  // Include paper metadata for frontend display
  paper?: {
    id: string
    title: string
    authors: string[]
    year: number
    doi?: string
    venue?: string
  }
}

interface CompletionResponse {
  suggestion: string
  citations: CitationInSuggestion[]
  contextHint: string
  ragInfo?: {
    chunksUsed: number
    claimsUsed: number
    papersReferenced: number
  }
}

// Using getFirstAuthorLastName from @/lib/rag for author name extraction

/**
 * Find a matching paper from RAG context based on author name and year
 */
function findMatchingPaperFromRAG(
  authorPart: string,
  year: number,
  ragContext: EditorContext
): { id: string; authors: string[]; year: number } | undefined {
  const searchName = authorPart
    .replace(/\s+et\s+al\.?/gi, '')
    .replace(/\s+and\s+.*$/i, '')
    .replace(/\s+&\s+.*$/i, '')
    .trim()
    .toLowerCase()

  for (const [, paper] of ragContext.papers) {
    if (!paper.authors || paper.authors.length === 0) continue
    
    const firstAuthorLastName = getFirstAuthorLastName(paper.authors).toLowerCase()
    const yearMatch = Math.abs(paper.year - year) <= 1
    const nameMatch = 
      firstAuthorLastName.includes(searchName) || 
      searchName.includes(firstAuthorLastName) ||
      firstAuthorLastName === searchName

    if (nameMatch && yearMatch) {
      return { id: paper.id, authors: paper.authors, year: paper.year }
    }
  }
  
  return undefined
}

/**
 * Parse AI response to extract citations and match to papers
 */
function parseCitationsFromText(
  text: string,
  ragContext: EditorContext
): { cleanText: string; citations: CitationInSuggestion[] } {
  const citations: CitationInSuggestion[] = []
  
  // Citation regex for (Author, Year) format
  const citationRegex = /\(([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F'\-\s]*?)(?:\s+(?:et\s+al\.|and|&)\s+[A-Za-z\u00C0-\u024F'\-\s]+?)?,\s*(\d{4})\)/g
  
  let match
  
  while ((match = citationRegex.exec(text)) !== null) {
    const fullMatch = match[0]
    const authorPart = match[1]
    const year = parseInt(match[2])
    
    const matchingPaper = findMatchingPaperFromRAG(authorPart, year, ragContext)

    if (matchingPaper) {
      citations.push({
        paperId: matchingPaper.id,
        marker: fullMatch,
        startOffset: match.index,
        endOffset: match.index + fullMatch.length
      })
    }
  }

  return { cleanText: text, citations }
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

// Build RAG-grounded prompt
function buildRAGPrompt(
  suggestionType: SuggestionType,
  context: CompletionRequest['context'],
  topic: string,
  sectionGuidance: string,
  ragFormatted: { chunksText: string; claimsText: string; papersText: string },
  outlineContext: string
): { system: string; user: string } {
  
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
${ragFormatted.papersText}

## CRITICAL RULES
- You MUST ONLY make claims that are supported by the source material above
- You MUST cite sources as (AuthorLastName, Year) when referencing their content
- You MUST ONLY cite papers from the "Available Papers for Citation" list
- Do NOT invent facts or citations - if you can't support a claim, don't make it
- Write 1-2 sentences maximum
- Use academic tone

## Output Format
Return ONLY a JSON object:
{"text": "your completion", "contextHint": "2-4 word description"}`

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

    // ============================================
    // CRITICAL: Check if papers are available
    // ============================================
    if (!paperIds || paperIds.length === 0) {
      return NextResponse.json({ 
        error: 'No papers available',
        message: 'Add papers to your project to enable AI-assisted writing. This ensures suggestions are grounded in real sources.'
      }, { status: 422 })
    }

    // ============================================
    // RAG RETRIEVAL: Get relevant chunks and claims
    // ============================================
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

    const outlineContext = context.documentOutline.length > 0
      ? context.documentOutline.map(h => `- ${h}`).join('\n')
      : 'No outline.'

    const sectionGuidance = getSectionGuidance(context.currentSection)

    // Build RAG-grounded prompt
    const { system, user: userPrompt } = buildRAGPrompt(
      suggestionType,
      context,
      topic || project.topic,
      sectionGuidance,
      ragFormatted,
      outlineContext
    )

    // Generate completion with timeout
    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), 30000)
    
    let rawResponse: string
    try {
      const result = await generateText({
        model: openai('gpt-4o-mini'),
        system,
        prompt: userPrompt,
        maxTokens: 300,
        temperature: 0.5, // Lower temperature for more grounded output
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

    // Parse citations from generated text
    const { cleanText, citations } = parseCitationsFromText(suggestion, ragContext)

    // ============================================
    // CITATION VERIFICATION: Semantic matching
    // ============================================
    let verifiedCitations: CitationInSuggestion[] = []
    if (citations.length > 0) {
      const verificationResults = await verifyAllCitations(
        citations,
        cleanText,
        ragContext,
        0.4 // Semantic similarity threshold
      )
      
      // Only include verified citations, with paper metadata
      verifiedCitations = verificationResults
        .filter(c => c.verified)
        .map(c => {
          const paperMeta = ragContext.papers.get(c.paperId)
          return {
            paperId: c.paperId,
            marker: c.marker,
            startOffset: c.startOffset,
            endOffset: c.endOffset,
            paper: paperMeta ? {
              id: paperMeta.id,
              title: paperMeta.title,
              authors: paperMeta.authors,
              year: paperMeta.year,
              doi: paperMeta.doi,
              venue: paperMeta.venue
            } : undefined
          }
        })
    }

    const response: CompletionResponse = {
      suggestion: cleanText,
      citations: verifiedCitations,
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
