/**
 * useEditorChat - AI chat hook with document editing tools
 * 
 * Replaces the old useChat hook with:
 * - Vercel AI SDK useChat for streaming
 * - Tool invocation handling with confirmation
 * - Ghost edit previews for visual confirmation
 * - Chat history persistence to Supabase
 * - Integration with TipTap editor
 */

'use client'

import { useChat } from 'ai/react'
import { useState, useCallback, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Editor } from '@tiptap/react'
import type { Message, ToolInvocation } from 'ai'
import { getConfirmationLevel, type ToolConfirmationLevel } from '@/lib/ai/tools/document-tools'
import { getDocumentStructure } from '../extensions/BlockId'
import { calculateEdit, type CalculatedEdit } from '../services/edit-calculator'
import { hasGhostEdits } from '../extensions/GhostEdit'

// =============================================================================
// API FUNCTIONS
// =============================================================================

interface ChatHistoryMessage {
  id: string
  role: string
  content: string
  toolInvocations?: ToolInvocation[]
}

async function fetchChatHistory(projectId: string): Promise<Message[]> {
  const response = await fetch(`/api/editor/chat?projectId=${projectId}`)
  if (!response.ok) {
    if (response.status === 404) return []
    throw new Error('Failed to load chat history')
  }
  const data = await response.json()
  if (!data.messages) return []
  
  return data.messages.map((m: ChatHistoryMessage) => ({
    id: m.id,
    role: m.role as 'user' | 'assistant',
    content: m.content,
    toolInvocations: m.toolInvocations,
  }))
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

export interface UseEditorChatReturn {
  /** All chat messages */
  messages: Message[]
  /** Current input value */
  input: string
  /** Handle input change */
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement> | React.ChangeEvent<HTMLTextAreaElement>) => void
  /** Submit a message */
  handleSubmit: (e: React.FormEvent) => void
  /** Send a message programmatically */
  sendMessage: (content: string) => void
  /** Is AI currently responding */
  isLoading: boolean
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
  
  // Track pending tool confirmations
  const [pendingTools, setPendingTools] = useState<PendingToolCall[]>([])
  
  // Track which tools have been executed to prevent double-execution
  const executedTools = useRef<Set<string>>(new Set())
  
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

    const documentContent = ed.getText()
    const { from, to } = ed.state.selection
    const selectedText = from !== to 
      ? ed.state.doc.textBetween(from, to) 
      : undefined
    
    // Get document structure with block IDs for AI targeting
    const documentStructure = getDocumentStructure(ed)

    return { documentContent, selectedText, documentStructure }
  }, [])

  // Vercel AI SDK useChat
  const {
    messages,
    input,
    handleInputChange,
    handleSubmit: originalHandleSubmit,
    isLoading,
    error,
    setMessages,
    append,
  } = useChat({
    api: '/api/editor/chat',
    id: projectId, // Use projectId as chat ID for persistence
    body: {
      projectId,
      ...getEditorContext(),
    },
    // Process tool calls when they arrive
    onFinish: (message) => {
      if (message.toolInvocations && message.toolInvocations.length > 0) {
        processToolInvocations(message.id, message.toolInvocations)
      }
    },
  })

  /**
   * Execute a tool call on the editor.
   */
  const executeToolCall = useCallback((toolName: string, args: Record<string, unknown>) => {
    const ed = editorRef.current
    if (!ed) {
      console.warn('Cannot execute tool: editor not available')
      return
    }

    // Import and execute
    import('../services/tool-executor').then(({ executeDocumentTool }) => {
      executeDocumentTool(ed, toolName, args)
    })
  }, [])

  /**
   * Show ghost edit previews in the editor.
   */
  const showGhostPreviews = useCallback((ed: Editor, edits: CalculatedEdit[]) => {
    // Helper to show acceptance/rejection animation
    const showEditAnimation = (editId: string, type: 'accepted' | 'rejected') => {
      const editElement = ed.view.dom.querySelector(`[data-edit-id="${editId}"]`) as HTMLElement | null
      if (editElement) {
        // Add animation class
        editElement.classList.add(`ghost-edit-${type}`)
        // Animation will play for ~400ms, then we clear the decoration
        return 350 // Return delay before clearing
      }
      return 0
    }

    // Set up callbacks for when user accepts/rejects via inline buttons
    const onAccept = (editId: string) => {
      const tool = pendingTools.find(t => t.id === editId)
      if (tool) {
        // Show acceptance animation
        const delay = showEditAnimation(editId, 'accepted')
        
        // Execute the tool and clear after animation
        setTimeout(() => {
          executeToolCall(tool.toolName, tool.args)
          executedTools.current.add(editId)
          
          // Remove from pending
          setPendingTools(prev => prev.filter(t => t.id !== editId))
          
          // Clear this ghost edit
          ed.commands.clearGhostEdit(editId)
        }, delay)
      }
    }
    
    const onReject = (editId: string) => {
      // Show rejection animation
      const delay = showEditAnimation(editId, 'rejected')
      
      // Clear after animation
      setTimeout(() => {
        // Mark as handled (rejected)
        executedTools.current.add(editId)
        
        // Remove from pending
        setPendingTools(prev => prev.filter(t => t.id !== editId))
        
        // Clear this ghost edit
        ed.commands.clearGhostEdit(editId)
      }, delay)
    }

    // Set the ghost edits with callbacks
    ed.commands.setGhostEdits(edits, onAccept, onReject)
    setHasGhostPreviews(true)
  }, [pendingTools, executeToolCall])

  /**
   * Process tool invocations from a message.
   * Queue those requiring confirmation with ghost previews, execute others immediately.
   */
  const processToolInvocations = useCallback((messageId: string, invocations: ToolInvocation[]) => {
    const ed = editorRef.current
    const newPending: PendingToolCall[] = []
    const calculatedEdits: CalculatedEdit[] = []

    for (const invocation of invocations) {
      // Skip if already executed
      const toolId = `${messageId}-${invocation.toolName}-${JSON.stringify(invocation.args)}`
      if (executedTools.current.has(toolId)) continue

      const confirmLevel = getConfirmationLevel(invocation.toolName)

      if (confirmLevel === 'none') {
        // Execute immediately
        executeToolCall(invocation.toolName, invocation.args as Record<string, unknown>)
        executedTools.current.add(toolId)
      } else {
        // Calculate edit positions for ghost preview
        let calcEdit: CalculatedEdit | undefined
        if (ed) {
          const result = calculateEdit(
            ed,
            invocation.toolName,
            invocation.args as Record<string, unknown>,
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
          toolName: invocation.toolName,
          args: invocation.args as Record<string, unknown>,
          confirmationLevel: confirmLevel,
          preview: generatePreview(invocation.toolName, invocation.args as Record<string, unknown>),
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
   * Confirm a pending tool call.
   */
  const confirmTool = useCallback((toolId: string) => {
    const ed = editorRef.current
    const tool = pendingTools.find(t => t.id === toolId)
    if (!tool) return

    executeToolCall(tool.toolName, tool.args)
    executedTools.current.add(toolId)
    setPendingTools(prev => prev.filter(t => t.id !== toolId))
    
    // Clear ghost edit for this tool
    if (ed) {
      ed.commands.clearGhostEdit(toolId)
      // Update ghost preview state
      const remaining = pendingTools.filter(t => t.id !== toolId && t.calculatedEdit)
      setHasGhostPreviews(remaining.length > 0)
    }
  }, [pendingTools, executeToolCall])

  /**
   * Reject a pending tool call.
   */
  const rejectTool = useCallback((toolId: string) => {
    const ed = editorRef.current
    executedTools.current.add(toolId) // Mark as handled (rejected)
    setPendingTools(prev => prev.filter(t => t.id !== toolId))
    
    // Clear ghost edit for this tool
    if (ed) {
      ed.commands.clearGhostEdit(toolId)
      // Update ghost preview state
      const remaining = pendingTools.filter(t => t.id !== toolId && t.calculatedEdit)
      setHasGhostPreviews(remaining.length > 0)
    }
  }, [pendingTools])

  /**
   * Confirm all pending tool calls.
   */
  const confirmAllTools = useCallback(() => {
    const ed = editorRef.current
    
    for (const tool of pendingTools) {
      executeToolCall(tool.toolName, tool.args)
      executedTools.current.add(tool.id)
    }
    
    setPendingTools([])
    
    // Clear all ghost edits
    if (ed) {
      ed.commands.clearGhostEdits()
    }
    setHasGhostPreviews(false)
  }, [pendingTools, executeToolCall])

  /**
   * Reject all pending tool calls.
   */
  const rejectAllTools = useCallback(() => {
    const ed = editorRef.current
    
    for (const tool of pendingTools) {
      executedTools.current.add(tool.id)
    }
    
    setPendingTools([])
    
    // Clear all ghost edits
    if (ed) {
      ed.commands.clearGhostEdits()
    }
    setHasGhostPreviews(false)
  }, [pendingTools])

  /**
   * Custom submit that includes fresh editor context.
   */
  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    
    // Get fresh context right before sending
    const context = getEditorContext()
    
    originalHandleSubmit(e, {
      body: {
        projectId,
        ...context,
      },
    })
  }, [originalHandleSubmit, projectId, getEditorContext])

  /**
   * Send a message programmatically.
   */
  const sendMessage = useCallback((content: string) => {
    const context = getEditorContext()
    
    append({
      role: 'user',
      content,
    }, {
      body: {
        projectId,
        ...context,
      },
    })
  }, [append, projectId, getEditorContext])

  // Fetch chat history with React Query - cached per project
  // Only fetch when enabled (e.g., when chat tab is opened)
  const { data: historyData, refetch: refetchHistory } = useQuery({
    queryKey: ['project', projectId, 'chat', 'history'],
    queryFn: () => fetchChatHistory(projectId),
    enabled: enabled && !!projectId, // Lazy load - only fetch when enabled
    staleTime: Infinity, // Chat history doesn't go stale
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

  return {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    sendMessage,
    isLoading,
    error,
    pendingTools,
    confirmTool,
    rejectTool,
    confirmAllTools,
    rejectAllTools,
    clearHistory,
    reloadHistory,
    hasGhostPreviews,
  }
}
