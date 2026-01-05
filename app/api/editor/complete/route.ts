import { createClient } from '@/lib/supabase/server'
import { openai } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { NextRequest, NextResponse } from 'next/server'
import { generateEmbeddings } from '@/lib/utils/embedding'

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
  papers: Array<{
    id: string
    title: string
    abstract?: string
    authors: string[]
    year: number
  }>
  claims: Array<{
    id: string
    claim_text: string
    claim_type: string
    paper_id: string
    paper_title?: string
    paper_authors?: string[]
    paper_year?: number
  }>
  topic: string
  suggestionType?: SuggestionType
}

interface CitationInSuggestion {
  paperId: string
  marker: string
  startOffset: number
  endOffset: number
}

interface CompletionResponse {
  suggestion: string
  citations: CitationInSuggestion[]
  contextHint: string
}

// Calculate cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dotProduct = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB)
  return magnitude === 0 ? 0 : dotProduct / magnitude
}

// Find most relevant claims based on semantic similarity to context
async function findRelevantClaims(
  contextText: string,
  claims: CompletionRequest['claims'],
  maxClaims: number = 7
): Promise<CompletionRequest['claims']> {
  if (claims.length === 0) return []
  if (claims.length <= maxClaims) return claims

  try {
    const textsToEmbed = [contextText, ...claims.map(c => c.claim_text)]
    const embeddings = await generateEmbeddings(textsToEmbed)
    
    const contextEmbedding = embeddings[0]
    const claimEmbeddings = embeddings.slice(1)

    const scoredClaims = claims.map((claim, index) => ({
      claim,
      score: cosineSimilarity(contextEmbedding, claimEmbeddings[index])
    }))

    scoredClaims.sort((a, b) => b.score - a.score)
    return scoredClaims.slice(0, maxClaims).map(sc => sc.claim)
  } catch (error) {
    console.warn('Failed to rank claims by similarity, returning first N:', error)
    return claims.slice(0, maxClaims)
  }
}

// Parse AI response to extract citations
function parseCitationsFromText(
  text: string,
  papers: CompletionRequest['papers']
): { cleanText: string; citations: CitationInSuggestion[] } {
  const citations: CitationInSuggestion[] = []
  
  const citationRegex = /\(([A-Z][a-z]+(?:\s+et\s+al\.)?),\s*(\d{4})\)/g
  let match
  
  while ((match = citationRegex.exec(text)) !== null) {
    const fullMatch = match[0]
    const authorPart = match[1]
    const year = parseInt(match[2])
    
    const matchingPaper = papers.find(p => {
      const firstAuthorLastName = p.authors[0]?.split(' ').pop()?.toLowerCase()
      const matchAuthor = authorPart.replace(' et al.', '').toLowerCase()
      return firstAuthorLastName === matchAuthor && p.year === year
    })

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

// Build prompt based on suggestion type
function buildPromptForType(
  suggestionType: SuggestionType,
  context: CompletionRequest['context'],
  topic: string,
  sectionGuidance: string,
  claimsContext: string,
  papersContext: string,
  outlineContext: string
): { system: string; user: string } {
  
  const baseSystemPrompt = `You are an expert academic writing assistant.

## Research Topic
${topic}

## Current Section: ${context.currentSection}
${sectionGuidance}

## Document Structure
${outlineContext}

## Relevant Evidence
${claimsContext}

## Available Papers for Citation
${papersContext}

## Rules
- Write 1-2 sentences maximum
- Use academic tone
- Cite sources as (AuthorLastName, Year) when making claims
- Only cite from the available papers list
- Be concise and precise

## Output Format
Return ONLY a JSON object:
{"text": "your completion", "contextHint": "2-4 word description"}`

  let userPrompt: string
  let systemAddendum = ''

  switch (suggestionType) {
    case 'opening_sentence':
      systemAddendum = '\n\n## Task: Write an Opening Sentence\nStart this section with a clear topic sentence that introduces the main concept or sets up the discussion.'
      userPrompt = `Write an opening sentence for the "${context.currentSection}" section.`
      break

    case 'complete_sentence':
      systemAddendum = '\n\n## Task: Complete the Sentence\nFinish the incomplete sentence naturally and grammatically.'
      userPrompt = `Complete this sentence:\n"${context.precedingText.slice(-200)}"`
      break

    case 'next_sentence':
      systemAddendum = '\n\n## Task: Continue with Next Sentence\nAdd the next logical sentence that builds on what was just stated.'
      userPrompt = `Continue after:\n"${context.precedingText.slice(-300)}"`
      break

    case 'provide_examples':
      systemAddendum = '\n\n## Task: Provide Examples\nProvide specific, concrete examples with citations where appropriate.'
      userPrompt = `Provide examples following:\n"${context.precedingText.slice(-200)}"`
      break

    case 'contrast_point':
      systemAddendum = '\n\n## Task: Complete Contrasting Point\nComplete the contrasting or qualifying statement being made.'
      userPrompt = `Complete this contrasting statement:\n"${context.precedingText.slice(-200)}"`
      break

    case 'contextual':
    default:
      systemAddendum = '\n\n## Task: Contextual Completion\nDetermine the best way to continue based on the context.'
      if (!context.precedingText.trim()) {
        userPrompt = `Write an appropriate opening for the "${context.currentSection}" section.`
      } else {
        userPrompt = `Continue this text appropriately:\n"${context.precedingText.slice(-300)}"`
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

    const body: CompletionRequest = await request.json()
    const { projectId, context, papers, claims, topic, suggestionType = 'contextual' } = body

    // Allow empty precedingText for opening_sentence type
    if (!projectId) {
      return NextResponse.json({ error: 'Missing projectId' }, { status: 400 })
    }

    const { data: project, error: projectError } = await supabase
      .from('research_projects')
      .select('id, topic')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Find relevant claims
    const contextText = `${context.currentSection}: ${context.currentParagraph} ${context.precedingText}`
    const relevantClaims = await findRelevantClaims(contextText, claims, 7)

    // Build context strings
    const claimsContext = relevantClaims.length > 0
      ? relevantClaims.map(c => {
          const authorName = c.paper_authors?.[0]?.split(' ').pop() || 'Unknown'
          const year = c.paper_year || 'n.d.'
          return `- "${c.claim_text}" (${authorName}, ${year})`
        }).join('\n')
      : 'No claims available.'

    const papersContext = papers.slice(0, 10).map(p => {
      const firstAuthor = p.authors[0]?.split(' ').pop() || 'Unknown'
      return `- ${firstAuthor} (${p.year}): "${p.title}"`
    }).join('\n') || 'No papers available.'

    const outlineContext = context.documentOutline.length > 0
      ? context.documentOutline.map(h => `- ${h}`).join('\n')
      : 'No outline.'

    const sectionGuidance = getSectionGuidance(context.currentSection)

    // Build type-specific prompt
    const { system, user: userPrompt } = buildPromptForType(
      suggestionType,
      context,
      topic || project.topic,
      sectionGuidance,
      claimsContext,
      papersContext,
      outlineContext
    )

    // Generate completion
    const { text: rawResponse } = await generateText({
      model: openai('gpt-4o-mini'),
      system,
      prompt: userPrompt,
      maxTokens: 300,
      temperature: 0.7,
    })

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

    // Parse citations
    const { cleanText, citations } = parseCitationsFromText(suggestion, papers)

    const response: CompletionResponse = {
      suggestion: cleanText,
      citations,
      contextHint
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
