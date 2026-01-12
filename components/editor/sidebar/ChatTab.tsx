'use client'

import { useRef, useEffect } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Bot, User } from 'lucide-react'
import { ChatInput } from './ChatInput'
import type { ChatMessage } from '../types'
import { cn } from '@/lib/utils'

interface ChatTabProps {
  messages: ChatMessage[]
  onSendMessage: (content: string) => void
  isLoading?: boolean
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isAssistant = message.role === 'assistant'
  
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
      
      <div className="flex-1 space-y-1 overflow-hidden">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">
            {isAssistant ? 'Research Assistant' : 'You'}
          </span>
          <span className="text-xs text-muted-foreground">
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <div className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
          {message.content}
        </div>
        {message.citations && message.citations.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {message.citations.map((citation) => (
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
    </div>
  )
}

export function ChatTab({ messages, onSendMessage, isLoading = false }: ChatTabProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  
  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight
      }
    }
  }, [messages, isLoading])

  return (
    <div className="flex flex-col h-full">
      <ScrollArea ref={scrollAreaRef} className="flex-1">
        {messages.length === 0 && !isLoading ? (
          <EmptyState />
        ) : (
          <div className="divide-y divide-border/50">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            {isLoading && <LoadingBubble />}
          </div>
        )}
      </ScrollArea>
      
      <ChatInput 
        onSend={onSendMessage} 
        disabled={isLoading}
      />
    </div>
  )
}
