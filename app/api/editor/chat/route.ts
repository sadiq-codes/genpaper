import { createClient } from '@/lib/supabase/server'
import { getLanguageModel } from '@/lib/ai/vercel-client'
import { streamText, type CoreMessage } from 'ai'
import { NextRequest } from 'next/server'
import { documentTools, getConfirmationLevel } from '@/lib/ai/tools/document-tools'
import { ChunkRetriever } from '@/lib/rag/chunk-retriever'

// =============================================================================
// TYPES
// =============================================================================

// Vercel AI SDK sends messages at root level, custom body fields are merged in
interface ChatRequest {
  // Standard Vercel AI SDK fields
  messages: CoreMessage[]
  // Custom fields from useChat body option
  projectId: string
  documentContent?: string
  selectedText?: string
  documentStructure?: string  // Block IDs for precise targeting
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Build system prompt with document and research context.
 */
function buildSystemPrompt(
  topic: string,
  documentContent: string,
  documentStructure: string | undefined,
  selectedText: string | undefined,
  ragContext: string,
  papers: Array<{ id: string; title: string; authors?: string[] }>
): string {
  const papersContext = papers.slice(0, 10).map(p => {
    const authorStr = p.authors?.slice(0, 2).join(', ') || 'Unknown'
    return `- [${p.id}] "${p.title}" by ${authorStr}`
  }).join('\n')

  // Truncate document content but always show full structure
  const truncatedContent = documentContent.slice(0, 3000)
  const contentNote = documentContent.length > 3000 ? '\n[...document continues...]' : ''

  return `You are an AI research assistant helping edit an academic document on: "${topic}"

## Document Structure (use blockId for precise edits)
${documentStructure || 'No structure available - use section names instead'}

## Current Document Content
${truncatedContent}${contentNote}

${selectedText ? `## Selected Text (user is asking about this)
${selectedText}
` : ''}

## Available Sources for Citations
${papersContext || 'No papers available'}

## Relevant Context from Sources
${ragContext || 'No additional context retrieved.'}

## Your Capabilities
You have tools to edit the document:
- insertContent: Add content (use blockId to insert after a specific block)
- replaceBlock: Replace a block's content (PREFERRED - use blockId)
- replaceInSection: Replace content using text search (fallback)
- rewriteSection: Rewrite entire section (requires confirmation)
- deleteContent: Delete content (use blockId when available, requires confirmation)
- addCitation: Insert citation (use blockId to target specific block)
- highlightText: Highlight for review
- addComment: Add a comment

## Guidelines
1. ALWAYS explain what you're about to do before using a tool
2. **PREFER using blockId** from the Document Structure for precise targeting
3. Fall back to section names + searchPhrase only when blockId isn't suitable
4. When referencing sources, use the paper ID in your tool calls
5. For destructive operations (delete, rewrite), explain why
6. Maintain academic tone and precision
7. If you can't find the target, ask the user to clarify

Respond helpfully and cite sources when relevant.`
}

/**
 * Get relevant chunks from RAG for the conversation.
 */
async function getRAGContext(
  query: string,
  projectId: string,
  paperIds: string[]
): Promise<string> {
  if (paperIds.length === 0) {
    return ''
  }

  try {
    const retriever = new ChunkRetriever({
      finalLimit: 8,
      maxPerPaper: 3,
    })

    const result = await retriever.retrieve({
      query,
      paperIds,
    })

    if (result.chunks.length === 0) {
      return ''
    }

    return result.chunks.map((chunk, i) => 
      `[Source ${i + 1} - ${chunk.paper_id}]\n${chunk.content.slice(0, 500)}${chunk.content.length > 500 ? '...' : ''}`
    ).join('\n\n---\n\n')
  } catch (error) {
    console.error('RAG retrieval error:', error)
    return ''
  }
}

/**
 * Save messages to Supabase.
 */
async function saveMessages(
  projectId: string,
  userMessage: CoreMessage,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assistantResponse: { content: string; toolInvocations?: any[] }
) {
  try {
    const supabase = await createClient()
    
    // Save user message
    await supabase.from('chat_messages').insert({
      project_id: projectId,
      role: 'user',
      content: typeof userMessage.content === 'string' 
        ? userMessage.content 
        : JSON.stringify(userMessage.content),
      tool_invocations: [],
    })

    // Save assistant message
    await supabase.from('chat_messages').insert({
      project_id: projectId,
      role: 'assistant',
      content: assistantResponse.content,
      tool_invocations: assistantResponse.toolInvocations || [],
    })
  } catch (error) {
    console.error('Failed to save chat messages:', error)
    // Don't throw - saving is not critical to the chat flow
  }
}

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function POST(request: NextRequest) {
  console.log('[Chat API] POST request received')
  
  try {
    const supabase = await createClient()
    
    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const body: ChatRequest = await request.json()
    console.log('[Chat API] Request body keys:', Object.keys(body))
    
    const { projectId, messages, documentContent = '', selectedText, documentStructure } = body

    if (!projectId || !messages || messages.length === 0) {
      console.log('[Chat API] Missing required fields:', { projectId: !!projectId, messagesLength: messages?.length })
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Verify user owns the project and get project details
    console.log('[Chat API] Looking up project:', projectId, 'for user:', user.id)
    
    const { data: project, error: projectError } = await supabase
      .from('research_projects')
      .select('id, topic')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (projectError || !project) {
      console.log('[Chat API] Project not found:', { projectError, projectId, userId: user.id })
      return new Response(JSON.stringify({ error: 'Project not found', details: projectError?.message }), { 
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    
    console.log('[Chat API] Project found:', project.id, project.topic)

    // Get project papers
    const { data: projectPapers } = await supabase
      .from('project_papers')
      .select(`
        paper_id,
        papers (
          id,
          title,
          authors
        )
      `)
      .eq('project_id', projectId)

    const papers = (projectPapers || [])
      .map(pp => pp.papers)
      .filter(Boolean)
      .map(p => ({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        id: (p as any).id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        title: (p as any).title,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        authors: (p as any).authors,
      }))

    const paperIds = papers.map(p => p.id)

    // Get the last user message for RAG query
    const lastUserMessage = messages
      .filter(m => m.role === 'user')
      .pop()
    
    const ragQuery = typeof lastUserMessage?.content === 'string' 
      ? lastUserMessage.content 
      : ''

    // Get RAG context
    const ragContext = await getRAGContext(ragQuery, projectId, paperIds)

    // Build system prompt
    const systemPrompt = buildSystemPrompt(
      project.topic || 'Research',
      documentContent,
      documentStructure,
      selectedText,
      ragContext,
      papers
    )

    // Sanitize messages: remove ALL tool-related content from messages
    // The AI SDK requires tool calls to have proper state/result format.
    // We strip them entirely to avoid AI_MessageConversionError.
    const sanitizedMessages = messages
      .filter(msg => {
        // Remove any "tool" role messages entirely
        if (msg.role === 'tool') return false
        return true
      })
      .map(msg => {
        // Deep clone and remove any tool-related fields
        const cleaned: Record<string, unknown> = {
          role: msg.role,
          content: msg.content,
        }
        
        // Preserve id if present
        if ('id' in msg) cleaned.id = msg.id
        
        return cleaned as CoreMessage
      })

    // Stream the response with tools
    const result = streamText({
      model: getLanguageModel(),
      system: systemPrompt,
      messages: sanitizedMessages,
      tools: documentTools,
      maxSteps: 5,
      onFinish: async ({ text, toolCalls }) => {
        // Save messages to Supabase after completion
        if (lastUserMessage) {
          await saveMessages(projectId, lastUserMessage, {
            content: text,
            toolInvocations: toolCalls?.map(tc => ({
              toolName: tc.toolName,
              args: tc.args,
              requiresConfirmation: getConfirmationLevel(tc.toolName) !== 'none',
            })),
          })
        }
      },
    })

    return result.toDataStreamResponse()

  } catch (error) {
    console.error('Editor chat error:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to process chat message' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// =============================================================================
// GET - Load chat history
// =============================================================================

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const projectId = request.nextUrl.searchParams.get('projectId')
    if (!projectId) {
      return new Response(JSON.stringify({ error: 'Missing projectId' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Verify ownership and get messages
    const { data: messages, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('project_id', projectId)
      .order('sequence_number', { ascending: true })

    if (error) {
      throw error
    }

    // Transform to CoreMessage format
    // NOTE: We intentionally exclude toolInvocations from loaded history
    // because they're in our custom format and cause AI_MessageConversionError
    // when sent back to the AI SDK. The conversation context is preserved in content.
    const formattedMessages = (messages || []).map(m => ({
      id: m.id,
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
      createdAt: m.created_at,
    }))

    return new Response(JSON.stringify({ messages: formattedMessages }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Failed to load chat history:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to load chat history' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// =============================================================================
// DELETE - Clear chat history
// =============================================================================

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const projectId = request.nextUrl.searchParams.get('projectId')
    if (!projectId) {
      return new Response(JSON.stringify({ error: 'Missing projectId' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Delete all messages for the project (RLS ensures ownership)
    const { error } = await supabase
      .from('chat_messages')
      .delete()
      .eq('project_id', projectId)

    if (error) {
      throw error
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Failed to clear chat history:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to clear chat history' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
