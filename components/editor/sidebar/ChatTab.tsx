'use client'

import { useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Bot, User, Wrench, Trash2 } from 'lucide-react'
import { RichChatInput } from './RichChatInput'
import type { UIMessage } from 'ai'
import type { PendingToolCall } from '../hooks/useEditorChat'
import type { ProjectPaper } from '../types'
import { cn } from '@/lib/utils'
import { useChatImageUpload } from '../hooks/useChatImageUpload'

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

function MessageBubble({ 
  message, 
}: { 
  message: UIMessage
}) {
  const isAssistant = message.role === 'assistant'
  
  // Get content string from parts (new v6 API)
  const content = getMessageText(message)
  const toolInvocations = getToolInvocations(message)

  // Debug: log if message has no displayable content
  if (process.env.NODE_ENV === 'development' && !content && isAssistant && toolInvocations.length === 0) {
    console.log('[ChatTab] Assistant message with no text content:', {
      id: message.id,
      role: message.role,
      partsCount: message.parts?.length || 0,
      parts: message.parts?.map(p => ({ type: p.type })),
    })
  }

  // Get timestamp from metadata if available
  const timestamp = new Date()

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
          <div className="text-[13px] leading-relaxed text-foreground/80 prose prose-sm prose-neutral dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_ul]:my-3 [&_ol]:my-3 [&_li]:my-1 [&_p]:my-3 [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-sm [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-medium [&_h1]:mt-4 [&_h2]:mt-4 [&_h3]:mt-3 [&_code]:text-xs [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:bg-muted">
            {content ? <ReactMarkdown>{content}</ReactMarkdown> : <span className="text-muted-foreground italic">Applying suggested edits…</span>}
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
      </div>
    </div>
  )
}

function LoadingBubble() {
  return (
    <div className="flex gap-3 px-4 py-4">
      <Avatar className="h-6 w-6 shrink-0">
        <AvatarFallback className="bg-primary/10 text-primary text-xs">
          <Bot className="h-3.5 w-3.5" />
        </AvatarFallback>
      </Avatar>
      <div className="flex items-center gap-1.5 py-1">
        <span className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce" />
      </div>
    </div>
  )
}

function HistoryLoadingSkeleton() {
  return (
    <div className="space-y-1 animate-pulse">
      {/* User message skeleton */}
      <div className="flex gap-3 px-4 py-4">
        <div className="h-6 w-6 rounded-full bg-muted shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-2.5 w-12 bg-muted rounded" />
          <div className="h-3 w-3/4 bg-muted rounded" />
        </div>
      </div>
      {/* Assistant message skeleton */}
      <div className="flex gap-3 px-4 py-4">
        <div className="h-6 w-6 rounded-full bg-muted shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-2.5 w-16 bg-muted rounded" />
          <div className="h-3 w-full bg-muted rounded" />
          <div className="h-3 w-2/3 bg-muted rounded" />
        </div>
      </div>
      {/* Another pair */}
      <div className="flex gap-3 px-4 py-4">
        <div className="h-6 w-6 rounded-full bg-muted shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-2.5 w-12 bg-muted rounded" />
          <div className="h-3 w-1/2 bg-muted rounded" />
        </div>
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
  isLoadingHistory = false,
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
  
  // Image upload hook
  const { uploadImage, isUploading } = useChatImageUpload({ projectId })
  
  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight
      }
    }
  }, [messages, isLoading, pendingTools])

  // Handle send from RichChatInput
  const handleSend = useCallback((
    content: string, 
    mentionedPaperIds: string[], 
    attachedImages: string[]
  ) => {
    // If there are mentions or images, send as object
    if (mentionedPaperIds.length > 0 || attachedImages.length > 0) {
      onSendMessage({
        content,
        mentionedPaperIds,
        attachedImages,
      })
    } else {
      // Backward compatible: just send content string
      onSendMessage(content)
    }
  }, [onSendMessage])

  return (
    <div className="flex flex-col h-full overflow-hidden">
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
          {isLoadingHistory ? (
            <HistoryLoadingSkeleton />
          ) : messages.length === 0 && !isLoading ? (
            <EmptyState />
          ) : (
            <div className="space-y-1">
              {messages.map((message) => (
                <MessageBubble 
                  key={message.id} 
                  message={message}
                />
              ))}
              {isLoading && <LoadingBubble />}
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
  {
    label: 'What Next?',
    icon: '💡',
    prompt: 'Based on my document and papers, suggest what I should write next. What sections or arguments would strengthen my paper?',
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
