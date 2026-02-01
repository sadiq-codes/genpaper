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
  formatRAGChunksForContext,
  DEFAULT_CHAT_TOOLS,
} from '@/lib/prompts/automat-context'
import { getProjectCitationStyle } from '@/lib/citations/citation-settings'

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
  ragChunks?: Array<{ paper_id: string; content: string }>,
  voiceProfileId?: string | null,
  citationStyle?: string
): Promise<string> {
  // Build mentioned papers context if any
  const mentionedPapersContext = mentionedPapers && mentionedPapers.length > 0
    ? formatMentionedPapersForContext(mentionedPapers, ragChunks)
    : undefined

  // Import voice profile types for type safety
  type VoiceProfileId = 'conservative-reviewer' | 'confident-researcher' | 'senior-scholar' | 'balanced-academic'
  const validVoiceIds: VoiceProfileId[] = ['conservative-reviewer', 'confident-researcher', 'senior-scholar', 'balanced-academic']
  const validatedVoiceId = voiceProfileId && validVoiceIds.includes(voiceProfileId as VoiceProfileId)
    ? voiceProfileId as VoiceProfileId
    : undefined

  // Build AUTOMAT context with optional voice and citation style
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
    voiceProfileId: validatedVoiceId,
    citationStyle,
  })

  // Build prompt from AUTOMAT template
  return PromptService.buildChatAUTOMATPrompt(context)
}

/**
 * Get relevant chunks from RAG for the conversation.
 */
interface RAGResult {
  context: string
  chunks: Array<{ paper_id: string; content: string }>  // Raw chunks for mentioned papers context
  metadata: {
    chunksRetrieved: number
    chunksAvailable: number
    truncated: boolean
    papersCovered: number
  }
}

async function getRAGContext(
  query: string,
  projectId: string,
  paperIds: string[]
): Promise<RAGResult> {
  if (paperIds.length === 0) {
    console.log('[Chat API] RAG skipped - no paper IDs provided')
    return { 
      context: '', 
      chunks: [],
      metadata: { chunksRetrieved: 0, chunksAvailable: 0, truncated: false, papersCovered: 0 } 
    }
  }

  try {
    const retriever = new ChunkRetriever({
      // For chat, use a smaller token budget (faster responses)
      maxEvidenceTokens: 8000,
      minChunksFallback: 5,
    })

    console.log('[Chat API] RAG query:', query?.slice(0, 100))
    console.log('[Chat API] RAG paper IDs:', paperIds)

    const result = await retriever.retrieve({
      query,
      paperIds,
    })

    console.log('[Chat API] RAG chunks retrieved:', result.chunks.length)

    if (result.chunks.length === 0) {
      console.log('[Chat API] RAG returned 0 chunks - papers may not be ingested')
      return { 
        context: '', 
        chunks: [],
        metadata: { chunksRetrieved: 0, chunksAvailable: 0, truncated: false, papersCovered: 0 } 
      }
    }

    // Count unique papers
    const uniquePapers = new Set(result.chunks.map(c => c.paper_id)).size
    console.log('[Chat API] RAG covers', uniquePapers, 'unique papers')
    
    // Check if any chunks were truncated
    const truncatedCount = result.chunks.filter(c => c.content.length > 500).length

    // Format RAG chunks using shared utility
    // This keeps paper_ids hidden in an internal reference section
    const context = formatRAGChunksForContext(result.chunks)
    
    // Return raw chunks for mentioned papers context
    const chunks = result.chunks.map(c => ({
      paper_id: c.paper_id,
      content: c.content
    }))
    
    return {
      context,
      chunks,
      metadata: {
        chunksRetrieved: result.chunks.length,
        chunksAvailable: result.chunks.length, // Could be more if we had totalAvailable
        truncated: truncatedCount > 0,
        papersCovered: uniquePapers,
      }
    }
  } catch (error) {
    console.error('[Chat API] RAG retrieval error:', error)
    return { 
      context: '', 
      chunks: [],
      metadata: { chunksRetrieved: 0, chunksAvailable: 0, truncated: false, papersCovered: 0 } 
    }
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

    // Verify user owns the project and get project details including voice config
    console.log('[Chat API] Looking up project:', projectId, 'for user:', user.id)
    
    const { data: project, error: projectError } = await supabase
      .from('research_projects')
      .select('id, topic, paper_type, generation_config')
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

    const extractYear = (publicationDate?: string | null): number | undefined => {
      if (!publicationDate) return undefined
      const parsed = new Date(publicationDate)
      if (Number.isNaN(parsed.getTime())) return undefined
      return parsed.getFullYear()
    }

    // Get project papers from project_citations table
    const { data: projectPapers, error: papersError } = await supabase
      .from('project_citations')
      .select(`
        paper_id,
        papers (
          id,
          title,
          authors,
          publication_date,
          abstract,
          processing_status
        )
      `)
      .eq('project_id', projectId)
    
    if (papersError) {
      console.error('[Chat API] Error fetching project papers:', papersError)
    }
    
    console.log('[Chat API] Found papers in project_citations:', projectPapers?.length || 0)

    type PaperData = { id: string; title: string; authors?: string[]; year?: number; abstract?: string; processing_status?: string }
    interface RawPaper {
      id: string
      title: string
      authors?: string[]
      publication_date?: string | null
      abstract?: string
      processing_status?: string
    }
    const allPapers: PaperData[] = (projectPapers || [])
      .map(pp => {
        const paper = pp.papers as unknown as RawPaper | null
        if (!paper) return null
        return {
          id: paper.id,
          title: paper.title,
          authors: paper.authors,
          year: extractYear(paper.publication_date),
          abstract: paper.abstract,
          processing_status: paper.processing_status
        } as PaperData
      })
      .filter((p): p is PaperData => p !== null)

    // Use all papers for chat context; only processed papers should be used for RAG
    const papers = allPapers
    const processedPapers = allPapers.filter(p => p.processing_status === 'processed' || !p.processing_status)
    const pendingPapers = allPapers.filter(p => p.processing_status === 'pending' || p.processing_status === 'processing')
    
    if (pendingPapers.length > 0) {
      console.log('[Chat API] Papers still processing:', pendingPapers.map(p => p.title?.slice(0, 30)))
    }

    const paperIds = processedPapers.map(p => p.id)
    console.log('[Chat API] Processed paper IDs available for RAG:', paperIds.length)

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
    const ragResult = await getRAGContext(ragQuery, projectId, ragPaperIds)

    // Log RAG metadata for debugging
    console.log('[Chat API] RAG result metadata:', ragResult.metadata)

    // Get paper type from project
    const paperType = project.paper_type || 'literatureReview'

    // Fetch mentioned papers - try project papers first, then fetch directly if not found
    let mentionedPapers: PaperData[] | undefined
    if (mentionedPaperIds.length > 0) {
      // First try to find in project papers
      mentionedPapers = allPapers.filter(p => mentionedPaperIds.includes(p.id))
      console.log('[Chat API] Mentioned papers found in project:', mentionedPapers.length, 'of', mentionedPaperIds.length)
      
      // If some mentioned papers are not in project, fetch them directly
      const missingIds = mentionedPaperIds.filter(id => !mentionedPapers!.some(p => p.id === id))
      if (missingIds.length > 0) {
        console.log('[Chat API] Fetching missing mentioned papers directly:', missingIds)
        const { data: fetchedPapers, error: fetchError } = await supabase
          .from('papers')
          .select('id, title, authors, publication_date, abstract')
          .in('id', missingIds)
        
        if (fetchError) {
          console.error('[Chat API] Error fetching mentioned papers:', fetchError)
        } else if (fetchedPapers && fetchedPapers.length > 0) {
          console.log('[Chat API] Fetched', fetchedPapers.length, 'additional mentioned papers')
          const mapped = fetchedPapers.map(paper => ({
            id: paper.id,
            title: paper.title,
            authors: paper.authors,
            year: extractYear(paper.publication_date),
            abstract: paper.abstract
          })) as PaperData[]
          mentionedPapers = [...mentionedPapers, ...mapped]
        }
      }
      
      if (mentionedPapers.length === 0) {
        mentionedPapers = undefined
      }
    }

    // Add context limitation note if RAG was truncated
    let ragContext = ragResult.context
    if (ragResult.metadata.truncated && ragResult.context) {
      ragContext = `Note: Retrieved evidence has been summarized. ${ragResult.metadata.chunksRetrieved} excerpts from ${ragResult.metadata.papersCovered} paper(s) available.\n\n${ragResult.context}`
    }

    // Extract voice profile from generation config
    const generationConfig = project.generation_config as { voiceProfileId?: string } | null
    const voiceProfileId = generationConfig?.voiceProfileId || null
    
    if (voiceProfileId) {
      console.log('[Chat API] Using project voice profile:', voiceProfileId)
    }

    // Get citation style for this project
    const citationStyle = await getProjectCitationStyle(projectId, user.id)
    console.log('[Chat API] Using citation style:', citationStyle)

    // Build system prompt using AUTOMAT framework
    // Pass ragChunks so mentioned papers can include relevant excerpts
    // Pass voiceProfileId for consistent authorial voice in content-generating actions
    // Pass citationStyle for correct conversational citation format
    const systemPrompt = await buildSystemPrompt(
      ragQuery || '',  // User message for action inference
      project.topic || 'Research',
      paperType,
      documentContent,
      documentStructure,
      selectedText,
      ragContext,
      papers,
      mentionedPapers,
      ragResult.chunks,  // Pass raw chunks for mentioned papers context
      voiceProfileId,    // Pass voice profile for content-generating actions
      citationStyle      // Pass citation style for correct format
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
