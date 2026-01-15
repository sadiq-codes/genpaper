/**
 * useChat - Manages chat state and AI interactions
 * 
 * Responsibilities:
 * - Chat messages state
 * - Sending messages to AI
 * - Loading state
 */

import { useState, useCallback } from 'react'
import type { Editor } from '@tiptap/react'
import type { ChatMessage, ProjectPaper, AnalysisState } from '../types'
import { editorToMarkdown } from '../utils/tiptap-to-markdown'
import { processContent } from '../utils/content-processor'

interface UseChatOptions {
  projectId?: string
  editor: Editor | null
  papers: ProjectPaper[]
  analysisState: AnalysisState
}

interface UseChatReturn {
  /** Chat messages */
  messages: ChatMessage[]
  /** Whether AI is processing */
  isLoading: boolean
  /** Send a message */
  sendMessage: (content: string) => Promise<void>
  /** Clear chat history */
  clearMessages: () => void
}

export function useChat({
  projectId,
  editor,
  papers,
  analysisState,
}: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const sendMessage = useCallback(async (messageContent: string) => {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: messageContent,
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, userMessage])
    setIsLoading(true)

    try {
      const response = await fetch('/api/editor/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          message: messageContent,
          documentContent: editor ? editorToMarkdown(editor) : '',
          papers: papers.map(p => ({ id: p.id, title: p.title, abstract: p.abstract })),
          claims: analysisState.claims.slice(0, 20),
          gaps: analysisState.gaps,
        }),
      })

      if (!response.ok) throw new Error('Failed to get AI response')

      const data = await response.json()

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.response,
        timestamp: new Date(),
        citations: data.citations,
      }
      setMessages(prev => [...prev, assistantMessage])

      // Apply any edits suggested by AI
      if (data.edits && editor) {
        data.edits.forEach((edit: { type: string; content: string }) => {
          if (edit.type === 'insert') {
            const { json: processedContent, isFullDoc } = processContent(edit.content, papers)

            if (isFullDoc && processedContent.content) {
              editor.chain().focus().insertContent(processedContent.content).run()
            } else if (Array.isArray(processedContent) && processedContent.length > 0) {
              editor.chain().focus().insertContent(processedContent).run()
            } else {
              editor.chain().focus().insertContent(edit.content).run()
            }
          }
        })
      }
    } catch (error) {
      console.error('Chat error:', error)
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }, [projectId, editor, papers, analysisState.claims, analysisState.gaps])

  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  return {
    messages,
    isLoading,
    sendMessage,
    clearMessages,
  }
}
