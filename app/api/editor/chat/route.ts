import { createClient } from '@/lib/supabase/server'
import { getChatLanguageModel } from '@/lib/ai/vercel-client'
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
import { shouldSkipRAG, type IntentClassification } from '@/lib/ai/intent-classifier'
import { checkAndIncrementChatUsage, formatTimeUntilReset } from '@/lib/billing/usage-limits'

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
  // Tool result follow-up: when true, AI should respond without tools
  isToolResultMessage?: boolean
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
  citationStyle?: string,
  originalResearch?: { has_original_research: boolean; research_question?: string; key_findings?: string } | null
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

  // Build AUTOMAT context with optional voice, citation style, and original research
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
    hasOriginalResearch: originalResearch?.has_original_research,
    researchQuestion: originalResearch?.research_question,
    keyFindings: originalResearch?.key_findings,
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

interface ChatRAGProfile {
  maxEvidenceTokens: number
  retrieveLimit: number
  useReranking: boolean
}

const DEFAULT_CHAT_RAG_PROFILE: ChatRAGProfile = {
  maxEvidenceTokens: 8000,
  retrieveLimit: 100,
  useReranking: false,
}

// Short-lived cache to avoid repeatedly probing mentioned-paper retrieval when
// those papers currently have no chunks. This reduces fallback latency spikes.
const EMPTY_MENTIONED_RAG_CACHE_TTL_MS = 2 * 60 * 1000
const emptyMentionedRagCache = new Map<string, number>()

function getMentionedRagCacheKey(projectId: string, paperIds: string[]): string {
  return `${projectId}:${[...paperIds].sort().join(',')}`
}

function hasFreshEmptyMentionedResult(projectId: string, paperIds: string[]): boolean {
  if (paperIds.length === 0) return false
  const key = getMentionedRagCacheKey(projectId, paperIds)
  const expiresAt = emptyMentionedRagCache.get(key)
  if (!expiresAt) return false
  if (Date.now() > expiresAt) {
    emptyMentionedRagCache.delete(key)
    return false
  }
  return true
}

function markEmptyMentionedResult(projectId: string, paperIds: string[]): void {
  if (paperIds.length === 0) return
  const key = getMentionedRagCacheKey(projectId, paperIds)
  emptyMentionedRagCache.set(key, Date.now() + EMPTY_MENTIONED_RAG_CACHE_TTL_MS)
}

function getAdaptiveChatRAGProfile(
  intent: IntentClassification['intent'],
  hasMentionedPapers: boolean
): ChatRAGProfile {
  // Mention-constrained retrieval can use tighter budgets without hurting quality.
  if (hasMentionedPapers) {
    return {
      maxEvidenceTokens: 5000,
      retrieveLimit: 70,
      useReranking: false,
    }
  }

  // Full research turns keep richer context.
  if (intent === 'research') {
    return DEFAULT_CHAT_RAG_PROFILE
  }

  // Non-research turns (rarely retrieved due classifier safety) use lighter budgets.
  return {
    maxEvidenceTokens: 3500,
    retrieveLimit: 45,
    useReranking: false,
  }
}

/**
 * Evidence chunk for transparency in chat UI.
 * Sent to client so users can see what sources were used.
 */
export interface EvidenceChunk {
  paperId: string
  paperTitle?: string
  content: string        // Truncated excerpt (~200 chars)
}

/**
 * Metadata attached to each assistant message for transparency.
 * Exported for use in client-side types.
 */
export interface ChatMessageMetadata {
  evidence?: EvidenceChunk[]
  ragMetadata?: {
    chunksRetrieved: number
    papersCovered: number
    skipped: boolean      // True if RAG was skipped based on intent
    fallbackUsed: boolean // True if mentioned-only returned 0, fell back to all papers
    intent?: string       // Detected intent: research, editing, chat, meta
    intentConfidence?: number // 0-1, how confident the classifier was
  }
}

async function getRAGContext(
  query: string,
  projectId: string,
  paperIds: string[],
  profile: ChatRAGProfile = DEFAULT_CHAT_RAG_PROFILE
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
      maxEvidenceTokens: profile.maxEvidenceTokens,
      useReranking: profile.useReranking,
      retrieveLimit: profile.retrieveLimit,
    })

    console.log('[Chat API] RAG query:', query?.slice(0, 100))
    console.log('[Chat API] RAG paper IDs:', paperIds)
    console.log('[Chat API] RAG profile:', profile)

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
    
    // Insert both messages in a single batch to avoid partial saves
    const { error } = await supabase.from('chat_messages').insert([
      {
        project_id: projectId,
        role: 'user',
        content: userMessageContent,
        tool_invocations: [],
      },
      {
        project_id: projectId,
        role: 'assistant',
        content: assistantResponse.content,
        tool_invocations: assistantResponse.toolInvocations || [],
      },
    ])

    if (error) {
      console.error('Failed to save chat messages:', error)
    }
  } catch (error) {
    console.error('Failed to save chat messages:', error)
    // Don't throw - saving is not critical to the chat flow
  }
}

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function POST(request: NextRequest) {
  const requestStart = performance.now()
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

    // Check daily usage limits (free tier: 10 chats/day, paid: unlimited)
    const usageCheck = await checkAndIncrementChatUsage(user.id)
    if (!usageCheck.allowed) {
      const timeUntilReset = formatTimeUntilReset(usageCheck.resetsAt)
      return new Response(JSON.stringify({ 
        error: 'Daily chat limit reached',
        code: 'CHAT_LIMIT_REACHED',
        message: `You've used all ${usageCheck.dailyLimit} daily chat messages. Upgrade to a paid plan for unlimited chat, or wait ${timeUntilReset} for your limit to reset.`,
        usage: {
          current: usageCheck.currentUses,
          limit: usageCheck.dailyLimit,
          resetsAt: usageCheck.resetsAt.toISOString(),
        }
      }), { 
        status: 429,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const raw: Record<string, unknown> = await request.json()
    console.log('[Chat API] Request body keys:', Object.keys(raw))
    
    const body = raw as unknown as ChatRequest
    const { 
      projectId, 
      messages, 
      documentContent = '', 
      selectedText, 
      documentStructure,
      isToolResultMessage = false,
    } = body

    const isInlineEdit = typeof raw.isInlineEdit === 'boolean' 
      ? raw.isInlineEdit as boolean 
      : false
    const mentionedPaperIds = Array.isArray(raw.mentionedPaperIds)
      ? raw.mentionedPaperIds as string[]
      : []
    const attachedImages = Array.isArray(raw.attachedImages)
      ? raw.attachedImages as string[]
      : []

    if (!projectId || typeof projectId !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing or invalid projectId' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing or invalid messages' }), { 
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

    // Get the last user message for intent classification
    const lastUserMessage = messages
      .filter(m => m.role === 'user')
      .pop()
    
    // Extract text content from UIMessage parts
    const ragQuery = lastUserMessage 
      ? getTextFromUIMessage(lastUserMessage)
      : ''

    // Fast path for tool-result follow-up turns:
    // skip expensive intent/RAG/paper work and just return a natural confirmation.
    const isToolResultFastPath =
      isToolResultMessage &&
      mentionedPaperIds.length === 0 &&
      attachedImages.length === 0

    // Run intent classification + project fetch in parallel.
    // We fetch papers only if needed after we know intent.
    const intentStart = performance.now()
    console.log('[Chat API] Looking up project:', projectId, 'for user:', user.id)
    const projectPromise = supabase
      .from('research_projects')
      .select('id, topic, paper_type, generation_config')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    let skipRAG = true
    let isTrivialMessage = true
    let intentClassification: IntentClassification = {
      intent: 'chat',
      confidence: 1,
      needsRetrieval: false,
      reasoning: 'Tool result fast path',
    }

    let project: {
      id: string
      topic: string | null
      paper_type: string | null
      generation_config: unknown
    } | null = null
    let projectError: { message?: string } | null = null
    let projectPapers: Array<{ papers: unknown }> | null = null
    let papersError: { message?: string } | null = null

    if (isToolResultFastPath) {
      console.log('[Chat API] Tool-result fast path enabled')
      const projectResult = await projectPromise
      project = projectResult.data
      projectError = projectResult.error
    } else {
      const [intentResult, projectResult] = await Promise.all([
        shouldSkipRAG(ragQuery, mentionedPaperIds.length > 0),
        projectPromise,
      ])

      skipRAG = intentResult.skip
      intentClassification = intentResult.classification
      project = projectResult.data
      projectError = projectResult.error

      // For chat/meta intents with no @mentions, skip paper fetch and paper processing.
      isTrivialMessage =
        (intentClassification.intent === 'chat' || intentClassification.intent === 'meta') &&
        mentionedPaperIds.length === 0 &&
        attachedImages.length === 0

      if (!isTrivialMessage) {
        const papersResult = await supabase
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
        projectPapers = papersResult.data as Array<{ papers: unknown }> | null
        papersError = papersResult.error
      } else {
        console.log('[Chat API] Skipping paper fetch - trivial chat/meta turn')
      }
    }

    const intentEnd = performance.now()
    console.log(`[Chat API] [TIMING] Intent + project fetch: ${(intentEnd - intentStart).toFixed(0)}ms`)
    console.log(`[Chat API] Intent: ${intentClassification.intent} (confidence: ${(intentClassification.confidence * 100).toFixed(0)}%) - ${intentClassification.reasoning}`)

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

    type PaperData = { id: string; title: string; authors?: string[]; year?: number; abstract?: string; processing_status?: string }
    interface RawPaper {
      id: string
      title: string
      authors?: string[]
      publication_date?: string | null
      abstract?: string
      processing_status?: string
    }
    
    let allPapers: PaperData[] = []
    let papers: PaperData[] = []
    let processedPapers: PaperData[] = []
    let paperIds: string[] = []
    
    // Process papers (fetched only when needed for non-trivial turns).
    if (isTrivialMessage) {
      console.log('[Chat API] Skipping paper processing - trivial message detected')
    } else {
      if (papersError) {
        console.error('[Chat API] Error fetching project papers:', papersError)
      }
      
      console.log('[Chat API] Found papers in project_citations:', projectPapers?.length || 0)

      allPapers = (projectPapers || [])
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
      papers = allPapers
      processedPapers = allPapers.filter(p => p.processing_status === 'processed' || !p.processing_status)
      const pendingPapers = allPapers.filter(p => p.processing_status === 'pending' || p.processing_status === 'processing')
      
      if (pendingPapers.length > 0) {
        console.log('[Chat API] Papers still processing:', pendingPapers.map(p => p.title?.slice(0, 30)))
      }

      paperIds = processedPapers.map(p => p.id)
      console.log('[Chat API] Processed paper IDs available for RAG:', paperIds.length)
    }
    
    const ragStart = performance.now()
    let ragResult: RAGResult
    let fallbackUsed = false  // Track if we fell back from mentioned-only to all papers
    const ragProfile = getAdaptiveChatRAGProfile(
      intentClassification.intent,
      mentionedPaperIds.length > 0
    )
    
    if (skipRAG) {
      console.log(`[Chat API] RAG skipped - intent is "${intentClassification.intent}":`, ragQuery.slice(0, 50))
      ragResult = { 
        context: '', 
        chunks: [],
        metadata: { chunksRetrieved: 0, chunksAvailable: 0, truncated: false, papersCovered: 0 } 
      }
    } else {
      // Get RAG context - use ONLY mentioned papers when explicitly @mentioned
      // This focuses retrieval on what the user cares about and speeds up the request
      if (mentionedPaperIds.length > 0) {
        const shouldSkipMentionedProbe = hasFreshEmptyMentionedResult(projectId, mentionedPaperIds)

        if (shouldSkipMentionedProbe && paperIds.length > 0) {
          console.log('[Chat API] RAG fallback - skipping mentioned-only probe (recent empty result)')
          fallbackUsed = true
          ragResult = await getRAGContext(ragQuery, projectId, paperIds, ragProfile)
        } else {
          // Try mentioned papers first
          ragResult = await getRAGContext(ragQuery, projectId, mentionedPaperIds, ragProfile)

          // Fallback: if mentioned-only returns 0 chunks (papers might not be ingested),
          // retry with all processed papers to still provide useful context.
          if (ragResult.chunks.length === 0) {
            markEmptyMentionedResult(projectId, mentionedPaperIds)
            if (paperIds.length > 0) {
              console.log('[Chat API] RAG fallback - mentioned papers returned 0 chunks, trying all processed papers')
              fallbackUsed = true
              ragResult = await getRAGContext(ragQuery, projectId, paperIds, ragProfile)
            }
          }
        }
      } else {
        // No mentions - search all processed papers
        ragResult = await getRAGContext(ragQuery, projectId, paperIds, ragProfile)
      }
    }
    const ragEnd = performance.now()
    console.log(`[Chat API] [TIMING] RAG retrieval: ${(ragEnd - ragStart).toFixed(0)}ms (skipped: ${skipRAG})`)

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

    // Extract voice profile and original research from generation config
    const generationConfig = project.generation_config as { 
      voiceProfileId?: string
      original_research?: { has_original_research: boolean; research_question?: string; key_findings?: string }
    } | null
    const voiceProfileId = generationConfig?.voiceProfileId || null
    const originalResearch = generationConfig?.original_research || null
    
    if (voiceProfileId) {
      console.log('[Chat API] Using project voice profile:', voiceProfileId)
    }

    let citationStyle: string | undefined
    if (!isToolResultFastPath) {
      citationStyle = await getProjectCitationStyle(projectId, user.id)
      console.log('[Chat API] Using citation style:', citationStyle)
    } else {
      console.log('[Chat API] Skipping citation style lookup - tool-result fast path')
    }

    // Build system prompt using AUTOMAT framework for normal turns.
    // For tool-result follow-ups, use a compact no-tools instruction.
    const systemPrompt = isToolResultFastPath
      ? `You are GenPaper's academic writing assistant. A tool action has already completed for this project (${project.topic || 'Research'}). Reply with a brief natural confirmation in 1-2 sentences, and include at most one useful next step. Do not call tools.`
      : await buildSystemPrompt(
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
          citationStyle,     // Pass citation style for correct format
          originalResearch   // Pass original research for findings-anchored responses
        )

    // Filter out tool-related parts from message history before converting
    // Our tools execute on the client side, so we don't want to send tool calls/results
    // back to OpenAI (which would expect tool results we don't have)
    const messagesForModel = isToolResultFastPath ? messages.slice(-4) : messages
    const filteredMessages = messagesForModel.map(msg => {
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

    // Log total time to first token (before streaming starts)
    const prepEnd = performance.now()
    console.log(`[Chat API] [TIMING] Total prep time: ${(prepEnd - requestStart).toFixed(0)}ms (intent+project: ${(intentEnd - intentStart).toFixed(0)}ms, RAG: ${(ragEnd - ragStart).toFixed(0)}ms, prompt: ${(prepEnd - ragEnd).toFixed(0)}ms)`)

    // Stream the response with tools
    // When this is a tool result follow-up, disable tools so AI just responds with text
    const result = streamText({
      model: getChatLanguageModel(),
      system: isToolResultFastPath
        ? systemPrompt
        : isToolResultMessage
        ? `${systemPrompt}\n\n[IMPORTANT: This is a follow-up to tool results. Respond briefly acknowledging what was done. Do NOT use any tools - just provide a short, natural confirmation message.]`
        : systemPrompt,
      messages: modelMessages,
      // Disable tools for tool result messages - AI should just confirm/acknowledge
      tools: isToolResultMessage ? undefined : documentTools,
      // IMPORTANT: tools execute on the client (browser). Stop after emitting tool calls
      // so the provider never expects tool outputs from the server.
      // stopWhen defaults to stepCountIs(1), which is what we want - no auto-continuation.
      maxOutputTokens: isToolResultFastPath ? 220 : isToolResultMessage ? 500 : 4096, // Shorter for confirmations
      abortSignal: request.signal,
      onFinish: async ({ text, toolCalls }) => {
        // Save messages to Supabase after completion
        // Don't save tool result messages or inline edit requests to avoid polluting history
        if (ragQuery && !isToolResultMessage && !isInlineEdit) {
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

    // Build evidence for transparency in chat UI
    // Only include evidence if RAG actually ran and found relevant chunks
    // Limit to 8 chunks max to keep payload reasonable
    const hasRelevantEvidence = !skipRAG && ragResult.chunks.length > 0
    const evidence: EvidenceChunk[] | undefined = hasRelevantEvidence
      ? ragResult.chunks.slice(0, 8).map(chunk => {
          const paper = allPapers.find(p => p.id === chunk.paper_id)
          return {
            paperId: chunk.paper_id,
            paperTitle: paper?.title,
            content: chunk.content.slice(0, 200) + (chunk.content.length > 200 ? '...' : ''),
          }
        })
      : undefined

    // Use toUIMessageStreamResponse for useChat compatibility (Vercel AI SDK v6)
    // Attach evidence metadata so users can see what sources were used
    return result.toUIMessageStreamResponse({
      messageMetadata: () => ({
        evidence,
        ragMetadata: {
          chunksRetrieved: ragResult.metadata.chunksRetrieved,
          papersCovered: ragResult.metadata.papersCovered,
          skipped: skipRAG,
          fallbackUsed,
          intent: intentClassification.intent,
          intentConfidence: intentClassification.confidence,
        },
      } satisfies ChatMessageMetadata),
    })

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
