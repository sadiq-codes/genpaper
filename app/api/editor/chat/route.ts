import { createClient } from '@/lib/supabase/server'
import { getLanguageModel } from '@/lib/ai/vercel-client'
import { generateText } from 'ai'
import { NextRequest, NextResponse } from 'next/server'

interface ChatRequest {
  projectId: string
  message: string
  documentContent: string
  papers: Array<{
    id: string
    title: string
    abstract?: string
  }>
  claims?: Array<{
    claim_text: string
    claim_type: string
    paper_title?: string
    paper_authors?: string[]
    paper_year?: number
  }>
  gaps?: Array<{
    gap_type: string
    description: string
    research_opportunity?: string
  }>
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: ChatRequest = await request.json()
    const { projectId, message, documentContent, papers, claims, gaps } = body

    // Verify user owns the project
    const { data: project, error: projectError } = await supabase
      .from('research_projects')
      .select('id, topic')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Build context from papers
    const papersContext = papers.map(p => 
      `- "${p.title}"${p.abstract ? `\n  Abstract: ${p.abstract.slice(0, 300)}...` : ''}`
    ).join('\n')

    // Build context from claims
    const claimsContext = claims?.slice(0, 15).map(c => {
      const source = c.paper_authors?.[0]?.split(' ').pop() || 'Unknown'
      const year = c.paper_year || 'n.d.'
      return `- [${c.claim_type}] ${c.claim_text} (${source}, ${year})`
    }).join('\n') || 'No claims extracted yet'

    // Build context from gaps
    const gapsContext = gaps?.map(g => 
      `- [${g.gap_type}] ${g.description}${g.research_opportunity ? `\n  Opportunity: ${g.research_opportunity}` : ''}`
    ).join('\n') || 'No gaps identified yet'

    // Build the system prompt with full research context
    const systemPrompt = `You are a research writing assistant helping with an academic document on: "${project.topic}"

## Available Papers (${papers.length}):
${papersContext || 'No papers available'}

## Extracted Claims from Papers:
${claimsContext}

## Identified Research Gaps:
${gapsContext}

## Current Document:
${documentContent.slice(0, 2500)}${documentContent.length > 2500 ? '\n[...document continues...]' : ''}

## Your Capabilities:
1. Answer questions about the research topic using the available claims and papers
2. Suggest improvements to the document based on extracted claims
3. Help incorporate claims with proper citations
4. Identify how research gaps could be addressed in the document
5. Provide writing assistance in academic style

## Guidelines:
- When referencing claims, mention the source (e.g., "According to Smith et al. (2023)...")
- When suggesting to add content, be specific about what to add and where
- Use the extracted claims as evidence to support writing suggestions
- Point out research gaps that the document could address
- Maintain academic tone and precision

Respond helpfully and cite sources when relevant.`

    // Generate AI response
    const { text } = await generateText({
      model: getLanguageModel(),
      system: systemPrompt,
      prompt: message,
      maxTokens: 1500,
    })

    // Parse response for citation suggestions
    const citationMatches = text.match(/\(([^)]+),\s*\d{4}\)/g) || []
    const suggestedCitations = citationMatches.map(match => {
      const authorMatch = match.match(/\(([^,]+),/)
      const authorName = authorMatch ? authorMatch[1].trim() : ''
      return papers.find(p => 
        p.title.toLowerCase().includes(authorName.toLowerCase()) ||
        authorName.toLowerCase().includes(p.title.split(' ')[0].toLowerCase())
      )
    }).filter(Boolean)

    // Check if AI suggests inserting content
    const insertMatch = text.match(/(?:add|insert|include)[:\s]+["']([^"']+)["']/i)
    const edits = insertMatch ? [{
      type: 'insert',
      content: insertMatch[1],
    }] : undefined

    return NextResponse.json({
      response: text,
      citations: suggestedCitations.map(p => ({
        id: p!.id,
        title: p!.title,
      })),
      edits,
    })

  } catch (error) {
    console.error('Editor chat error:', error)
    return NextResponse.json(
      { error: 'Failed to process chat message' },
      { status: 500 }
    )
  }
}
