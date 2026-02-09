'use client'

import { useRef, useEffect, useCallback, memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Bot, User, Wrench, Trash2, Square, MessageSquare } from 'lucide-react'
import { RichChatInput } from './RichChatInput'
import { EvidencePanel } from './EvidencePanel'
import { ChatLimitBanner } from '@/components/billing/chat-limit-banner'
import type { UIMessage } from 'ai'
import type { ProjectPaper } from '../types'
import type { ChatMessageMetadata } from '@/app/api/editor/chat/route'
import { cn } from '@/lib/utils'
import { useChatImageUpload } from '../hooks/useChatImageUpload'
import { useResearchEditor } from '../research-editor-context'

// =============================================================================
// CITATION FORMATTING FOR CHAT
// =============================================================================

/** Citation marker regex: [@paperId#instanceId] or [@paperId] */
const CITATION_MARKER_RE = /\[@([a-f0-9-]+)(?:#([a-f0-9-]+))?\]/gi

/**
 * Build the display label for a citation (e.g. "Smith et al., 2024").
 */
function getCitationLabel(paper: ProjectPaper): string {
  const authors = paper.authors || []
  const year = paper.year || 'n.d.'

  if (authors.length === 0) {
    const titleSnippet = paper.title?.split(' ').slice(0, 3).join(' ') || 'Unknown'
    return `${titleSnippet}..., ${year}`
  }

  const firstAuthor = authors[0]
  const lastName = firstAuthor.includes(',')
    ? firstAuthor.split(',')[0].trim()
    : firstAuthor.split(' ').pop() || firstAuthor

  if (authors.length === 1) return `${lastName}, ${year}`
  if (authors.length === 2) {
    const secondAuthor = authors[1]
    const lastName2 = secondAuthor.includes(',')
      ? secondAuthor.split(',')[0].trim()
      : secondAuthor.split(' ').pop() || secondAuthor
    return `${lastName} & ${lastName2}, ${year}`
  }
  return `${lastName} et al., ${year}`
}

/**
 * Inline citation span that mirrors the editor's Citation extension HTML.
 * Copy-pasting from chat into the editor will produce a proper citation node.
 */
function ChatCitationSpan({ paper, instanceId }: { paper: ProjectPaper; instanceId?: string }) {
  const label = getCitationLabel(paper)
  const url = paper.pdfUrl || (paper.doi ? `https://doi.org/${paper.doi}` : null)

  const sharedAttrs = {
    'data-citation': paper.id,
    'data-instance-id': instanceId || '',
    'data-type': 'citation',
    'data-authors': JSON.stringify(paper.authors || []),
    'data-title': paper.title || '',
    'data-year': paper.year?.toString() || '',
    'data-journal': paper.journal || '',
    'data-doi': paper.doi || '',
    title: paper.title || '',
    className: 'citation-inline font-instrument italic text-foreground/60 hover:text-foreground hover:underline decoration-foreground/30 underline-offset-2 transition-colors cursor-pointer',
  }

  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" {...sharedAttrs}>
        ({label})
      </a>
    )
  }

  return (
    <span {...sharedAttrs} role="text">
      ({label})
    </span>
  )
}

// =============================================================================
// STREAMING OPTIMIZATION
// =============================================================================

/**
 * Memoized markdown renderer that splits content around citation markers,
 * renders markdown for text segments, and injects interactive citation spans
 * that are copy-paste compatible with the editor.
 */
const MemoizedMarkdown = memo(function MemoizedMarkdown({ 
  content, 
  papers = [] 
}: { 
  content: string
  papers?: ProjectPaper[]
}) {
  const paperMap = useMemo(() => new Map(papers.map(p => [p.id, p])), [papers])

  const rendered = useMemo(() => {
    if (!content) return null

    // Split content into text segments and citation markers
    const parts: { type: 'text' | 'citation'; value: string; paperId?: string; instanceId?: string }[] = []
    let lastIndex = 0
    CITATION_MARKER_RE.lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = CITATION_MARKER_RE.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', value: content.slice(lastIndex, match.index) })
      }
      parts.push({ type: 'citation', value: match[0], paperId: match[1], instanceId: match[2] })
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < content.length) {
      parts.push({ type: 'text', value: content.slice(lastIndex) })
    }

    // If no citations found, render as plain markdown
    if (parts.length === 1 && parts[0].type === 'text') {
      return (
        <ReactMarkdown
          components={{
            a: ({ href, children, ...props }) => (
              <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      )
    }

    return parts.map((part, i) => {
      if (part.type === 'citation' && part.paperId) {
        const paper = paperMap.get(part.paperId)
        if (paper) {
          return <ChatCitationSpan key={i} paper={paper} instanceId={part.instanceId} />
        }
        return <span key={i}>{part.value}</span>
      }
      // Render text segment as markdown
      return (
        <ReactMarkdown
          key={i}
          components={{
            a: ({ href, children, ...props }) => (
              <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
            ),
          }}
        >
          {part.value}
        </ReactMarkdown>
      )
    })
  }, [content, paperMap])

  return <>{rendered}</>
})

// =============================================================================
// TYPES
// =============================================================================

export interface ChatSendOptions {
  content: string
  mentionedPaperIds?: string[]
  attachedImages?: string[]
}

// =============================================================================
// COMPONENTS
// =============================================================================

function ToolCallBadge({ toolName }: { toolName: string }) {
  const toolLabels: Record<string, string> = {
    insertContent: 'Insert',
    rewriteSection: 'Rewrite',
    deleteContent: 'Delete',
    addCitation: 'Cite',
    highlightText: 'Highlight',
    addComment: 'Comment',
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-foreground/80 text-background px-2 py-0.5 text-[9px] font-medium tracking-wide uppercase">
      <Wrench className="h-2 w-2" />
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
    <div className={cn(
      "px-4 py-4 border-b border-border/20 last:border-b-0",
      !isAssistant && "bg-muted/20"
    )}>
      {/* Role header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={cn(
            "w-5 h-5 rounded-full flex items-center justify-center shrink-0",
            isAssistant ? "bg-foreground/80 text-background" : "border border-border/40"
          )}>
            {isAssistant ? <Bot className="h-2.5 w-2.5" /> : <User className="h-2.5 w-2.5 text-muted-foreground" />}
          </div>
          <span className="font-instrument text-sm tracking-tight">
            {isAssistant ? 'Assistant' : 'You'}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      
      {/* Message content */}
      {(content || toolInvocations.length > 0) && (
        <div className={cn(
          "text-[13px] leading-[1.7] text-foreground/85",
          "prose prose-sm prose-neutral dark:prose-invert max-w-none",
          "chat-message-content",
          "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
          "[&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5",
          "[&_p]:my-2.5",
          "[&_h1]:font-instrument [&_h1]:text-base [&_h1]:tracking-tight [&_h1]:mt-4 [&_h1]:mb-1.5",
          "[&_h2]:font-instrument [&_h2]:text-base [&_h2]:tracking-tight [&_h2]:mt-3.5 [&_h2]:mb-1",
          "[&_h3]:font-instrument [&_h3]:text-sm [&_h3]:tracking-tight [&_h3]:mt-3 [&_h3]:mb-1",
          "[&_strong]:text-foreground [&_strong]:font-medium",
          "[&_code]:text-[11px] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:bg-foreground/5 [&_code]:border [&_code]:border-border/30 [&_code]:font-mono",
          "[&_blockquote]:border-l-2 [&_blockquote]:border-foreground/20 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-foreground/70",
          "[&_a]:text-foreground/80 [&_a]:underline [&_a]:decoration-foreground/25 [&_a]:underline-offset-2 [&_a]:hover:text-foreground [&_a]:hover:decoration-foreground/50",
          isAssistant ? "pl-0.5" : ""
        )}>
          {content ? <MemoizedMarkdown content={content} papers={papers} /> : <span className="text-muted-foreground italic text-xs font-instrument">Applying edits…</span>}
        </div>
      )}

      {/* Tool invocations */}
      {toolInvocations && toolInvocations.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {toolInvocations.map((invocation) => (
            <ToolCallBadge key={invocation.toolCallId} toolName={invocation.toolName} />
          ))}
        </div>
      )}

      {/* Evidence */}
      {isAssistant && (
        <EvidencePanel
          evidence={(message.metadata as ChatMessageMetadata)?.evidence}
          papers={papers}
          ragMetadata={(message.metadata as ChatMessageMetadata)?.ragMetadata}
        />
      )}
    </div>
  )
})

/**
 * LoadingBubble - simple thinking indicator.
 * No RAG status — that's shown after the response via EvidencePanel.
 */
function LoadingBubble() {
  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-5 h-5 rounded-full bg-foreground/80 text-background flex items-center justify-center shrink-0">
          <Bot className="h-2.5 w-2.5" />
        </div>
        <span className="font-instrument text-sm tracking-tight">Assistant</span>
      </div>
      <div className="flex items-center gap-1.5 pl-0.5 h-5">
        <span className="h-1.5 w-1.5 rounded-full bg-foreground/30 animate-pulse [animation-delay:0ms] animation-duration-[1.2s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-foreground/30 animate-pulse [animation-delay:200ms] animation-duration-[1.2s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-foreground/30 animate-pulse [animation-delay:400ms] animation-duration-[1.2s]" />
        <span className="text-[11px] text-muted-foreground ml-1 font-instrument italic">thinking…</span>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8 py-16">
      <div className="w-10 h-10 rounded-full border border-border/40 flex items-center justify-center mb-4">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
      </div>
      <h4 className="font-instrument text-base tracking-tight mb-1">
        Start a conversation
      </h4>
      <p className="text-xs text-muted-foreground max-w-[180px] leading-relaxed">
        Ask about your research, request edits, or explore your papers
      </p>
    </div>
  )
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ChatTab() {
  const {
    chatMessages: messages,
    sendMessage: onSendMessage,
    isChatLoading: isLoading,
    chatError: error,
    papers,
    projectId,
    insertCitation,
    pendingTools,
    clearChatHistory: onClearHistory,
    stopGeneration: onStop,
  } = useResearchEditor()

  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const scrollRafRef = useRef<number | null>(null)
  const lastScrollTriggerRef = useRef({ messageCount: 0, lastMessageLength: 0 })
  
  // Image upload hook
  const { uploadImage, isUploading } = useChatImageUpload({ projectId })
  
  // Get length of the last message content (for streaming detection)
  const lastMessage = messages[messages.length - 1]
  const lastMessageContent = lastMessage ? getMessageText(lastMessage) : ''
  
  // Scroll to bottom on mount (when chat panel is opened)
  useEffect(() => {
    requestAnimationFrame(() => {
      if (scrollAreaRef.current) {
        const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight
        }
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Handle cite from @ mention dropdown — look up full paper and insert citation
  const handleCitePaper = useCallback((mentioned: { id: string }) => {
    const paper = papers.find(p => p.id === mentioned.id)
    if (paper) {
      insertCitation({
        id: paper.id,
        authors: paper.authors,
        title: paper.title,
        year: paper.year,
        journal: paper.journal,
        doi: paper.doi,
      })
    }
  }, [papers, insertCitation])

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
        <div className="shrink-0 flex justify-end px-3 py-1.5 border-b border-border/30">
          <button 
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            onClick={onClearHistory}
          >
            <Trash2 className="h-2.5 w-2.5" />
            Clear
          </button>
        </div>
      )}
      
      {/* Messages area - takes remaining space and scrolls */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ScrollArea ref={scrollAreaRef} className="h-full">
          {messages.length === 0 && !isLoading ? (
            // Show empty state immediately - no skeleton loading for fresh chat
            <EmptyState />
          ) : (
            <div>
              {messages.map((message, index) => {
                // Skip rendering an empty assistant message while loading —
                // the LoadingBubble handles that visual state instead.
                if (
                  isLoading &&
                  index === messages.length - 1 &&
                  message.role === 'assistant' &&
                  !getMessageText(message) &&
                  !getToolInvocations(message).length
                ) {
                  return null
                }
                return (
                  <MessageBubble 
                    key={message.id} 
                    message={message}
                    papers={papers}
                  />
                )
              })}
              {isLoading && (() => {
                const lastMsg = messages[messages.length - 1]
                const hasContent = lastMsg?.role === 'assistant' && (getMessageText(lastMsg) || getToolInvocations(lastMsg).length)
                return (
                  <>
                    {!hasContent && <LoadingBubble />}
                    {onStop && (
                      <div className="flex justify-center py-2">
                        <button
                          className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-3 py-1 rounded-full border border-border/40 hover:border-border/60"
                          onClick={onStop}
                        >
                          <Square className="h-2 w-2 fill-current" />
                          Stop generating
                        </button>
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          )}
        </ScrollArea>
      </div>
      
      {/* Quick Actions - above input */}
      {messages.length > 0 && <QuickActions onSend={(prompt) => handleSend(prompt, [], [])} disabled={isLoading} />}
      
      {/* Rich Input - always visible at bottom */}
      <div className="shrink-0">
        <RichChatInput 
          onSend={handleSend} 
          disabled={isLoading}
          papers={papers}
          projectId={projectId}
          onCitePaper={handleCitePaper}
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
    label: 'Key findings',
    prompt: 'What are the key findings across my papers?',
  },
  {
    label: 'Research gaps',
    prompt: 'What gaps or unanswered questions remain in my research?',
  },
  {
    label: 'Summarize',
    prompt: 'Summarize my papers and how they connect to each other.',
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
    <div className="shrink-0 px-3 py-1.5">
      <div className="flex items-center gap-1 flex-wrap">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.label}
            className="text-[11px] px-2.5 py-1 rounded-full border border-border/40 text-muted-foreground hover:text-foreground hover:border-border transition-colors disabled:opacity-40 cursor-pointer"
            onClick={() => onSend(action.prompt)}
            disabled={disabled}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  )
}
