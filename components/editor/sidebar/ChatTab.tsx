'use client'

import { useRef, useEffect, useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Bot, User, Check, X, ChevronDown, ChevronUp, Wrench, Trash2 } from 'lucide-react'
import { ChatInput } from './ChatInput'
import type { ChatMessage } from '../types'
import type { Message } from 'ai'
import type { PendingToolCall } from '../hooks/useEditorChat'
import { cn } from '@/lib/utils'

// =============================================================================
// TYPES
// =============================================================================

interface ChatTabProps {
  // Support both old ChatMessage[] and new Message[] formats
  messages: ChatMessage[] | Message[]
  onSendMessage: (content: string) => void
  isLoading?: boolean
  // New props for tool support
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
    <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
      <Wrench className="h-3 w-3" />
      {toolLabels[toolName] || toolName}
    </span>
  )
}

function ToolConfirmationCard({ 
  tool, 
  onConfirm, 
  onReject 
}: { 
  tool: PendingToolCall
  onConfirm: () => void
  onReject: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <ToolCallBadge toolName={tool.toolName} />
            <span className="text-xs text-amber-700 dark:text-amber-300">
              Needs confirmation
            </span>
          </div>
          
          {tool.preview && (
            <div className="mt-2">
              <button 
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {expanded ? 'Hide' : 'Show'} preview
              </button>
              {expanded && (
                <pre className="mt-2 max-h-40 overflow-auto rounded bg-background/50 p-2 text-xs whitespace-pre-wrap font-mono">
                  {tool.preview}
                </pre>
              )}
            </div>
          )}
        </div>
        
        <div className="flex gap-1">
          <Button 
            size="sm" 
            variant="ghost" 
            className="h-7 w-7 p-0 text-red-600 hover:text-red-700 hover:bg-red-100"
            onClick={onReject}
          >
            <X className="h-4 w-4" />
          </Button>
          <Button 
            size="sm" 
            variant="ghost"
            className="h-7 w-7 p-0 text-green-600 hover:text-green-700 hover:bg-green-100"
            onClick={onConfirm}
          >
            <Check className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ 
  message, 
  pendingTools,
  onConfirmTool,
  onRejectTool,
}: { 
  message: ChatMessage | Message
  pendingTools?: PendingToolCall[]
  onConfirmTool?: (toolId: string) => void
  onRejectTool?: (toolId: string) => void
}) {
  const isAssistant = message.role === 'assistant'
  
  // Get content string
  const content = typeof message.content === 'string' 
    ? message.content 
    : JSON.stringify(message.content)

  // Get timestamp - handle both old and new formats
  const timestamp = 'timestamp' in message && message.timestamp instanceof Date
    ? message.timestamp
    : 'createdAt' in message && message.createdAt
    ? new Date(message.createdAt)
    : new Date()

  // Get tool invocations from new Message format
  const toolInvocations = 'toolInvocations' in message 
    ? message.toolInvocations 
    : undefined

  // Get legacy citations from old ChatMessage format
  const legacyCitations = 'citations' in message ? message.citations : undefined

  // Find pending tools for this message
  const messagePendingTools = pendingTools?.filter(t => t.messageId === message.id) || []
  
  return (
    <div className={cn(
      "flex gap-3 p-3",
      isAssistant ? "bg-muted/50" : ""
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

        {/* Tool invocations (new format) */}
        {toolInvocations && toolInvocations.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {toolInvocations.map((invocation, i) => (
              <ToolCallBadge key={i} toolName={invocation.toolName} />
            ))}
          </div>
        )}

        {/* Pending tool confirmations */}
        {messagePendingTools.map(tool => (
          <ToolConfirmationCard
            key={tool.id}
            tool={tool}
            onConfirm={() => onConfirmTool?.(tool.id)}
            onReject={() => onRejectTool?.(tool.id)}
          />
        ))}

        {/* Legacy citations (old format) */}
        {legacyCitations && legacyCitations.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {legacyCitations.map((citation) => (
              <span 
                key={citation.id}
                className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-700 border border-gray-300"
              >
                {citation.authors[0]?.split(' ').pop()}, {citation.year}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function LoadingBubble() {
  return (
    <div className="flex gap-3 p-3 bg-muted/50">
      <Avatar className="h-7 w-7 shrink-0">
        <AvatarFallback className="bg-primary text-primary-foreground text-xs">
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
      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
        <Bot className="h-6 w-6 text-primary" />
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
  pendingTools = [],
  onConfirmTool,
  onRejectTool,
  onConfirmAllTools,
  onRejectAllTools,
  onClearHistory,
  hasGhostPreviews = false,
}: ChatTabProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  
  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight
      }
    }
  }, [messages, isLoading, pendingTools])

  // Count tools with ghost previews (visual edits)
  const visualEditsCount = pendingTools.filter(t => t.calculatedEdit).length

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Batch edit controls - show when multiple edits pending */}
      {pendingTools.length > 0 && (
        <div className="flex-shrink-0 border-b bg-amber-50 dark:bg-amber-950/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 text-xs font-bold">
                {pendingTools.length}
              </div>
              <div className="text-sm">
                <span className="font-medium text-amber-800 dark:text-amber-200">
                  {pendingTools.length === 1 ? 'Edit' : 'Edits'} pending
                </span>
                {hasGhostPreviews && visualEditsCount > 0 && (
                  <span className="text-xs text-amber-600 dark:text-amber-400 ml-2">
                    (preview in editor)
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {pendingTools.length > 1 && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-100 dark:hover:bg-red-900/30"
                    onClick={onRejectAllTools}
                  >
                    <X className="h-3 w-3 mr-1" />
                    Reject All
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-green-600 hover:text-green-700 hover:bg-green-100 dark:hover:bg-green-900/30"
                    onClick={onConfirmAllTools}
                  >
                    <Check className="h-3 w-3 mr-1" />
                    Accept All
                  </Button>
                </>
              )}
            </div>
          </div>
          {hasGhostPreviews && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
              Press <kbd className="px-1 py-0.5 bg-amber-200 dark:bg-amber-800 rounded text-[10px] mx-0.5">Enter</kbd> to accept or <kbd className="px-1 py-0.5 bg-amber-200 dark:bg-amber-800 rounded text-[10px] mx-0.5">Esc</kbd> to reject the highlighted edit in the editor.
            </p>
          )}
        </div>
      )}

      {/* Header with clear button */}
      {messages.length > 0 && onClearHistory && pendingTools.length === 0 && (
        <div className="flex-shrink-0 flex justify-end p-2 border-b">
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-7 text-xs text-muted-foreground hover:text-destructive"
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
                  pendingTools={pendingTools}
                  onConfirmTool={onConfirmTool}
                  onRejectTool={onRejectTool}
                />
              ))}
              {isLoading && <LoadingBubble />}
            </div>
          )}
        </ScrollArea>
      </div>
      
      {/* Input - always visible at bottom */}
      <div className="flex-shrink-0">
        <ChatInput 
          onSend={onSendMessage} 
          disabled={isLoading}
        />
      </div>
    </div>
  )
}
