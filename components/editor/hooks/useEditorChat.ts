/**
 * useEditorChat - AI chat hook with document editing tools
 * 
 * Replaces the old useChat hook with:
 * - Vercel AI SDK useChat for streaming
 * - Tool invocation handling with confirmation
 * - Ghost edit previews for visual confirmation
 * - Chat history persistence to Supabase
 * - Integration with TipTap editor
 * - Toast notifications for accept/reject feedback
 */

'use client'

import { useChat } from '@ai-sdk/react'
import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Editor } from '@tiptap/react'
import { DefaultChatTransport, type UIMessage } from 'ai'

// Tool invocation type for our use case
interface ToolInvocation {
  toolName: string
  args: Record<string, unknown>
  state?: string
  result?: unknown
}
import { requiresReview, validateToolCall } from '@/lib/ai/tools/document-tools'
import { getDocumentStructure } from '../extensions/BlockId'
import { serializeForAIContext } from '../utils/ai-context-serializer'
import { truncateDocumentForAIContext } from '../utils/context-truncation'
import { hasGhostEdits } from '../extensions/GhostEdit'
import { computeDocumentChangeRanges } from '../services/doc-diff'

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Generate a stable, CSS-selector-safe ID from a tool invocation.
 * Avoids special characters that break querySelector.
 */
function generateSafeToolId(messageId: string, toolName: string, args: Record<string, unknown>): string {
  // Create a simple hash from the args to make it unique but safe
  const argsString = JSON.stringify(args)
  let hash = 0
  for (let i = 0; i < argsString.length; i++) {
    const char = argsString.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  // Convert to positive hex string
  const hashHex = Math.abs(hash).toString(16)
  return `${messageId}-${toolName}-${hashHex}`
}

const MAX_TOOL_CALLS_PER_MESSAGE = 20

/**
 * Generate a brief summary of what a tool did/would do.
 * Used for AI follow-up responses.
 * 
 * Argument names match the actual tool schemas in document-tools.ts:
 * - insertContent: content, afterBlockId, afterPhrase, location
 * - replaceBlock: blockId, section, searchPhrase, newContent
 * - rewriteSection: section, newContent, reason
 * - deleteContent: blockId, section, searchPhrase, reason
 */
function getToolSummary(toolName: string, args: Record<string, unknown>, accepted: boolean): string {
  const action = accepted ? 'Applied' : 'Rejected'
  
  // Helper to get a preview of content
  const preview = (text: unknown, maxLen = 30) => {
    const str = String(text || '')
    return str.length > maxLen ? str.slice(0, maxLen) + '...' : str
  }
  
  switch (toolName) {
    case 'insertContent': {
      const location = args.afterPhrase || args.afterBlockId || args.location || 'document'
      return `${action} insertion at ${preview(location)}`
    }
    case 'replaceBlock': {
      const target = args.searchPhrase || args.blockId || args.section || 'block'
      return `${action} replacement of "${preview(target)}"`
    }
    case 'rewriteSection': {
      const section = args.section || 'section'
      return `${action} rewrite of ${section}`
    }
    case 'deleteContent': {
      const target = args.searchPhrase || args.blockId || 'content'
      return `${action} deletion of "${preview(target)}"`
    }
    case 'addCitation':
      return `${action} citation`
    case 'highlightText':
      return `${action} highlight`
    case 'addComment':
      return `${action} comment`
    case 'moveBlock':
      return `${action} move to ${preview(args.targetLocation)}`
    case 'mergeBlocks':
      return `${action} merge of blocks`
    case 'splitBlock':
      return `${action} split after "${preview(args.splitAfterPhrase)}"`
    case 'formatText':
      return `${action} ${args.format} formatting`
    case 'insertTable':
      return `${action} table insertion`
    case 'editTable':
      return `${action} table edit (${preview(args.action)})`
    case 'searchDocument':
      return `${action} search for "${preview(args.query)}"`
    case 'searchAndReplace':
      return `${action} replace "${preview(args.find)}" → "${preview(args.replaceWith)}"`
    default:
      return `${action} ${toolName}`
  }
}

// =============================================================================
// API FUNCTIONS
// =============================================================================

async function fetchChatHistory(projectId: string): Promise<UIMessage[]> {
  const response = await fetch(`/api/editor/chat?projectId=${projectId}`)
  if (!response.ok) {
    if (response.status === 404) return []
    throw new Error('Failed to load chat history')
  }
  const data = await response.json()
  if (!data.messages) return []
  
  // Server now returns UIMessage format directly with parts array
  return data.messages as UIMessage[]
}

async function clearChatHistoryApi(projectId: string): Promise<void> {
  const response = await fetch(`/api/editor/chat?projectId=${projectId}`, {
    method: 'DELETE',
  })
  if (!response.ok) throw new Error('Failed to clear chat history')
}

// =============================================================================
// TYPES
// =============================================================================

export interface PendingToolCall {
  id: string
  toolName: string
  args: Record<string, unknown>
  messageId: string
  preview?: string
  appliedCount?: number
  failedCount?: number
}

interface BatchToolResult {
  toolId: string
  toolName: string
  args: Record<string, unknown>
  success: boolean
  message: string
}

interface ActiveBatchReview {
  id: string
  messageId: string
  snapshot: ReturnType<Editor['getJSON']>
  calls: BatchToolResult[]
}

export interface UseEditorChatOptions {
  projectId: string
  editor: Editor | null
}

export interface SendMessageOptions {
  content: string
  mentionedPaperIds?: string[]
  attachedImages?: string[]
}

export interface UseEditorChatReturn {
  /** All chat messages */
  messages: UIMessage[]
  /** Current input value */
  input: string
  /** Handle input change */
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement> | React.ChangeEvent<HTMLTextAreaElement>) => void
  /** Submit a message */
  handleSubmit: (e: React.FormEvent) => void
  /** Send a message programmatically - accepts string or options object */
  sendMessage: (contentOrOptions: string | SendMessageOptions) => void
  /** Is AI currently responding */
  isLoading: boolean
  /** Is chat history being loaded */
  isLoadingHistory: boolean
  /** Error if any */
  error: Error | undefined
  /** Tool calls waiting for confirmation */
  pendingTools: PendingToolCall[]
  /** Confirm a pending tool call */
  confirmTool: (toolId: string) => void
  /** Reject a pending tool call */
  rejectTool: (toolId: string) => void
  /** Confirm all pending tool calls */
  confirmAllTools: () => void
  /** Reject all pending tool calls */
  rejectAllTools: () => void
  /** Clear chat history */
  clearHistory: () => Promise<void>
  /** Reload chat history from server */
  reloadHistory: () => Promise<void>
  /** Whether ghost edits are currently displayed */
  hasGhostPreviews: boolean
  /** Stop the current AI generation */
  stopGeneration: () => void
}

// =============================================================================
// HOOK
// =============================================================================

export function useEditorChat({ 
  projectId, 
  editor,
  enabled = true, // Allows lazy loading - set to false until chat tab is opened
}: UseEditorChatOptions & { enabled?: boolean }): UseEditorChatReturn {
  const queryClient = useQueryClient()
  
  // Local input state for the new API
  const [input, setInput] = useState('')
  
  // Track pending tool confirmations
  const [pendingTools, setPendingTools] = useState<PendingToolCall[]>([])
  
  // Ref to access current pendingTools in callbacks without stale closure issues
  const pendingToolsRef = useRef<PendingToolCall[]>([])
  useEffect(() => {
    pendingToolsRef.current = pendingTools
  }, [pendingTools])
  
  // Track which tools have been executed to prevent double-execution
  const executedTools = useRef<Set<string>>(new Set())
  
  // Track tool results for AI follow-up response
  // Maps messageId -> array of { toolName, accepted, summary }
  const toolResultsRef = useRef<Map<string, Array<{ 
    toolName: string
    toolId: string
    accepted: boolean 
    summary: string 
  }>>>(new Map())
  
  // Track the messageId of the current tool batch for follow-up
  const currentToolMessageIdRef = useRef<string | null>(null)
  // Incremented whenever tool results are recorded (including auto-exec-only flows)
  const [toolResultsVersion, setToolResultsVersion] = useState(0)
  
  // Active batch review (applied edits waiting for Keep/Undo decision)
  const activeBatchReviewRef = useRef<ActiveBatchReview | null>(null)
  
  // Track if ghost previews are active
  const [hasGhostPreviews, setHasGhostPreviews] = useState(false)
  
  // Track if initial history has been loaded
  const historyLoaded = useRef(false)

  // Get current editor content - use ref to avoid stale closures
  const editorRef = useRef<Editor | null>(editor)
  useEffect(() => {
    editorRef.current = editor
  }, [editor])
  
  // Sync ghost preview state with editor
  useEffect(() => {
    if (editor) {
      setHasGhostPreviews(hasGhostEdits(editor))
    }
  }, [editor, pendingTools])
  
  const getEditorContext = useCallback(() => {
    const ed = editorRef.current
    if (!ed) return { documentContent: '', selectedText: undefined, documentStructure: '' }

    // Use citation-aware serializer so AI sees [@paperId#instanceId] markers
    // This prevents AI from adding duplicate citations where they already exist
    let documentContent = serializeForAIContext(ed.state.doc)
    
    const { from, to } = ed.state.selection
    const selectedText = from !== to 
      ? ed.state.doc.textBetween(from, to) 
      : undefined
    
    // Get document structure with block IDs for AI targeting
    // Also shows citation markers and counts per block
    const documentStructure = getDocumentStructure(ed)

    documentContent = truncateDocumentForAIContext(documentContent, {
      maxChars: 20_000,
      focusText: selectedText,
    })

    return { documentContent, selectedText, documentStructure }
  }, [])

  // Create transport for the chat API - memoized to avoid recreation
  const transport = useMemo(() => new DefaultChatTransport({
    api: '/api/editor/chat',
    body: {
      projectId,
    },
  }), [projectId])

  // Vercel AI SDK useChat - new API for v6
  const chat = useChat({
    id: projectId, // Use projectId as chat ID for persistence
    transport,
    onFinish: ({ message }) => {
      // DEBUG: Log ALL part types to understand the structure
      if (process.env.NODE_ENV === 'development') {
        console.log('[useEditorChat] onFinish - ALL PARTS:', 
           
          message.parts?.map((p: any, i: number) => ({
            index: i,
            type: p.type,
            keys: Object.keys(p),
            hasToolInvocation: !!p.toolInvocation,
            toolName: p.toolInvocation?.toolName || p.toolName,
            // For tool-invocation type
            toolInvocationKeys: p.toolInvocation ? Object.keys(p.toolInvocation) : null,
          }))
        )
      }
      
      // Process tool calls when they arrive
      // AI SDK v6 uses different part types - check multiple patterns:
      // - 'tool-invocation' with nested toolInvocation object
      // - Parts with toolInvocation property directly
      // - 'tool-call' type (some versions)
       
      const toolParts = (message.parts || []).filter((p: any) => 
        p.type === 'tool-invocation' || 
        p.type === 'tool-call' ||
        p.toolInvocation !== undefined ||
        (p.type && p.type.startsWith && p.type.startsWith('tool-'))
      )
      
      if (toolParts.length > 0) {
        console.log('[useEditorChat] Found tool parts:', toolParts.length)
        // Vercel AI SDK v6 tool part shapes:
        // 1. { type: 'tool-insertContent', args: {...} } - tool name in type string
        // 2. { type: 'tool-invocation', toolInvocation: { toolName, args } } - nested
        // 3. { type: 'tool-call', toolName, args } - flat
         
        const invocations: ToolInvocation[] = toolParts
          .map((p: any) => {
            // AI SDK v6 often uses type like 'tool-insertContent' where tool name is in the type
            // Extract toolName from type string, or fall back to nested properties
            const toolName = (p.type?.startsWith('tool-') && p.type !== 'tool-invocation' && p.type !== 'tool-call')
              ? p.type.replace('tool-', '')  // 'tool-insertContent' → 'insertContent'
              : (p?.toolInvocation?.toolName ?? p?.toolName)
            
            // Args are directly on the part object in v6, or nested in toolInvocation
            const args = p?.args ?? p?.input ?? p?.toolInvocation?.args ?? p?.toolInvocation?.input ?? {}
            
            if (!toolName) {
              console.log('[useEditorChat] Skipping part - no toolName:', p)
              return null
            }
            
            const parsedArgs = (args && typeof args === 'object') ? args : {}
            
            // Validate tool call completeness
            const validation = validateToolCall(toolName, parsedArgs as Record<string, unknown>)
            if (!validation.valid) {
              console.warn(`[useEditorChat] Invalid tool call "${toolName}":`, validation.error)
              return null
            }
            
            console.log('[useEditorChat] Processing valid tool:', toolName, 'args keys:', Object.keys(parsedArgs))
            
            return {
              toolName,
              args: parsedArgs,
              state: p?.state ?? p?.toolInvocation?.state,
              result: p?.result ?? p?.toolInvocation?.result,
            } as ToolInvocation
          })
          .filter(Boolean) as ToolInvocation[]
        
        if (invocations.length > 0) {
          processToolInvocations(message.id, invocations)
        }
      }
      
      // Debug log for message content
      if (process.env.NODE_ENV === 'development') {
        const textParts = (message.parts || []).filter((p: { type: string }) => p.type === 'text')
        console.log('[useEditorChat] onFinish:', {
          messageId: message.id,
          role: message.role,
          partsCount: message.parts?.length || 0,
          textPartsCount: textParts.length,
          toolPartsCount: toolParts.length,
        })
      }
    },
    onError: (error) => {
      console.error('[useEditorChat] Chat error:', error)
      // Show user-visible feedback so the chat doesn't appear silently stuck
      const message = error?.message || 'Something went wrong'
      if (message.includes('rate limit') || message.includes('429')) {
        // Rate limit errors are handled by ChatLimitBanner
      } else {
        toast.error('Chat error', {
          description: message.length > 120 ? message.slice(0, 120) + '...' : message,
          duration: 5000,
        })
      }
    },
  })

  const { messages, setMessages, sendMessage: chatSendMessage, status, error, stop: chatStop } = chat
  const isLoading = status === 'streaming' || status === 'submitted'

  // Timeout mechanism: detect hung/stalled streams and reset.
  // If isLoading stays true for 90 seconds with no new content, stop the stream.
  const lastActivityRef = useRef<number>(Date.now())
  
  // Track activity: update timestamp whenever messages change while loading
  useEffect(() => {
    if (isLoading) {
      lastActivityRef.current = Date.now()
    }
  }, [isLoading, messages])

  useEffect(() => {
    if (!isLoading) return

    const TIMEOUT_MS = 90_000 // 90 seconds
    const CHECK_INTERVAL_MS = 10_000 // Check every 10 seconds

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current
      if (elapsed > TIMEOUT_MS) {
        console.warn('[useEditorChat] Stream appears hung, stopping after', Math.round(elapsed / 1000), 'seconds of inactivity')
        chatStop()
        toast.error('Response timed out', {
          description: 'The AI stopped responding. Please try again.',
          duration: 5000,
        })
      }
    }, CHECK_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [isLoading, chatStop])

  /**
   * Send tool results back to AI for a follow-up response.
   * Called when all pending tools for a message have been processed.
   */
  const sendToolResultsToAI = useCallback((messageId: string) => {
    const results = toolResultsRef.current.get(messageId)
    if (!results || results.length === 0) return
    
    // Clear the results after sending
    toolResultsRef.current.delete(messageId)
    
    // Categorize results
    const accepted = results.filter(r => r.accepted)
    const readOnlySearchResults = accepted.filter(r => r.toolName === 'searchDocument')
    const acceptedEdits = accepted.filter(r => r.toolName !== 'searchDocument')
    const capOverflow = results.filter(r => !r.accepted && r.summary.startsWith('Capped:'))
    const autoExecFailed = results.filter(r => !r.accepted && r.summary.startsWith('Auto-exec failed:'))
    const targetingFailed = results.filter(r => !r.accepted && r.summary.startsWith('Targeting failed'))
    const userRejected = results.filter(r => !r.accepted && !r.summary.startsWith('Targeting failed') && !r.summary.startsWith('Capped:') && !r.summary.startsWith('Auto-exec failed:') && !r.summary.startsWith('Execution failed:'))
    const executionFailed = results.filter(r => !r.accepted && r.summary.startsWith('Execution failed:'))
    
    // Create a system-style message for AI to respond to
    // Prefix with special marker so we can filter it from chat display
    let resultSummary = ''
    
    const parts: string[] = []

    // Cap overflow — tell AI to use searchAndReplace
    if (capOverflow.length > 0) {
      parts.push(capOverflow[0].summary)
    }

    // Targeting failures — AI can retry with different targeting
    if (targetingFailed.length > 0) {
      const failureDetails = targetingFailed.map(r => `- ${r.toolName}: ${r.summary}`).join('\n')
      parts.push(`${targetingFailed.length} edit(s) failed due to targeting:\n${failureDetails}\nRetry with a shorter/different searchPhrase, or use section name.`)
    }

    // Execution failures
    if (executionFailed.length > 0 || autoExecFailed.length > 0) {
      const allFailed = [...executionFailed, ...autoExecFailed]
      parts.push(`${allFailed.length} edit(s) failed to execute: ${allFailed.map(r => r.summary).join('; ')}`)
    }

    if (readOnlySearchResults.length > 0) {
      parts.push(readOnlySearchResults.map(r => r.summary).join('\n\n'))
    }

    if (acceptedEdits.length > 0) {
      parts.push(`${acceptedEdits.length} edit(s) applied: ${acceptedEdits.map(r => r.summary).join(' ')}`)
    }

    if (userRejected.length > 0) {
      parts.push(`User rejected ${userRejected.length} edit(s). Ask if they'd like a different approach.`)
    }

    if (parts.length === 0) return

    // Build final summary
    if (acceptedEdits.length > 0 && userRejected.length === 0 && targetingFailed.length === 0 && capOverflow.length === 0 && executionFailed.length === 0 && autoExecFailed.length === 0 && readOnlySearchResults.length === 0) {
      resultSummary = `[TOOL_RESULT] User accepted ${acceptedEdits.length === 1 ? 'the edit' : `all ${acceptedEdits.length} edits`}. ${acceptedEdits.map(r => r.summary).join(' ')} Please acknowledge briefly.`
    } else if (acceptedEdits.length === 0 && userRejected.length === 0 && targetingFailed.length === 0 && capOverflow.length === 0 && executionFailed.length === 0 && autoExecFailed.length === 0 && readOnlySearchResults.length > 0) {
      resultSummary = `[TOOL_RESULT] ${readOnlySearchResults.map(r => r.summary).join('\n\n')}`
    } else {
      resultSummary = `[TOOL_RESULT] ${parts.join('\n\n')}`
    }
    
    // Send to AI - this triggers a new response
    const context = getEditorContext()
    chatSendMessage({
      text: resultSummary,
    }, {
      body: {
        projectId,
        ...context,
        isToolResultMessage: true, // Flag for the API to handle specially
      },
    })
  }, [chatSendMessage, getEditorContext, projectId])

  /**
   * Record a tool result. The useEffect below will trigger AI follow-up
   * when pendingTools becomes empty.
   */
  const recordToolResult = useCallback((
    messageId: string, 
    toolId: string,
    toolName: string, 
    accepted: boolean,
    summary: string
  ) => {
    // Track which message we're processing for follow-up
    currentToolMessageIdRef.current = messageId
    
    // Add to results map
    const existing = toolResultsRef.current.get(messageId) || []
    existing.push({ toolName, toolId, accepted, summary })
    toolResultsRef.current.set(messageId, existing)
    setToolResultsVersion((v) => v + 1)
  }, [])

  /**
   * Effect: Send tool results to AI when all pending tools are resolved.
   * This fires when pendingTools becomes empty AND we have recorded results.
   */
  useEffect(() => {
    // Only trigger when pendingTools is empty and we have a message to follow up on
    if (pendingTools.length === 0 && currentToolMessageIdRef.current) {
      const messageId = currentToolMessageIdRef.current
      const results = toolResultsRef.current.get(messageId)
      
      if (results && results.length > 0) {
        // Clear the ref to prevent re-triggering
        currentToolMessageIdRef.current = null
        
        // Small delay to let UI settle before AI responds
        setTimeout(() => {
          sendToolResultsToAI(messageId)
        }, 500)
      }
    }
  }, [pendingTools, sendToolResultsToAI, toolResultsVersion])

  const showBatchChangeHighlights = useCallback((ed: Editor, messageId: string, changes: ReturnType<typeof computeDocumentChangeRanges>) => {
    const successfulCount = activeBatchReviewRef.current?.calls.filter(call => call.success).length ?? 0
    const failedCount = activeBatchReviewRef.current
      ? activeBatchReviewRef.current.calls.length - successfulCount
      : 0

    const batchId = `${messageId}-batch-review`
    setPendingTools([{
      id: batchId,
      toolName: 'batchReview',
      args: { changeCount: changes.length },
      messageId,
      preview: `${changes.length} document change(s) highlighted`,
      appliedCount: successfulCount,
      failedCount,
    }])

    ed.commands.setChangeHighlights(changes)
    setHasGhostPreviews(true)
  }, [])

  /**
   * Coalesce repeated granular replaceBlock calls into a single searchAndReplace.
   *
   * Safety: only coalesce calls that are not block-scoped and do not carry
   * citation payloads, otherwise semantics can change.
   */
  function coalesceToSearchAndReplace(invocations: ToolInvocation[]): ToolInvocation[] {
    if (invocations.length <= MAX_TOOL_CALLS_PER_MESSAGE) return invocations

    // Group replaceBlock calls by (searchPhrase → newContent)
    const replaceGroups = new Map<string, { searchPhrase: string; newContent: string; section?: string; count: number; indices: number[] }>()

    for (let i = 0; i < invocations.length; i++) {
      const inv = invocations[i]
      if (inv.toolName !== 'replaceBlock') continue
      const args = inv.args as Record<string, unknown>
      const searchPhrase = args.searchPhrase as string | undefined
      const newContent = args.newContent as string | undefined
      const section = args.section as string | undefined
      const hasBlockScope = typeof args.blockId === 'string' && args.blockId.length > 0
      const hasCitationPayload = Array.isArray(args.citations) && args.citations.length > 0
      if (!searchPhrase || typeof newContent !== 'string' || hasBlockScope || hasCitationPayload) continue

      const key = JSON.stringify({ searchPhrase, newContent, section })

      const existing = replaceGroups.get(key)
      if (existing) {
        existing.count++
        existing.indices.push(i)
      } else {
        replaceGroups.set(key, { searchPhrase, newContent, section, count: 1, indices: [i] })
      }
    }

    // Only coalesce groups with 2+ calls
    const indicesToRemove = new Set<number>()
    const coalescedInvocations: ToolInvocation[] = []

    for (const [, group] of replaceGroups) {
      if (group.count < 2) continue

      // Mark all individual calls for removal
      for (const idx of group.indices) {
        indicesToRemove.add(idx)
      }

      // Create a single searchAndReplace
      coalescedInvocations.push({
        toolName: 'searchAndReplace',
        args: {
          find: group.searchPhrase,
          replaceWith: group.newContent,
          ...(group.section ? { section: group.section } : {}),
        },
      })

      console.log(
        `[useEditorChat] Coalesced ${group.count} replaceBlock calls into 1 searchAndReplace: "${group.searchPhrase}" → "${group.newContent.slice(0, 40)}..."`
      )
    }

    if (coalescedInvocations.length === 0) return invocations

    // Rebuild: keep non-removed invocations + append coalesced ones
    const result: ToolInvocation[] = []
    for (let i = 0; i < invocations.length; i++) {
      if (!indicesToRemove.has(i)) {
        result.push(invocations[i])
      }
    }
    result.push(...coalescedInvocations)

    toast.info(`Grouped ${indicesToRemove.size} edits into ${coalescedInvocations.length} bulk replacement${coalescedInvocations.length > 1 ? 's' : ''}`, {
      duration: 3000,
    })

    return result
  }

  /**
   * Process tool invocations from a message.
   * Read-only tools execute immediately. Editing tools execute as a batch, then
   * enter Keep/Undo review mode with inline change highlights.
   */
  const processToolInvocations = useCallback((messageId: string, invocations: ToolInvocation[]) => {
    const ed = editorRef.current
    if (!ed) return

    // Do not stack multiple active reviews.
    if (pendingToolsRef.current.length > 0) {
      toast.info('Finish reviewing current AI changes first.')
      return
    }
    
    // Track tool signatures we've seen in THIS batch to deduplicate
    const seenInBatch = new Set<string>()
    const readOnlyQueue: Array<{ toolName: string; args: Record<string, unknown>; toolId: string }> = []
    const reviewQueue: Array<{ toolName: string; args: Record<string, unknown>; toolId: string }> = []

    // --- Pass 1: Coalesce repeated granular replaceBlock calls into searchAndReplace ---
    const coalesced = coalesceToSearchAndReplace(invocations)

    // Cap with structured feedback instead of silent drop
    let workingInvocations = coalesced
    if (coalesced.length > MAX_TOOL_CALLS_PER_MESSAGE) {
      const droppedCount = coalesced.length - MAX_TOOL_CALLS_PER_MESSAGE
      workingInvocations = coalesced.slice(0, MAX_TOOL_CALLS_PER_MESSAGE)

      console.warn(
        `[useEditorChat] Capping ${droppedCount} tool call(s): over per-message cap of ${MAX_TOOL_CALLS_PER_MESSAGE}`
      )
      toast.warning(`Limited to ${MAX_TOOL_CALLS_PER_MESSAGE} edits in one response`, {
        description: `${droppedCount} additional edit${droppedCount > 1 ? 's were' : ' was'} not applied. Use searchAndReplace for bulk changes.`,
        duration: 5000,
      })

      // Record a feedback result so AI knows about the cap
      recordToolResult(
        messageId,
        `${messageId}-cap-overflow`,
        'system',
        false,
        `Capped: ${droppedCount} tool call(s) exceeded the per-message limit of ${MAX_TOOL_CALLS_PER_MESSAGE}. Use searchAndReplace for bulk changes instead of multiple replaceBlock calls.`
      )
    }

    // If structured table insertion is present, skip only TRUE duplicate markdown-table
    // insertContent calls (same target + same headers) from the same response.
    const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')
    const getTableTargetKey = (args: Record<string, unknown>): string => {
      const afterBlockId = typeof args.afterBlockId === 'string' ? args.afterBlockId : ''
      const location = typeof args.location === 'string' ? args.location : ''
      return `${afterBlockId}|${location}`
    }
    const getMarkdownTableHeaders = (content: unknown): string[] | null => {
      if (typeof content !== 'string' || content.trim().length === 0) return null
      const lines = content.split('\n').map(line => line.trim()).filter(Boolean)
      for (let i = 0; i < lines.length - 1; i++) {
        const headerLine = lines[i]
        const separatorLine = lines[i + 1]
        if ((headerLine.match(/\|/g)?.length || 0) < 2) continue
        const isSeparator = /^[:|\-\s]+$/.test(separatorLine) && separatorLine.includes('-') && separatorLine.includes('|')
        if (!isSeparator) continue
        const headers = headerLine
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map(cell => normalizeHeader(cell))
          .filter(Boolean)
        return headers.length > 1 ? headers : null
      }
      return null
    }
    const insertTableSignatures = new Set<string>()
    for (const invocation of workingInvocations) {
      if (invocation.toolName !== 'insertTable') continue
      const args = invocation.args as Record<string, unknown>
      if (!Array.isArray(args.headers) || args.headers.length === 0) continue
      const headers = (args.headers as unknown[])
        .filter((h): h is string => typeof h === 'string')
        .map(normalizeHeader)
      if (headers.length === 0) continue
      insertTableSignatures.add(`${getTableTargetKey(args)}::${headers.join('|')}`)
    }

    for (const invocation of workingInvocations) {
      const toolName = invocation.toolName
      const args = invocation.args as Record<string, unknown>

      if (toolName === 'insertContent' && insertTableSignatures.size > 0) {
        const headers = getMarkdownTableHeaders(args.content)
        if (headers) {
          const signature = `${getTableTargetKey(args)}::${headers.join('|')}`
          if (insertTableSignatures.has(signature)) {
            console.log('[useEditorChat] Skipping duplicate markdown-table insertContent (covered by insertTable)')
            continue
          }
        }
      }
      
      // Generate a CSS-selector-safe tool ID (avoids JSON special chars)
      const toolId = generateSafeToolId(messageId, toolName, args)
      
      // Skip if already executed
      if (executedTools.current.has(toolId)) continue
      
      // DEDUPLICATION: Create a signature based on tool name and content/intent
      // Intentionally EXCLUDES blockId so that identical replacements targeting
      // different blocks (same searchPhrase + same newContent) are caught as duplicates
      const argsSignature = JSON.stringify({
        toolName,
        content: args.content ? String(args.content).slice(0, 100) : undefined,
        newContent: args.newContent ? String(args.newContent).slice(0, 100) : undefined,
        section: args.section,
        location: args.location,
        searchPhrase: args.searchPhrase ? String(args.searchPhrase).slice(0, 50) : undefined,
        find: args.find ? String(args.find).slice(0, 50) : undefined,
        replaceWith: typeof args.replaceWith === 'string' ? args.replaceWith.slice(0, 50) : undefined,
        query: args.query ? String(args.query).slice(0, 50) : undefined,
        action: args.action,
      })
      
      if (seenInBatch.has(argsSignature)) {
        console.log('[useEditorChat] Skipping duplicate tool call:', toolName)
        continue
      }
      seenInBatch.add(argsSignature)
      
      if (requiresReview(toolName)) {
        reviewQueue.push({ toolName, args, toolId })
      } else {
        readOnlyQueue.push({ toolName, args, toolId })
      }
    }

    import('../services/tool-executor')
      .then(({ executeToolsAsUndoGroup }) => {
        // Read-only queue: execute immediately and record outcomes.
        if (readOnlyQueue.length > 0) {
          const readOnlyResults = executeToolsAsUndoGroup(
            ed,
            readOnlyQueue.map(call => ({ toolName: call.toolName, args: call.args }))
          )
          for (let i = 0; i < readOnlyQueue.length; i++) {
            const call = readOnlyQueue[i]
            const succeeded = readOnlyResults[i]?.success ?? false
            const executionMessage = readOnlyResults[i]?.message ?? 'unknown result'
            executedTools.current.add(call.toolId)
            recordToolResult(
              messageId,
              call.toolId,
              call.toolName,
              succeeded,
              succeeded
                ? (call.toolName === 'searchDocument'
                    ? executionMessage
                    : getToolSummary(call.toolName, call.args, true))
                : `Execution failed: ${executionMessage}`
            )
          }
        }

        if (reviewQueue.length === 0) return

        const snapshot = ed.getJSON()
        const reviewResults = executeToolsAsUndoGroup(
          ed,
          reviewQueue.map(call => ({ toolName: call.toolName, args: call.args }))
        )

        const calls: BatchToolResult[] = reviewQueue.map((call, index) => ({
          ...call,
          success: reviewResults[index]?.success ?? false,
          message: reviewResults[index]?.message ?? 'unknown result',
        }))

        const successfulCalls = calls.filter(call => call.success)
        const failedCalls = calls.filter(call => !call.success)

        if (successfulCalls.length > 0) {
          const changes = computeDocumentChangeRanges(snapshot, ed.state.doc)
          if (changes.length > 0) {
            activeBatchReviewRef.current = {
              id: `${messageId}-batch-review`,
              messageId,
              snapshot,
              calls,
            }
            showBatchChangeHighlights(ed, messageId, changes)
            if (failedCalls.length > 0) {
              toast.warning(`${failedCalls.length} edit${failedCalls.length > 1 ? 's' : ''} failed`, {
                description: failedCalls.map(c => c.message).join('; ').slice(0, 120),
                duration: 5000,
              })
            }
            return
          }
        }

        // If we couldn't produce a review state, commit results immediately.
        for (const call of calls) {
          executedTools.current.add(call.toolId)
          recordToolResult(
            messageId,
            call.toolId,
            call.toolName,
            call.success,
            call.success
              ? getToolSummary(call.toolName, call.args, true)
              : `Execution failed: ${call.message}`
          )
        }

        if (successfulCalls.length > 0 && failedCalls.length === 0) {
          toast.success(`Applied ${successfulCalls.length} edit${successfulCalls.length === 1 ? '' : 's'}`, {
            description: 'Press Cmd+Z to undo',
            duration: 3000,
          })
        } else if (successfulCalls.length > 0 && failedCalls.length > 0) {
          toast.warning(`${successfulCalls.length} applied, ${failedCalls.length} failed`, {
            duration: 4000,
          })
        }
      })
      .catch((error) => {
        console.error('[useEditorChat] Failed grouped tool execution:', error)
      })
  }, [recordToolResult, showBatchChangeHighlights])

  const finalizeBatchReview = useCallback((keepChanges: boolean) => {
    const ed = editorRef.current
    const batch = activeBatchReviewRef.current
    if (!ed || !batch) return

    if (!keepChanges) {
      ed.commands.setContent(batch.snapshot)
    }

    ed.commands.clearChangeHighlights()
    setPendingTools([])
    setHasGhostPreviews(false)
    activeBatchReviewRef.current = null

    let successfulCount = 0
    let failedCount = 0
    for (const call of batch.calls) {
      executedTools.current.add(call.toolId)
      if (!call.success) {
        failedCount += 1
        recordToolResult(batch.messageId, call.toolId, call.toolName, false, `Execution failed: ${call.message}`)
        continue
      }

      successfulCount += 1
      recordToolResult(
        batch.messageId,
        call.toolId,
        call.toolName,
        keepChanges,
        getToolSummary(call.toolName, call.args, keepChanges)
      )
    }

    if (keepChanges) {
      toast.success(`Kept ${successfulCount} edit${successfulCount === 1 ? '' : 's'}`, {
        description: failedCount > 0 ? `${failedCount} tool call${failedCount === 1 ? '' : 's'} failed.` : 'Changes finalized.',
        duration: 3500,
      })
    } else {
      toast.info('Undid applied AI changes', {
        description: failedCount > 0 ? `${failedCount} tool call${failedCount === 1 ? '' : 's'} had already failed.` : undefined,
        duration: 3500,
      })
    }
  }, [recordToolResult])

  const confirmAllTools = useCallback(() => {
    finalizeBatchReview(true)
  }, [finalizeBatchReview])

  const rejectAllTools = useCallback(() => {
    finalizeBatchReview(false)
  }, [finalizeBatchReview])

  const confirmTool = useCallback((_toolId: string) => {
    confirmAllTools()
  }, [confirmAllTools])

  const rejectTool = useCallback((_toolId: string) => {
    rejectAllTools()
  }, [rejectAllTools])

  /**
   * Handle input change.
   */
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement> | React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
  }, [])

  /**
   * Custom submit that includes fresh editor context.
   */
  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    
    // Get fresh context right before sending
    const context = getEditorContext()
    
    chatSendMessage({
      text: input,
    }, {
      body: {
        projectId,
        ...context,
      },
    })
    
    setInput('')
  }, [chatSendMessage, input, projectId, getEditorContext, isLoading])

  /**
   * Send a message programmatically.
   * Accepts either a string or an options object with content, mentionedPaperIds, and attachedImages.
   */
  const sendMessage = useCallback((contentOrOptions: string | SendMessageOptions) => {
    if (isLoading) return
    
    const context = getEditorContext()
    
    // Normalize input to options object
    const options: SendMessageOptions = typeof contentOrOptions === 'string'
      ? { content: contentOrOptions }
      : contentOrOptions

    // Build message content - optionally include image references
    let messageContent = options.content
    if (options.attachedImages && options.attachedImages.length > 0) {
      // Append images as markdown for display in chat
      const imageMarkdown = options.attachedImages
        .map(url => `![Attached Image](${url})`)
        .join('\n')
      messageContent = `${messageContent}\n\n${imageMarkdown}`
    }
    
    chatSendMessage({
      text: messageContent,
    }, {
      body: {
        projectId,
        ...context,
        mentionedPaperIds: options.mentionedPaperIds || [],
        attachedImages: options.attachedImages || [],
      },
    })
  }, [chatSendMessage, projectId, getEditorContext, isLoading])

  // Track if we should start prefetching (after initial render settles)
  // Fetch chat history with React Query - cached per project
  // Prefetches immediately in background for instant tab switching
  const { data: historyData, refetch: refetchHistory, isLoading: isLoadingHistory } = useQuery({
    queryKey: ['project', projectId, 'chat', 'history'],
    queryFn: () => fetchChatHistory(projectId),
    enabled: enabled && !!projectId, // Fetch immediately when enabled
    staleTime: Infinity, // Chat history doesn't go stale
    gcTime: 1000 * 60 * 30, // Keep in cache for 30 minutes
  })

  // Load history into chat state when fetched
  useEffect(() => {
    if (historyData && !historyLoaded.current) {
      setMessages(historyData)
      historyLoaded.current = true
    }
  }, [historyData, setMessages])

  // Clear history mutation
  const clearHistoryMutation = useMutation({
    mutationFn: () => clearChatHistoryApi(projectId),
    onSuccess: () => {
      setMessages([])
      executedTools.current.clear()
      setPendingTools([])
      setHasGhostPreviews(false)
      activeBatchReviewRef.current = null
      const ed = editorRef.current
      if (ed) {
        ed.commands.clearChangeHighlights()
      }
      queryClient.invalidateQueries({ queryKey: ['project', projectId, 'chat', 'history'] })
    },
    onError: (error) => {
      console.error('Failed to clear chat history:', error)
    },
  })

  /**
   * Clear chat history.
   */
  const clearHistory = useCallback(async () => {
    clearHistoryMutation.mutate()
  }, [clearHistoryMutation])

  /**
   * Reload chat history from server.
   */
  const reloadHistory = useCallback(async () => {
    historyLoaded.current = false
    await refetchHistory()
  }, [refetchHistory])

  // Filter out tool result messages from display (they start with [TOOL_RESULT])
  const displayMessages = useMemo(() => {
    return messages.filter(msg => {
      if (msg.role !== 'user') return true
      // Check if message text starts with [TOOL_RESULT]
      const text = msg.parts?.find((p: { type: string }) => p.type === 'text') as { type: 'text'; text: string } | undefined
      return !text?.text?.startsWith('[TOOL_RESULT]')
    })
  }, [messages])

  return {
    messages: displayMessages,
    input,
    handleInputChange,
    handleSubmit,
    sendMessage,
    isLoading,
    isLoadingHistory,
    error,
    pendingTools,
    confirmTool,
    rejectTool,
    confirmAllTools,
    rejectAllTools,
    clearHistory,
    reloadHistory,
    hasGhostPreviews,
    stopGeneration: chatStop,
  }
}
