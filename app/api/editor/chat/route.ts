import { createClient } from '@/lib/supabase/server'
import { getLanguageModel } from '@/lib/ai/vercel-client'
import { streamText, convertToModelMessages, type UIMessage } from 'ai'
import { NextRequest } from 'next/server'
import { documentTools, getConfirmationLevel } from '@/lib/ai/tools/document-tools'
import { ChunkRetriever } from '@/lib/rag/chunk-retriever'
import { PromptService } from '@/lib/prompts/prompt-service'
import { 
  buildChatAUTOMATContext, 
  formatPapersForContext, 
  formatMentionedPapersForContext,
  DEFAULT_CHAT_TOOLS,
} from '@/lib/prompts/automat-context'

// =============================================================================
// TYPES
// =============================================================================

// Vercel AI SDK v6 sends UIMessage[] with parts array, not ModelMessage[] with content
interface ChatRequest {
  // Standard Vercel AI SDK v6 fields
  messages: UIMessage[]
  // Custom fields from useChat body option
  projectId: string
  documentContent?: string
  selectedText?: string
  documentStructure?: string  // Block IDs for precise targeting
  // New: mentioned papers from @ mentions
  mentionedPaperIds?: string[]
  // New: attached images
  attachedImages?: string[]
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Build system prompt with document and research context using AUTOMAT framework.
 * 
 * AUTOMAT: Action, Usage, Target, Output, Method, Appearance, Tone
 * 
 * Optimized for action-oriented chat/editor interactions:
 * - Action-first: Chat is imperative ("rewrite this", "add citations")
 * - Method is critical: Explicit HOW instructions for tool use
 * - Usage provides context: How output will be used (inserted, replaced)
 */
async function buildSystemPrompt(
  userMessage: string,
  topic: string,
  paperType: string,
  documentContent: string,
  documentStructure: string | undefined,
  selectedText: string | undefined,
  ragContext: string,
  papers: Array<{ id: string; title: string; authors?: string[]; year?: number; abstract?: string }>,
  mentionedPapers?: Array<{ id: string; title: string; authors?: string[]; year?: number; abstract?: string }>,
  ragChunks?: Array<{ paper_id: string; content: string }>
): Promise<string> {
  // Build mentioned papers context if any
  const mentionedPapersContext = mentionedPapers && mentionedPapers.length > 0
    ? formatMentionedPapersForContext(mentionedPapers, ragChunks)
    : undefined

  // Build AUTOMAT context
  const context = buildChatAUTOMATContext({
    userMessage,
    projectTopic: topic,
    paperType: paperType || 'research-article',
    documentContent,
    documentStructure,
    selectedText,
    papersContext: formatPapersForContext(papers),
    ragContext: ragContext || 'No additional context retrieved.',
    mentionedPapersContext,
    tools: DEFAULT_CHAT_TOOLS,
  })

  // Build prompt from AUTOMAT template
  return PromptService.buildChatAUTOMATPrompt(context)
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
 * Extract text content from a UIMessage.
 * UIMessage uses parts array, not content field.
 */
function getTextFromUIMessage(message: UIMessage): string {
  const textParts = message.parts.filter(p => p.type === 'text')
  return textParts.map(p => 'text' in p ? p.text : '').join('')
}

/**
 * Save messages to Supabase.
 */
async function saveMessages(
  projectId: string,
  userMessageContent: string,
  assistantResponse: { content: string; toolInvocations?: Array<Record<string, unknown>> }
) {
  try {
    const supabase = await createClient()
    
    // Save user message
    await supabase.from('chat_messages').insert({
      project_id: projectId,
      role: 'user',
      content: userMessageContent,
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
    
    const { 
      projectId, 
      messages, 
      documentContent = '', 
      selectedText, 
      documentStructure,
      mentionedPaperIds = [],
      attachedImages = [],
    } = body

    if (!projectId || !messages || messages.length === 0) {
      console.log('[Chat API] Missing required fields:', { projectId: !!projectId, messagesLength: messages?.length })
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    
    // Log mention context for debugging
    if (mentionedPaperIds.length > 0) {
      console.log('[Chat API] Mentioned papers:', mentionedPaperIds)
    }
    if (attachedImages.length > 0) {
      console.log('[Chat API] Attached images:', attachedImages.length)
    }

    // Verify user owns the project and get project details
    console.log('[Chat API] Looking up project:', projectId, 'for user:', user.id)
    
    const { data: project, error: projectError } = await supabase
      .from('research_projects')
      .select('id, topic, paper_type')
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

    // Get project papers with abstract for mentioned papers
    const { data: projectPapers } = await supabase
      .from('project_papers')
      .select(`
        paper_id,
        papers (
          id,
          title,
          authors,
          year,
          abstract
        )
      `)
      .eq('project_id', projectId)

    type PaperData = { id: string; title: string; authors?: string[]; year?: number; abstract?: string }
    const papers: PaperData[] = (projectPapers || [])
      .map(pp => pp.papers as unknown as PaperData | null)
      .filter((p): p is PaperData => p !== null)

    const paperIds = papers.map(p => p.id)

    // Get the last user message for RAG query
    const lastUserMessage = messages
      .filter(m => m.role === 'user')
      .pop()
    
    // Extract text content from UIMessage parts
    const ragQuery = lastUserMessage 
      ? getTextFromUIMessage(lastUserMessage)
      : ''

    // Get RAG context - prioritize mentioned papers if any
    const ragPaperIds = mentionedPaperIds.length > 0 
      ? [...new Set([...mentionedPaperIds, ...paperIds])] // Mentioned first, then others
      : paperIds
    const ragContext = await getRAGContext(ragQuery, projectId, ragPaperIds)

    // Get paper type from project
    const paperType = project.paper_type || 'literatureReview'

    // Filter mentioned papers for enhanced context
    const mentionedPapers = mentionedPaperIds.length > 0
      ? papers.filter(p => mentionedPaperIds.includes(p.id))
      : undefined

    // Build system prompt using AUTOMAT framework
    const systemPrompt = await buildSystemPrompt(
      ragQuery || '',  // User message for action inference
      project.topic || 'Research',
      paperType,
      documentContent,
      documentStructure,
      selectedText,
      ragContext,
      papers,
      mentionedPapers
    )

    // Filter out tool-related parts from message history before converting
    // Our tools execute on the client side, so we don't want to send tool calls/results
    // back to OpenAI (which would expect tool results we don't have)
    const filteredMessages = messages.map(msg => {
      if (msg.role === 'assistant' && msg.parts) {
        // Filter out tool invocation parts, keep only text parts
        const textParts = msg.parts.filter(p => p.type === 'text')
        // If we have text parts, keep the message with only those
        if (textParts.length > 0) {
          return { ...msg, parts: textParts }
        }
        // If only tool parts (no text), skip this message entirely by returning null
        return null
      }
      return msg
    }).filter((msg): msg is UIMessage => msg !== null)

    // Convert UIMessage[] to ModelMessage[] using SDK's official converter
    // This handles the parts -> content transformation correctly
    const modelMessages = await convertToModelMessages(filteredMessages)

    // Stream the response with tools
    const result = streamText({
      model: getLanguageModel(),
      system: systemPrompt,
      messages: modelMessages,
      tools: documentTools,
      // IMPORTANT: tools execute on the client (browser). Stop after emitting tool calls
      // so the provider never expects tool outputs from the server.
      // stopWhen defaults to stepCountIs(1), which is what we want - no auto-continuation.
      maxOutputTokens: 4096,
      abortSignal: request.signal,
      onFinish: async ({ text, toolCalls }) => {
        // Save messages to Supabase after completion
        if (ragQuery) {
          await saveMessages(projectId, ragQuery, {
            content: text,
            toolInvocations: toolCalls?.map(tc => ({
              toolName: tc.toolName,
              args: 'input' in tc ? tc.input : {},
              requiresConfirmation: getConfirmationLevel(tc.toolName) !== 'none',
            })),
          })
        }
      },
    })

    // Use toUIMessageStreamResponse for useChat compatibility (Vercel AI SDK v6)
    // This returns the proper format with parts array that useChat expects
    return result.toUIMessageStreamResponse()

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

    // Transform to UIMessage format with parts array (Vercel AI SDK v6 format)
    // This ensures consistency between what client sends and receives
    const formattedMessages: UIMessage[] = (messages || []).map(m => ({
      id: m.id,
      role: m.role as 'user' | 'assistant' | 'system',
      parts: [{ type: 'text' as const, text: m.content }],
      createdAt: new Date(m.created_at),
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
