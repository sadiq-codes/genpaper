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
import { getConfirmationLevel, type ToolConfirmationLevel } from '@/lib/ai/tools/document-tools'
import { getDocumentStructure } from '../extensions/BlockId'
import { calculateEdit, type CalculatedEdit } from '../services/edit-calculator'
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

// =============================================================================
// API FUNCTIONS
// =============================================================================

interface ChatHistoryMessage {
  id: string
  role: string
  content: string
  toolInvocations?: ToolInvocation[]
}

async function fetchChatHistory(projectId: string): Promise<UIMessage[]> {
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
    parts: m.toolInvocations ? m.toolInvocations.map(ti => ({ type: 'tool-invocation' as const, ...ti })) : [],
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
      // Process tool calls when they arrive
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolParts = (message.parts || []).filter((p: any) => p.type === 'tool-invocation')
      if (toolParts.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const invocations = toolParts.map((p: any) => p as ToolInvocation)
        processToolInvocations(message.id, invocations)
      }
    },
  })

  const { messages, setMessages, sendMessage: chatSendMessage, status, error } = chat
  const isLoading = status === 'streaming' || status === 'submitted'

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
    // Use pendingToolsRef.current to get fresh state, avoiding stale closure
    const onAccept = (editId: string) => {
      const tool = pendingToolsRef.current.find(t => t.id === editId)
      if (tool) {
        // Show acceptance animation
        const delay = showEditAnimation(editId, 'accepted')
        
        // Execute the tool and clear after animation
        setTimeout(() => {
          // Pass editId to preserve other ghost previews during execution
          executeToolCall(tool.toolName, tool.args, editId)
          executedTools.current.add(editId)
          
          // Remove from pending
          setPendingTools(prev => prev.filter(t => t.id !== editId))
          
          // Clear this ghost edit
          ed.commands.clearGhostEdit(editId)
        }, delay)
      } else {
        console.warn(`[useEditorChat] Tool not found for editId: ${editId}`)
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
  }, [executeToolCall]) // Removed pendingTools from deps since we use ref

  /**
   * Process tool invocations from a message.
   * Queue those requiring confirmation with ghost previews, execute others immediately.
   */
  const processToolInvocations = useCallback((messageId: string, invocations: ToolInvocation[]) => {
    const ed = editorRef.current
    const newPending: PendingToolCall[] = []
    const calculatedEdits: CalculatedEdit[] = []

    for (const invocation of invocations) {
      const toolName = invocation.toolName
      const args = invocation.args as Record<string, unknown>
      
      // Generate a CSS-selector-safe tool ID (avoids JSON special chars)
      const toolId = generateSafeToolId(messageId, toolName, args)
      
      // Skip if already executed
      if (executedTools.current.has(toolId)) continue

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

    // Show acceptance animation on the diff block (escape ID for CSS selector)
    const escapedId = CSS.escape(toolId)
    const editElement = ed?.view.dom.querySelector(`[data-edit-id="${escapedId}"]`)
    if (editElement) {
      editElement.classList.add('diff-block--accepted')
    }

    // Delay execution to let animation play
    setTimeout(() => {
      // Pass toolId to preserve other ghost previews during execution
      executeToolCall(tool.toolName, tool.args, toolId)
      executedTools.current.add(toolId)
      setPendingTools(prev => prev.filter(t => t.id !== toolId))
      
      // Clear ghost edit for this tool
      if (ed) {
        ed.commands.clearGhostEdit(toolId)
        // Update ghost preview state
        const remaining = pendingTools.filter(t => t.id !== toolId && t.calculatedEdit)
        setHasGhostPreviews(remaining.length > 0)
      }

      // Show toast notification
      toast.success('Edit accepted', {
        description: 'Press Cmd+Z to undo',
        duration: 3000,
      })
    }, 300)
  }, [pendingTools, executeToolCall])

  /**
   * Reject a pending tool call.
   */
  const rejectTool = useCallback((toolId: string) => {
    const ed = editorRef.current
    
    // Show rejection animation on the diff block (escape ID for CSS selector)
    const escapedId = CSS.escape(toolId)
    const editElement = ed?.view.dom.querySelector(`[data-edit-id="${escapedId}"]`)
    if (editElement) {
      editElement.classList.add('diff-block--rejected')
    }

    // Delay removal to let animation play
    setTimeout(() => {
      executedTools.current.add(toolId) // Mark as handled (rejected)
      setPendingTools(prev => prev.filter(t => t.id !== toolId))
      
      // Clear ghost edit for this tool
      if (ed) {
        ed.commands.clearGhostEdit(toolId)
        // Update ghost preview state
        const remaining = pendingTools.filter(t => t.id !== toolId && t.calculatedEdit)
        setHasGhostPreviews(remaining.length > 0)
      }

      // Show toast notification
      toast.info('Edit rejected', {
        duration: 2000,
      })
    }, 250)
  }, [pendingTools])

  /**
   * Confirm all pending tool calls with staggered animation.
   */
  const confirmAllTools = useCallback(() => {
    const ed = editorRef.current
    const toolCount = pendingTools.length
    
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
  }, [pendingTools, executeToolCall])

  /**
   * Reject all pending tool calls with staggered animation.
   */
  const rejectAllTools = useCallback(() => {
    const ed = editorRef.current
    const toolCount = pendingTools.length
    
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
  }, [pendingTools])

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
    if (!input.trim()) return
    
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
  }, [chatSendMessage, input, projectId, getEditorContext])

  /**
   * Send a message programmatically.
   * Accepts either a string or an options object with content, mentionedPaperIds, and attachedImages.
   */
  const sendMessage = useCallback((contentOrOptions: string | SendMessageOptions) => {
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
  }, [chatSendMessage, projectId, getEditorContext])

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

  // Get current active edit index from editor state
  const activeEditIndex = editor ? getActiveEditIndex(editor) : 0

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
    activeEditIndex,
    navigateEdit,
  }
}
