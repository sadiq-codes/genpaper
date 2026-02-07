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
import { getConfirmationLevel, validateToolCall, type ToolConfirmationLevel } from '@/lib/ai/tools/document-tools'
import { getDocumentStructure } from '../extensions/BlockId'
import { calculateEdit, type CalculatedEdit } from '../services/edit-calculator'
import { serializeForAIContext } from '../utils/ai-context-serializer'
import { hasGhostEdits, getActiveEditIndex } from '../extensions/GhostEdit'

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

/**
 * Generate a brief summary of what a tool did/would do.
 * Used for AI follow-up responses.
 * 
 * Argument names match the actual tool schemas in document-tools.ts:
 * - insertContent: content, afterBlockId, afterPhrase, location
 * - replaceBlock: blockId, section, searchPhrase, newContent
 * - replaceInSection: section, searchPhrase, newContent
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
    case 'replaceInSection': {
      const section = args.section || 'section'
      const phrase = args.searchPhrase
      return `${action} replacement in ${section}${phrase ? `: "${preview(phrase)}"` : ''}`
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
  confirmationLevel: ToolConfirmationLevel
  preview?: string
  messageId: string
  /** Calculated edit for ghost preview (if applicable) */
  calculatedEdit?: CalculatedEdit
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
  /** Current active edit index (1-based) for toolbar navigation */
  activeEditIndex: number
  /** Navigate to next/prev edit in the editor */
  navigateEdit: (direction: 'next' | 'prev') => void
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
  
  // Refs for confirm/reject functions to avoid stale closures in inline callbacks
  const confirmToolRef = useRef<((toolId: string) => void) | null>(null)
  const rejectToolRef = useRef<((toolId: string) => void) | null>(null)
  
  // Track if an accept/reject is currently in progress to prevent race conditions
  const isProcessingRef = useRef(false)
  const pendingActionsRef = useRef<Array<{ type: 'confirm' | 'reject'; toolId: string }>>([])
  
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
  
  // Listen for ghost edits invalidation (when document changes externally)
  // Try to recalculate positions, or clear if not possible
  useEffect(() => {
    if (!editor) return
    
    const handleGhostEditsInvalidated = (event: Event) => {
      const customEvent = event as CustomEvent<{ editIds: string[]; reason: string }>
      const { editIds, reason } = customEvent.detail
      
      console.log('[useEditorChat] Ghost edits invalidated:', { editIds, reason })
      
      // Get current pending tools that match the invalidated IDs
      const currentPending = pendingToolsRef.current.filter(t => editIds.includes(t.id))
      
      if (currentPending.length === 0) {
        // Nothing to recalculate
        setPendingTools([])
        setHasGhostPreviews(false)
        return
      }
      
      // Try to recalculate positions for each pending tool
      const recalculated: PendingToolCall[] = []
      let invalidCount = 0
      
      for (const tool of currentPending) {
        const result = calculateEdit(editor, tool.toolName, tool.args, tool.id)
        if (result.success && result.edit) {
          recalculated.push({
            ...tool,
            calculatedEdit: result.edit,
          })
        } else {
          console.log(`[useEditorChat] Could not recalculate edit "${tool.toolName}" after document change`)
          executedTools.current.add(tool.id) // Mark as handled
          invalidCount++
        }
      }
      
      if (recalculated.length > 0) {
        // Update pending tools with recalculated positions
        setPendingTools(recalculated)
        
        // Re-show ghost previews with new positions
        const recalculatedEdits = recalculated
          .map(t => t.calculatedEdit)
          .filter((e): e is CalculatedEdit => e !== undefined)
        
        if (recalculatedEdits.length > 0) {
          // Use setTimeout to ensure state is updated before showing previews
          setTimeout(() => {
            editor.commands.setGhostEdits(
              recalculatedEdits,
              (editId) => confirmToolRef.current?.(editId),
              (editId) => rejectToolRef.current?.(editId)
            )
          }, 0)
        }
        
        // Show toast indicating edits were recalculated
        if (invalidCount > 0) {
          toast.info('Edits recalculated', {
            description: `${recalculated.length} edit${recalculated.length > 1 ? 's' : ''} updated, ${invalidCount} removed.`,
            duration: 3000,
          })
        }
        // Don't show toast if all edits were successfully recalculated - less noisy
      } else {
        // All edits became invalid
        setPendingTools([])
        setHasGhostPreviews(false)
        
        if (invalidCount > 0) {
          toast.info('Pending edits cleared', {
            description: 'Document was modified and edits could not be recalculated.',
            duration: 3000,
          })
        }
      }
    }
    
    editor.view.dom.addEventListener('ghostedits:invalidated', handleGhostEditsInvalidated)
    
    return () => {
      editor.view.dom.removeEventListener('ghostedits:invalidated', handleGhostEditsInvalidated)
    }
  }, [editor])

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

    // Speed: cap very large documents sent to the chat endpoint.
    // Keep intro + latest context to preserve quality while reducing payload.
    const MAX_DOC_CHARS = 20_000
    if (documentContent.length > MAX_DOC_CHARS) {
      const head = documentContent.slice(0, 6_000)
      const tail = documentContent.slice(-14_000)
      documentContent =
        `[Document truncated for speed: showing first 6000 chars + last 14000 chars of ${documentContent.length}]\n\n` +
        head +
        `\n\n---\n\n` +
        tail
    }

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
    const userRejected = results.filter(r => !r.accepted && !r.summary.startsWith('Targeting failed'))
    const targetingFailed = results.filter(r => !r.accepted && r.summary.startsWith('Targeting failed'))
    
    // Create a system-style message for AI to respond to
    // Prefix with special marker so we can filter it from chat display
    let resultSummary = ''
    
    // Handle targeting failures specially - AI can retry with different targeting
    if (targetingFailed.length > 0) {
      const failureDetails = targetingFailed.map(r => `- ${r.toolName}: ${r.summary}`).join('\n')
      resultSummary = `[TOOL_RESULT] ${targetingFailed.length} edit(s) failed due to targeting issues:\n${failureDetails}\n\nYou can retry with different targeting (try a shorter/different searchPhrase, or use section name instead).`
      
      if (accepted.length > 0) {
        resultSummary += ` ${accepted.length} other edit(s) were accepted: ${accepted.map(r => r.summary).join(' ')}`
      }
    } else if (accepted.length > 0 && userRejected.length === 0) {
      // All accepted
      resultSummary = `[TOOL_RESULT] User accepted ${accepted.length === 1 ? 'the edit' : `all ${accepted.length} edits`}. ${accepted.map(r => r.summary).join(' ')} Please acknowledge briefly.`
    } else if (userRejected.length > 0 && accepted.length === 0) {
      // All rejected by user
      resultSummary = `[TOOL_RESULT] User rejected ${userRejected.length === 1 ? 'the edit' : `all ${userRejected.length} edits`}. Ask if they'd like a different approach.`
    } else {
      // Mixed
      resultSummary = `[TOOL_RESULT] User accepted ${accepted.length} edit(s), rejected ${userRejected.length}. ${accepted.map(r => r.summary).join(' ')} Acknowledge and ask about rejected edits.`
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
  }, [pendingTools, sendToolResultsToAI])

  /**
   * Execute a tool call on the editor.
   * @param toolName - Name of the tool to execute
   * @param args - Tool arguments
   * @param ghostEditId - Optional: If provided, marks the transaction to preserve other ghost previews
   */
  const executeToolCall = useCallback((
    toolName: string, 
    args: Record<string, unknown>,
    ghostEditId?: string
  ) => {
    const ed = editorRef.current
    if (!ed) {
      console.warn('Cannot execute tool: editor not available')
      return
    }

    // Import and execute with optional ghostEditId to preserve other previews
    import('../services/tool-executor').then(({ executeDocumentTool }) => {
      executeDocumentTool(ed, toolName, args, { ghostEditId })
    })
  }, [])

  /**
   * Show ghost edit previews in the editor.
   * 
   * Note: Uses pendingToolsRef to avoid stale closure issues - the callbacks
   * created here will be called later when the user accepts/rejects, and we
   * need to access the current pendingTools state at that time.
   */
  const showGhostPreviews = useCallback((ed: Editor, edits: CalculatedEdit[]) => {
    // Helper to show acceptance/rejection animation
    const showEditAnimation = (editId: string, type: 'accepted' | 'rejected') => {
      // Escape special characters in editId for CSS selector
      const escapedId = CSS.escape(editId)
      const editElement = ed.view.dom.querySelector(`[data-edit-id="${escapedId}"]`) as HTMLElement | null
      if (editElement) {
        // Add animation class
        editElement.classList.add(`ghost-edit-${type}`)
        // Animation will play for ~400ms, then we clear the decoration
        return 350 // Return delay before clearing
      }
      return 0
    }

    // Set up callbacks for when user accepts/rejects via inline buttons
    // Use refs to access the latest confirm/reject functions, avoiding stale closures
    const onAccept = (editId: string) => {
      if (confirmToolRef.current) {
        confirmToolRef.current(editId)
      } else {
        console.warn(`[useEditorChat] confirmToolRef not set for editId: ${editId}`)
      }
    }
    
    const onReject = (editId: string) => {
      if (rejectToolRef.current) {
        rejectToolRef.current(editId)
      } else {
        console.warn(`[useEditorChat] rejectToolRef not set for editId: ${editId}`)
      }
    }

    // Set the ghost edits with callbacks
    ed.commands.setGhostEdits(edits, onAccept, onReject)
    setHasGhostPreviews(true)
  }, []) // Callbacks use refs to access latest functions, no deps needed

  /**
   * Process tool invocations from a message.
   * Queue those requiring confirmation with ghost previews, execute others immediately.
   * 
   * Includes deduplication to prevent duplicate tool calls from creating multiple previews.
   */
  const processToolInvocations = useCallback((messageId: string, invocations: ToolInvocation[]) => {
    const ed = editorRef.current
    const newPending: PendingToolCall[] = []
    const calculatedEdits: CalculatedEdit[] = []
    
    // Track tool signatures we've seen in THIS batch to deduplicate
    const seenInBatch = new Set<string>()

    for (const invocation of invocations) {
      const toolName = invocation.toolName
      const args = invocation.args as Record<string, unknown>
      
      // Generate a CSS-selector-safe tool ID (avoids JSON special chars)
      const toolId = generateSafeToolId(messageId, toolName, args)
      
      // Skip if already executed
      if (executedTools.current.has(toolId)) continue
      
      // DEDUPLICATION: Create a signature based on tool name and key args
      // This catches cases where AI calls the same tool twice with identical intent
      const argsSignature = JSON.stringify({
        toolName,
        // Use key identifying args (content/section/location)
        content: args.content ? String(args.content).slice(0, 100) : undefined,
        section: args.section,
        location: args.location,
        blockId: args.blockId || args.afterBlockId,
        searchPhrase: args.searchPhrase ? String(args.searchPhrase).slice(0, 50) : undefined,
      })
      
      if (seenInBatch.has(argsSignature)) {
        console.log('[useEditorChat] Skipping duplicate tool call:', toolName)
        continue
      }
      seenInBatch.add(argsSignature)
      
      // Also check if a very similar tool is already pending
      const isDuplicateOfPending = pendingToolsRef.current.some(existing => {
        if (existing.toolName !== toolName) return false
        // Check for same target location
        const existingArgs = existing.args
        return (
          existingArgs.section === args.section &&
          existingArgs.location === args.location &&
          (existingArgs.blockId || existingArgs.afterBlockId) === (args.blockId || args.afterBlockId)
        )
      })
      
      if (isDuplicateOfPending) {
        console.log('[useEditorChat] Skipping tool call - similar edit already pending:', toolName)
        continue
      }

      const confirmLevel = getConfirmationLevel(toolName)

      if (confirmLevel === 'none') {
        // Execute immediately
        executeToolCall(toolName, args)
        executedTools.current.add(toolId)
      } else {
        // Calculate edit positions for ghost preview
        let calcEdit: CalculatedEdit | undefined
        if (ed) {
          const result = calculateEdit(
            ed,
            toolName,
            args,
            toolId
          )
          if (result.success && result.edit) {
            calcEdit = result.edit
            calculatedEdits.push(calcEdit)
          }
        }

        // Queue for confirmation
        newPending.push({
          id: toolId,
          toolName: toolName,
          args: args,
          confirmationLevel: confirmLevel,
          preview: generatePreview(toolName, args),
          messageId,
          calculatedEdit: calcEdit,
        })
      }
    }

    if (newPending.length > 0) {
      setPendingTools(prev => [...prev, ...newPending])
      
      // Show ghost previews if we have calculated edits
      if (ed && calculatedEdits.length > 0) {
        showGhostPreviews(ed, calculatedEdits)
      }
    }
  }, [executeToolCall, showGhostPreviews])

  /**
   * Generate a preview string for a tool call.
   */
  const generatePreview = (toolName: string, args: Record<string, unknown>): string => {
    // Helper to get target description
    const getTarget = () => {
      if (args.blockId) return `block ${args.blockId}`
      if (args.section && args.searchPhrase) return `"${args.section}": "${(args.searchPhrase as string).slice(0, 50)}..."`
      if (args.section) return `section "${args.section}"`
      if (args.searchPhrase) return `"${(args.searchPhrase as string).slice(0, 50)}..."`
      return 'selected content'
    }

    switch (toolName) {
      case 'insertContent': {
        const location = args.afterBlockId 
          ? `after block ${args.afterBlockId}`
          : args.afterPhrase 
            ? `after "${(args.afterPhrase as string).slice(0, 40)}..."`
            : args.location 
              ? `at ${args.location}`
              : 'at cursor'
        const contentPreview = (args.content as string)?.slice(0, 200) || ''
        return `Insert ${location}:\n"${contentPreview}${contentPreview.length >= 200 ? '...' : ''}"`
      }
      case 'rewriteSection':
        return `Rewrite "${args.section}" section:\n${(args.newContent as string)?.slice(0, 200)}...`
      case 'deleteContent':
        return `Delete ${getTarget()}${args.reason ? `\nReason: ${args.reason}` : ''}`
      case 'replaceBlock':
        return `Replace ${getTarget()}:\nNew content: "${(args.newContent as string)?.slice(0, 150)}..."`
      case 'replaceInSection':
        return `Replace in "${args.section}":\nFind: "${(args.searchPhrase as string)?.slice(0, 80)}..."\nReplace with: "${(args.newContent as string)?.slice(0, 80)}..."`
      default:
        return JSON.stringify(args, null, 2)
    }
  }

  /**
   * Recalculate positions for remaining pending edits after document changes.
   * Returns { valid: edits that could be recalculated, invalidCount: number removed }
   */
  const recalculateRemainingEdits = useCallback((
    ed: Editor,
    remainingTools: PendingToolCall[],
    onTargetingFailure?: (tool: PendingToolCall, error: string) => void
  ): { valid: PendingToolCall[]; invalidCount: number } => {
    const valid: PendingToolCall[] = []
    let invalidCount = 0

    for (const tool of remainingTools) {
      const result = calculateEdit(ed, tool.toolName, tool.args, tool.id)
      if (result.success && result.edit) {
        // Update the calculated edit with new positions
        valid.push({
          ...tool,
          calculatedEdit: result.edit,
        })
      } else {
        // Target no longer exists in document
        const targetInfo = tool.args.searchPhrase 
          ? `text "${(tool.args.searchPhrase as string).slice(0, 30)}..."`
          : tool.args.section 
            ? `section "${tool.args.section}"`
            : tool.args.blockId 
              ? `block ${tool.args.blockId}`
              : 'target'
        const errorMsg = `Could not find ${targetInfo}`
        console.log(`[useEditorChat] Edit "${tool.toolName}" targeting failed: ${errorMsg}`)
        executedTools.current.add(tool.id) // Mark as handled
        invalidCount++
        
        // Report targeting failure if callback provided
        if (onTargetingFailure) {
          onTargetingFailure(tool, errorMsg)
        }
      }
    }

    return { valid, invalidCount }
  }, [])

  /**
   * Process the next action in the queue (if any)
   */
  const processNextAction = useCallback(() => {
    if (pendingActionsRef.current.length === 0) {
      isProcessingRef.current = false
      return
    }
    
    const action = pendingActionsRef.current.shift()!
    if (action.type === 'confirm') {
      confirmToolInternal(action.toolId)
    } else {
      rejectToolInternal(action.toolId)
    }
  }, [])

  /**
   * Internal confirm implementation (called by queue processor)
   */
  const confirmToolInternal = useCallback((toolId: string) => {
    const ed = editorRef.current
    const tool = pendingToolsRef.current.find(t => t.id === toolId)
    if (!tool || !ed) {
      // Tool already processed, move to next
      processNextAction()
      return
    }

    // Show acceptance animation on the diff block (escape ID for CSS selector)
    const escapedId = CSS.escape(toolId)
    const editElement = ed.view.dom.querySelector(`[data-edit-id="${escapedId}"]`)
    if (editElement) {
      editElement.classList.add('diff-block--accepted')
    }

    // Delay execution to let animation play
    setTimeout(() => {
      // Execute the accepted edit
      executeToolCall(tool.toolName, tool.args, toolId)
      executedTools.current.add(toolId)
      
      // Record tool result for AI follow-up
      const summary = getToolSummary(tool.toolName, tool.args, true)
      recordToolResult(tool.messageId, toolId, tool.toolName, true, summary)
      
      // Clear ghost edit for accepted tool
      ed.commands.clearGhostEdit(toolId)
      
      // Get remaining tools (excluding the one we just accepted)
      const remainingTools = pendingToolsRef.current.filter(t => t.id !== toolId)
      
      if (remainingTools.length === 0) {
        // No other edits, just clean up
        setPendingTools([])
        setHasGhostPreviews(false)
        toast.success('Edit accepted', {
          description: 'Press Cmd+Z to undo',
          duration: 3000,
        })
        processNextAction()
        return
      }
      
      // Recalculate positions for remaining edits
      // Record targeting failures so AI can self-correct
      const { valid, invalidCount } = recalculateRemainingEdits(ed, remainingTools, (failedTool, error) => {
        recordToolResult(
          failedTool.messageId, 
          failedTool.id, 
          failedTool.toolName, 
          false, 
          `Targeting failed: ${error}`
        )
      })
      
      // Update pending tools with recalculated positions
      setPendingTools(valid)
      
      if (valid.length > 0) {
        // Update ghost previews with new positions
        const recalculatedEdits = valid
          .map(t => t.calculatedEdit)
          .filter((e): e is CalculatedEdit => e !== undefined)
        
        if (recalculatedEdits.length > 0) {
          showGhostPreviews(ed, recalculatedEdits)
        }
        
        // Show toast with status
        if (invalidCount > 0) {
          toast.success('Edit accepted', {
            description: `${valid.length} edit${valid.length > 1 ? 's' : ''} remaining. ${invalidCount} removed (target not found).`,
            duration: 4000,
          })
        } else {
          toast.success('Edit accepted', {
            description: `${valid.length} edit${valid.length > 1 ? 's' : ''} remaining.`,
            duration: 3000,
          })
        }
      } else {
        // All remaining edits were invalid
        setHasGhostPreviews(false)
        toast.success('Edit accepted', {
          description: invalidCount > 0 
            ? `${invalidCount} other edit${invalidCount > 1 ? 's' : ''} removed (target not found).`
            : 'Press Cmd+Z to undo',
          duration: 3000,
        })
      }
      
      processNextAction()
    }, 300)
  }, [executeToolCall, recalculateRemainingEdits, showGhostPreviews, processNextAction, recordToolResult])

  /**
   * Internal reject implementation (called by queue processor)
   */
  const rejectToolInternal = useCallback((toolId: string) => {
    const ed = editorRef.current
    
    // Check if tool still exists in pending
    const tool = pendingToolsRef.current.find(t => t.id === toolId)
    if (!tool) {
      processNextAction()
      return
    }
    
    // Show rejection animation on the diff block (escape ID for CSS selector)
    const escapedId = CSS.escape(toolId)
    const editElement = ed?.view.dom.querySelector(`[data-edit-id="${escapedId}"]`)
    if (editElement) {
      editElement.classList.add('diff-block--rejected')
    }

    // Delay removal to let animation play
    setTimeout(() => {
      executedTools.current.add(toolId) // Mark as handled (rejected)
      
      // Record tool result for AI follow-up
      const summary = getToolSummary(tool.toolName, tool.args, false)
      recordToolResult(tool.messageId, toolId, tool.toolName, false, summary)
      
      setPendingTools(prev => prev.filter(t => t.id !== toolId))
      
      // Clear ghost edit for this tool
      if (ed) {
        ed.commands.clearGhostEdit(toolId)
        // Update ghost preview state
        const remaining = pendingToolsRef.current.filter(t => t.id !== toolId && t.calculatedEdit)
        setHasGhostPreviews(remaining.length > 0)
      }

      // Show toast notification
      toast.info('Edit rejected', {
        duration: 2000,
      })
      
      processNextAction()
    }, 250)
  }, [processNextAction, recordToolResult])

  /**
   * Confirm a pending tool call (public API - queues the action)
   * 
   * After accepting, recalculates positions of remaining edits so user can
   * continue accepting/rejecting them one by one.
   */
  const confirmTool = useCallback((toolId: string) => {
    // Skip if already processed
    if (executedTools.current.has(toolId)) return
    
    // Add to queue
    pendingActionsRef.current.push({ type: 'confirm', toolId })
    
    // Start processing if not already
    if (!isProcessingRef.current) {
      isProcessingRef.current = true
      processNextAction()
    }
  }, [processNextAction])

  /**
   * Reject a pending tool call (public API - queues the action)
   */
  const rejectTool = useCallback((toolId: string) => {
    // Skip if already processed
    if (executedTools.current.has(toolId)) return
    
    // Add to queue
    pendingActionsRef.current.push({ type: 'reject', toolId })
    
    // Start processing if not already
    if (!isProcessingRef.current) {
      isProcessingRef.current = true
      processNextAction()
    }
  }, [processNextAction])

  /**
   * Confirm all pending tool calls with staggered animation.
   */
  const confirmAllTools = useCallback(() => {
    const ed = editorRef.current
    const toolCount = pendingTools.length
    if (toolCount === 0) return
    
    // Get messageId from first tool for follow-up
    const messageId = pendingTools[0]?.messageId
    
    // Apply acceptance animation to all blocks
    pendingTools.forEach((tool, index) => {
      const escapedId = CSS.escape(tool.id)
      const editElement = ed?.view.dom.querySelector(`[data-edit-id="${escapedId}"]`)
      if (editElement) {
        // Stagger the animation slightly
        setTimeout(() => {
          editElement.classList.add('diff-block--accepted')
        }, index * 50)
      }
    })
    
    // Execute all tools after animation starts
    setTimeout(() => {
      for (const tool of pendingTools) {
        executeToolCall(tool.toolName, tool.args)
        executedTools.current.add(tool.id)
        
        // Record tool result for AI follow-up
        const summary = getToolSummary(tool.toolName, tool.args, true)
        recordToolResult(tool.messageId, tool.id, tool.toolName, true, summary)
      }
      
      setPendingTools([])
      
      // Clear all ghost edits
      if (ed) {
        ed.commands.clearGhostEdits()
      }
      setHasGhostPreviews(false)
      
      // Show summary toast
      toast.success(`All ${toolCount} edit${toolCount !== 1 ? 's' : ''} accepted`, {
        description: 'Document updated',
        duration: 4000,
      })
    }, 300 + (toolCount * 50))
  }, [pendingTools, executeToolCall, recordToolResult])

  /**
   * Reject all pending tool calls with staggered animation.
   */
  const rejectAllTools = useCallback(() => {
    const ed = editorRef.current
    const toolCount = pendingTools.length
    if (toolCount === 0) return
    
    // Apply rejection animation to all blocks
    pendingTools.forEach((tool, index) => {
      const escapedId = CSS.escape(tool.id)
      const editElement = ed?.view.dom.querySelector(`[data-edit-id="${escapedId}"]`)
      if (editElement) {
        // Stagger the animation slightly
        setTimeout(() => {
          editElement.classList.add('diff-block--rejected')
        }, index * 30)
      }
    })
    
    // Clear after animation
    setTimeout(() => {
      for (const tool of pendingTools) {
        executedTools.current.add(tool.id)
        
        // Record tool result for AI follow-up
        const summary = getToolSummary(tool.toolName, tool.args, false)
        recordToolResult(tool.messageId, tool.id, tool.toolName, false, summary)
      }
      
      setPendingTools([])
      
      // Clear all ghost edits
      if (ed) {
        ed.commands.clearGhostEdits()
      }
      setHasGhostPreviews(false)
      
      // Show summary toast
      toast.info(`All ${toolCount} edit${toolCount !== 1 ? 's' : ''} rejected`, {
        duration: 3000,
      })
    }, 250 + (toolCount * 30))
  }, [pendingTools, recordToolResult])

  // Keep refs updated so inline callbacks can access latest functions
  useEffect(() => {
    confirmToolRef.current = confirmTool
    rejectToolRef.current = rejectTool
  }, [confirmTool, rejectTool])

  /**
   * Navigate to next/prev edit in the editor.
   */
  const navigateEdit = useCallback((direction: 'next' | 'prev') => {
    const ed = editorRef.current
    if (ed) {
      ed.commands.navigateGhostEdit(direction)
    }
  }, [])

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

  // Get current active edit index from editor state
  const activeEditIndex = editor ? getActiveEditIndex(editor) : 0

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
    activeEditIndex,
    navigateEdit,
    stopGeneration: chatStop,
  }
}
