'use client'

import { useRef, useEffect, useCallback, memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Bot, User, Wrench, Trash2 } from 'lucide-react'
import { RichChatInput } from './RichChatInput'
import { EvidencePanel } from './EvidencePanel'
import { ChatLimitBanner, ChatUsageIndicator } from '@/components/billing/chat-limit-banner'
import type { UIMessage } from 'ai'
import type { PendingToolCall } from '../hooks/useEditorChat'
import type { ProjectPaper } from '../types'
import type { ChatMessageMetadata } from '@/app/api/editor/chat/route'
import { cn } from '@/lib/utils'
import { useChatImageUpload } from '../hooks/useChatImageUpload'

// =============================================================================
// CITATION FORMATTING FOR CHAT
// =============================================================================

/**
 * Format a paper citation for display in chat.
 * Uses simple (Author, Year) format - no need for full CSL processing in chat.
 */
function formatChatCitation(paper: ProjectPaper): string {
  const authors = paper.authors || []
  const year = paper.year || 'n.d.'
  
  if (authors.length === 0) {
    // Fallback to title snippet if no authors
    const titleSnippet = paper.title?.split(' ').slice(0, 3).join(' ') || 'Unknown'
    return `(${titleSnippet}..., ${year})`
  }
  
  // Extract last name from first author
  const firstAuthor = authors[0]
  const lastName = firstAuthor.includes(',')
    ? firstAuthor.split(',')[0].trim()
    : firstAuthor.split(' ').pop() || firstAuthor
  
  if (authors.length === 1) {
    return `(${lastName}, ${year})`
  } else if (authors.length === 2) {
    const secondAuthor = authors[1]
    const lastName2 = secondAuthor.includes(',')
      ? secondAuthor.split(',')[0].trim()
      : secondAuthor.split(' ').pop() || secondAuthor
    return `(${lastName} & ${lastName2}, ${year})`
  }
  
  return `(${lastName} et al., ${year})`
}

/**
 * Process content to replace citation markers with formatted citations.
 * Supports [@paperId#instanceId] and [@paperId] formats
 */
function processChatCitations(content: string, papers: ProjectPaper[]): string {
  if (!content || papers.length === 0) return content
  
  // Create a lookup map for quick paper access
  const paperMap = new Map(papers.map(p => [p.id, p]))
  
  // Pattern: [@paperId#instanceId] or [@paperId]
  return content.replace(/\[@([a-f0-9-]+)(?:#[a-f0-9-]+)?\]/gi, (match, paperId) => {
    const paper = paperMap.get(paperId)
    return paper ? formatChatCitation(paper) : match
  })
}

// =============================================================================
// STREAMING OPTIMIZATION
// =============================================================================

/**
 * Memoized markdown renderer that only re-renders when content changes.
 * During streaming, this prevents expensive markdown parsing on every character.
 * Now also processes citation markers into formatted citations.
 */
const MemoizedMarkdown = memo(function MemoizedMarkdown({ 
  content, 
  papers = [] 
}: { 
  content: string
  papers?: ProjectPaper[]
}) {
  // Process citations before rendering markdown
  const processedContent = useMemo(
    () => processChatCitations(content, papers),
    [content, papers]
  )
  return <ReactMarkdown>{processedContent}</ReactMarkdown>
})

// =============================================================================
// TYPES
// =============================================================================

export interface ChatSendOptions {
  content: string
  mentionedPaperIds?: string[]
  attachedImages?: string[]
}

interface ChatTabProps {
  messages: UIMessage[]
  /** 
   * Callback when message is sent. 
   * For backward compatibility, accepts either:
   * - (content: string) => void
   * - (options: ChatSendOptions) => void
   */
  onSendMessage: (content: string | ChatSendOptions) => void
  isLoading?: boolean
  /** Is chat history being loaded */
  isLoadingHistory?: boolean
  /** Error from chat API (used to show rate limit banners) */
  error?: Error | null
  // Papers for @ mentions
  papers?: ProjectPaper[]
  projectId?: string
  // Tool support props (actions now handled in editor, these are for status only)
  pendingTools?: PendingToolCall[]
  onConfirmTool?: (toolId: string) => void
  onRejectTool?: (toolId: string) => void
  onConfirmAllTools?: () => void
  onRejectAllTools?: () => void
  onClearHistory?: () => void
}

// =============================================================================
// COMPONENTS
// =============================================================================

function ToolCallBadge({ toolName }: { toolName: string }) {
  const toolLabels: Record<string, string> = {
    insertContent: 'Insert',
    replaceInSection: 'Replace',
    rewriteSection: 'Rewrite',
    deleteContent: 'Delete',
    addCitation: 'Cite',
    highlightText: 'Highlight',
    addComment: 'Comment',
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
      <Wrench className="h-2.5 w-2.5" />
      {toolLabels[toolName] || toolName}
    </span>
  )
}


// Helper to extract text content from UIMessage parts
function getMessageText(message: UIMessage): string {
  // Try parts array first (new v6 format)
  if (message.parts && message.parts.length > 0) {
    const textParts = message.parts.filter((p): p is { type: 'text'; text: string } => 
      p.type === 'text' && 'text' in p
    )
    const text = textParts.map(p => p.text).join('')
    if (text) return text
  }
  
  // Fallback to content property (for backward compatibility or history messages)
   
  const content = (message as any).content
  if (typeof content === 'string') return content
  
  return ''
}

// Helper to extract tool invocations from UIMessage parts
interface ToolInvocationDisplay {
  toolCallId: string
  toolName: string
}

function getToolInvocations(message: UIMessage): ToolInvocationDisplay[] {
  if (!message.parts) return []
  // Tool parts in v6 can have various shapes:
  // - { type: 'tool-insertContent', args: {...} } - tool name in type string
  // - { type: 'tool-invocation', toolInvocation: { toolName, toolCallId, args, ... } }
  // - { type: 'tool-call', toolName, args }
   
  return message.parts
     
    .filter((p: any) => {
      return p.type === 'tool-invocation' || 
             p.type === 'tool-call' ||
             p.toolInvocation !== undefined ||
             (p.type?.startsWith && p.type.startsWith('tool-')) || 
             p.type === 'dynamic-tool'
    })
     
    .map((p: any) => {
      // AI SDK v6 uses type like 'tool-insertContent' where tool name is in the type
      const toolName = (p.type?.startsWith('tool-') && p.type !== 'tool-invocation' && p.type !== 'tool-call')
        ? p.type.replace('tool-', '')  // 'tool-insertContent' → 'insertContent'
        : (p.toolInvocation?.toolName || p.toolName || 'unknown')
      
      const toolCallId = p.toolCallId || p.toolInvocation?.toolCallId || p.id || Math.random().toString()
      
      return {
        toolCallId,
        toolName,
      }
    })
}

/**
 * MessageBubble - Memoized to prevent re-renders during streaming.
 * Only re-renders when message content actually changes.
 */
const MessageBubble = memo(function MessageBubble({ 
  message,
  papers = [],
}: { 
  message: UIMessage
  papers?: ProjectPaper[]
}) {
  const isAssistant = message.role === 'assistant'
  
  // Memoize content extraction to avoid recalculating on every render
  const content = useMemo(() => getMessageText(message), [message])
  const toolInvocations = useMemo(() => getToolInvocations(message), [message])

  // Debug: log if message has no displayable content (only in dev)
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && !content && isAssistant && toolInvocations.length === 0) {
      console.log('[ChatTab] Assistant message with no text content:', {
        id: message.id,
        role: message.role,
        partsCount: message.parts?.length || 0,
        parts: message.parts?.map(p => ({ type: p.type })),
      })
    }
  }, [content, isAssistant, toolInvocations.length, message.id, message.role, message.parts])

  // Memoize timestamp - stable per message (created once when message first renders)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const timestamp = useMemo(() => new Date(), [])

  return (
    <div className="flex gap-3 px-4 py-4">
      <Avatar className="h-6 w-6 shrink-0">
        <AvatarFallback className={cn(
          "text-xs",
          isAssistant ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
        )}>
          {isAssistant ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
        </AvatarFallback>
      </Avatar>
      
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground">
            {isAssistant ? 'Assistant' : 'You'}
          </span>
          <span className="text-[10px] text-muted-foreground/60">
            {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        
        {(content || toolInvocations.length > 0) && (
          <div className="text-[13px] leading-relaxed text-foreground/80 prose prose-sm prose-neutral dark:prose-invert max-w-none chat-message-content [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_ul]:my-3 [&_ol]:my-3 [&_li]:my-1 [&_p]:my-3 [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-sm [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-medium [&_h1]:mt-4 [&_h2]:mt-4 [&_h3]:mt-3 [&_code]:text-xs [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:bg-muted">
            {content ? <MemoizedMarkdown content={content} papers={papers} /> : <span className="text-muted-foreground italic">Applying suggested edits…</span>}
          </div>
        )}

        {/* Tool invocations - just show badges, no action buttons */}
        {toolInvocations && toolInvocations.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {toolInvocations.map((invocation) => (
              <ToolCallBadge key={invocation.toolCallId} toolName={invocation.toolName} />
            ))}
          </div>
        )}

        {/* Evidence transparency - show what sources were used (assistant messages only) */}
        {isAssistant && (
          <EvidencePanel
            evidence={(message.metadata as ChatMessageMetadata)?.evidence}
            papers={papers}
            ragMetadata={(message.metadata as ChatMessageMetadata)?.ragMetadata}
          />
        )}
      </div>
    </div>
  )
})

/**
 * LoadingBubble with action-oriented status labels.
 * Shows what the assistant is DOING, not internal system states.
 * 
 * Simplified phases to avoid misleading "Searching..." when RAG is skipped:
 * 1. "Thinking..." (optimistic, shown until metadata arrives)
 * 2. Real status from metadata: "Found X excerpts" or nothing (if skipped)
 */
function LoadingBubble({ 
  latestMessageMetadata 
}: { 
  latestMessageMetadata?: ChatMessageMetadata 
}) {
  // Determine status text based on actual state from metadata
  const statusText = useMemo(() => {
    // If we have real metadata from streaming, show actual info
    if (latestMessageMetadata?.ragMetadata) {
      const { chunksRetrieved, skipped } = latestMessageMetadata.ragMetadata
      
      // RAG was skipped - no text needed for simple/fast responses
      if (skipped) {
        return null
      }
      
      // RAG completed with results - show count
      if (chunksRetrieved > 0) {
        return `Found ${chunksRetrieved} relevant excerpt${chunksRetrieved !== 1 ? 's' : ''}`
      }
      
      // RAG completed but nothing found
      return null
    }
    
    // Before metadata arrives, just show "Thinking..."
    // This avoids showing "Searching..." for requests that won't search
    return 'Thinking...'
  }, [latestMessageMetadata])

  return (
    <div className="flex gap-3 px-4 py-4">
      <Avatar className="h-6 w-6 shrink-0">
        <AvatarFallback className="bg-primary/10 text-primary text-xs">
          <Bot className="h-3.5 w-3.5" />
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce [animation-delay:-0.3s]" />
          <span className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce [animation-delay:-0.15s]" />
          <span className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce" />
        </div>
        {statusText && (
          <span className="text-[11px] text-muted-foreground">{statusText}</span>
        )}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-6">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
        <Bot className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="font-medium text-sm mb-1">Research Assistant</h3>
      <p className="text-xs text-muted-foreground max-w-[200px]">
        Ask me to help with your research, find citations, or edit your document.
      </p>
      <div className="mt-4 text-xs text-muted-foreground">
        <p className="font-medium mb-1">Try asking:</p>
        <ul className="space-y-1 text-left">
          <li>&ldquo;Add a citation after the claim about...&rdquo;</li>
          <li>&ldquo;Rewrite the introduction to be more concise&rdquo;</li>
          <li>&ldquo;What gaps exist in my literature review?&rdquo;</li>
        </ul>
      </div>
    </div>
  )
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ChatTab({ 
  messages, 
  onSendMessage, 
  isLoading = false,
  isLoadingHistory: _isLoadingHistory = false, // Kept for API compatibility
  error,
  papers = [],
  projectId,
  pendingTools = [],
  onConfirmTool: _onConfirmTool,
  onRejectTool: _onRejectTool,
  onConfirmAllTools: _onConfirmAllTools,
  onRejectAllTools: _onRejectAllTools,
  onClearHistory,
}: ChatTabProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const scrollRafRef = useRef<number | null>(null)
  const lastScrollTriggerRef = useRef({ messageCount: 0, lastMessageLength: 0 })
  
  // Image upload hook
  const { uploadImage, isUploading } = useChatImageUpload({ projectId })
  
  // Get length of the last message content (for streaming detection)
  const lastMessage = messages[messages.length - 1]
  const lastMessageContent = lastMessage ? getMessageText(lastMessage) : ''
  
  // Throttled auto-scroll using requestAnimationFrame
  // Scrolls when: message count changes, loading starts, OR streaming content grows
  useEffect(() => {
    const currentTrigger = {
      messageCount: messages.length,
      lastMessageLength: lastMessageContent.length,
    }
    
    const prev = lastScrollTriggerRef.current
    const messageCountChanged = currentTrigger.messageCount !== prev.messageCount
    const contentGrew = currentTrigger.lastMessageLength > prev.lastMessageLength
    
    lastScrollTriggerRef.current = currentTrigger
    
    // Scroll on new messages, or when streaming content grows (while loading)
    const shouldScroll = messageCountChanged || (isLoading && contentGrew)
    if (!shouldScroll) return
    
    // Cancel any pending scroll
    if (scrollRafRef.current) {
      cancelAnimationFrame(scrollRafRef.current)
    }
    
    // Schedule scroll on next frame
    scrollRafRef.current = requestAnimationFrame(() => {
      if (scrollAreaRef.current) {
        const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight
        }
      }
    })
    
    return () => {
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current)
      }
    }
  }, [messages.length, isLoading, lastMessageContent.length])

  // Handle send from RichChatInput
  const handleSend = useCallback((
    content: string, 
    mentionedPaperIds: string[], 
    attachedImages: string[]
  ) => {
    // Build display content with paper mentions visible
    let displayContent = content
    
    // Add paper mention indicators to the message for visibility
    if (mentionedPaperIds.length > 0 && papers) {
      const mentionedPaperTitles = mentionedPaperIds
        .map(id => papers.find(p => p.id === id)?.title)
        .filter(Boolean)
      
      if (mentionedPaperTitles.length > 0) {
        const paperRefs = mentionedPaperTitles.map(t => `📄 *${t}*`).join('\n')
        displayContent = `${content}\n\n**Referenced:**\n${paperRefs}`
      }
    }
    
    // If there are mentions or images, send as object
    if (mentionedPaperIds.length > 0 || attachedImages.length > 0) {
      onSendMessage({
        content: displayContent,
        mentionedPaperIds,
        attachedImages,
      })
    } else {
      // Backward compatible: just send content string
      onSendMessage(displayContent)
    }
  }, [onSendMessage, papers])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Rate limit banner - show when limit reached */}
      <ChatLimitBanner error={error} showUsageStats className="mx-3 mt-3" />
      
      {/* Header with clear button - only show when no pending edits */}
      {messages.length > 0 && onClearHistory && pendingTools.length === 0 && (
        <div className="flex-shrink-0 flex justify-end p-2 border-b border-border">
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-7 text-xs text-muted-foreground hover:text-foreground"
            onClick={onClearHistory}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Clear
          </Button>
        </div>
      )}
      
      {/* Messages area - takes remaining space and scrolls */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ScrollArea ref={scrollAreaRef} className="h-full">
          {messages.length === 0 && !isLoading ? (
            // Show empty state immediately - no skeleton loading for fresh chat
            <EmptyState />
          ) : (
            <div className="space-y-1">
              {messages.map((message) => (
                <MessageBubble 
                  key={message.id} 
                  message={message}
                  papers={papers}
                />
              ))}
              {isLoading && (
                <LoadingBubble 
                  latestMessageMetadata={
                    // Get metadata from the latest assistant message (if streaming)
                    messages.filter(m => m.role === 'assistant').pop()?.metadata as ChatMessageMetadata | undefined
                  }
                />
              )}
            </div>
          )}
        </ScrollArea>
      </div>
      
      {/* Quick Actions - above input */}
      {messages.length > 0 && <QuickActions onSend={(prompt) => handleSend(prompt, [], [])} disabled={isLoading} />}
      
      {/* Rich Input - always visible at bottom */}
      <div className="flex-shrink-0">
        <RichChatInput 
          onSend={handleSend} 
          disabled={isLoading}
          papers={papers}
          projectId={projectId}
          onImageUpload={uploadImage}
          isUploadingImage={isUploading}
        />
      </div>
    </div>
  )
}

// =============================================================================
// QUICK ACTIONS
// =============================================================================

const QUICK_ACTIONS = [
  {
    label: 'Extract Claims',
    icon: '📋',
    prompt: 'Extract the key claims and findings from my papers. For each claim, cite the source paper.',
  },
  {
    label: 'Find Gaps',
    icon: '🔍',
    prompt: 'Analyze my papers and identify research gaps - what questions remain unanswered? What areas need more investigation?',
  },
  {
    label: 'Summarize',
    icon: '📝',
    prompt: 'Provide a comprehensive summary of my papers, highlighting the main themes and how they relate to each other.',
  },
]

function QuickActions({ 
  onSend, 
  disabled 
}: { 
  onSend: (message: string) => void
  disabled: boolean 
}) {
  return (
    <div className="flex-shrink-0 px-4 py-2">
      <div className="flex items-center justify-left gap-1.5 flex-wrap">
        {QUICK_ACTIONS.map((action) => (
          <Button
            key={action.label}
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1 px-2.5 rounded-full bg-background shadow-sm hover:bg-muted border-border/60"
            onClick={() => onSend(action.prompt)}
            disabled={disabled}
          >
            <span>{action.icon}</span>
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
