'use client'

import { useRef, useEffect, useCallback } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Bot, User, Wrench, Trash2, FileEdit } from 'lucide-react'
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
  /** Whether ghost edit previews are visible in editor */
  hasGhostPreviews?: boolean
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
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <Wrench className="h-3 w-3" />
      {toolLabels[toolName] || toolName}
    </span>
  )
}

/**
 * Pending edits indicator - shows in chat when edits are waiting in the editor
 * This replaces the old ToolConfirmationCard - actions are now in the editor
 */
function PendingEditsIndicator({ 
  count,
  hasGhostPreviews 
}: { 
  count: number
  hasGhostPreviews: boolean 
}) {
  if (count === 0) return null

  return (
    <div className="mx-3 my-3 p-3 rounded-lg bg-muted/50 border border-border animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-secondary">
          <FileEdit className="h-3.5 w-3.5 text-foreground" />
        </div>
        <span className="text-sm font-medium text-foreground">
          {count} edit{count !== 1 ? 's' : ''} pending
        </span>
        {hasGhostPreviews && (
          <span className="text-xs text-muted-foreground">
            - review in editor
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-2 pl-8">
        Use <kbd className="px-1 py-0.5 bg-muted rounded text-[10px] mx-0.5">Tab</kbd> to navigate, 
        <kbd className="px-1 py-0.5 bg-muted rounded text-[10px] mx-0.5">Enter</kbd> to accept
      </p>
    </div>
  )
}

// Helper to extract text content from UIMessage parts
function getMessageText(message: UIMessage): string {
  if (!message.parts) return ''
  const textParts = message.parts.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
  return textParts.map(p => p.text).join('')
}

// Helper to extract tool invocations from UIMessage parts
interface ToolInvocationDisplay {
  toolCallId: string
  toolName: string
}

function getToolInvocations(message: UIMessage): ToolInvocationDisplay[] {
  if (!message.parts) return []
  // Tool parts in v6 have type starting with 'tool-' or are 'dynamic-tool'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return message.parts.filter((p: any) => {
    return p.type?.startsWith('tool-') || p.type === 'dynamic-tool'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }).map((p: any) => ({
    toolCallId: p.toolCallId || p.id || Math.random().toString(),
    toolName: p.type === 'dynamic-tool' ? p.toolName : p.type?.replace('tool-', '') || 'unknown',
  }))
}

function MessageBubble({ 
  message, 
}: { 
  message: UIMessage
}) {
  const isAssistant = message.role === 'assistant'
  
  // Get content string from parts (new v6 API)
  const content = getMessageText(message)

  // Get timestamp from metadata if available
  const timestamp = new Date()

  // Get tool invocations from parts
  const toolInvocations = getToolInvocations(message)
  
  return (
    <div className={cn(
      "flex gap-3 p-3",
      isAssistant ? "bg-muted/40" : ""
    )}>
      <Avatar className="h-7 w-7 shrink-0">
        <AvatarFallback className={cn(
          "text-xs",
          isAssistant ? "bg-primary text-primary-foreground" : "bg-secondary"
        )}>
          {isAssistant ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>
      
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">
            {isAssistant ? 'Research Assistant' : 'You'}
          </span>
          <span className="text-xs text-muted-foreground">
            {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        
        <div className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {content}
        </div>

        {/* Tool invocations - just show badges, no action buttons */}
        {toolInvocations && toolInvocations.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
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
    <div className="flex gap-3 p-3 bg-muted/40">
      <Avatar className="h-7 w-7 shrink-0">
        <AvatarFallback className="bg-secondary text-foreground text-xs">
          <Bot className="h-4 w-4" />
        </AvatarFallback>
      </Avatar>
      <div className="flex items-center gap-1 py-2">
        <span className="h-2 w-2 rounded-full bg-foreground/30 animate-bounce [animation-delay:-0.3s]" />
        <span className="h-2 w-2 rounded-full bg-foreground/30 animate-bounce [animation-delay:-0.15s]" />
        <span className="h-2 w-2 rounded-full bg-foreground/30 animate-bounce" />
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
  papers = [],
  projectId,
  pendingTools = [],
  onConfirmTool: _onConfirmTool,
  onRejectTool: _onRejectTool,
  onConfirmAllTools: _onConfirmAllTools,
  onRejectAllTools: _onRejectAllTools,
  onClearHistory,
  hasGhostPreviews = false,
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
          {messages.length === 0 && !isLoading ? (
            <EmptyState />
          ) : (
            <div className="divide-y divide-border/50">
              {messages.map((message) => (
                <MessageBubble 
                  key={message.id} 
                  message={message}
                />
              ))}
              {isLoading && <LoadingBubble />}
              
              {/* Pending edits indicator - shows at bottom of messages */}
              <PendingEditsIndicator 
                count={pendingTools.length} 
                hasGhostPreviews={hasGhostPreviews}
              />
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
    <div className="flex-shrink-0 border-t border-border bg-muted/20 p-2">
      <div className="flex flex-wrap gap-1.5">
        {QUICK_ACTIONS.map((action) => (
          <Button
            key={action.label}
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1 bg-background hover:bg-muted"
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
