'use client'

import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import type { Editor } from '@tiptap/react'
import { Button } from '@/components/ui/button'
import { Sparkles, X, Loader2 } from 'lucide-react'
import { calculateEdit, type CalculatedEdit } from '../services/edit-calculator'
import { validateToolCall } from '@/lib/ai/tools/document-tools'
import { serializeForAIContext } from '../utils/ai-context-serializer'
import { truncateDocumentForAIContext } from '../utils/context-truncation'
import { getDocumentStructure } from '../extensions/BlockId'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// =============================================================================
// TYPES
// =============================================================================

interface InlineEditBarProps {
  editor: Editor
  projectId: string
  selectedText: string
  selectionFrom: number
  selectionTo: number
  containerRef: React.RefObject<HTMLElement | null>
  onClose: () => void
}

type Phase = 'input' | 'loading' | 'review'

interface PendingEdit {
  id: string
  toolName: string
  args: Record<string, unknown>
  calculatedEdit?: CalculatedEdit
}

// =============================================================================
// TOOL EXTRACTION
// =============================================================================

function extractToolInvocations(parts: any[]): Array<{ toolName: string; args: Record<string, unknown> }> {
  const toolParts = parts.filter((p: any) =>
    p.type === 'tool-invocation' ||
    p.type === 'tool-call' ||
    p.toolInvocation !== undefined ||
    (p.type?.startsWith?.('tool-'))
  )

  return toolParts
    .map((p: any) => {
      const toolName = (p.type?.startsWith('tool-') && p.type !== 'tool-invocation' && p.type !== 'tool-call')
        ? p.type.replace('tool-', '')
        : (p?.toolInvocation?.toolName ?? p?.toolName)

      const args = p?.args ?? p?.input ?? p?.toolInvocation?.args ?? p?.toolInvocation?.input ?? {}
      if (!toolName) return null

      const parsedArgs = (args && typeof args === 'object') ? args as Record<string, unknown> : {}
      const validation = validateToolCall(toolName, parsedArgs)
      if (!validation.valid) return null

      return { toolName, args: parsedArgs }
    })
    .filter(Boolean) as Array<{ toolName: string; args: Record<string, unknown> }>
}

// =============================================================================
// COMPONENT
// =============================================================================

export function InlineEditBar({
  editor,
  projectId,
  selectedText,
  selectionFrom,
  selectionTo,
  containerRef,
  onClose,
}: InlineEditBarProps) {
  const [instruction, setInstruction] = useState('')
  const [phase, setPhase] = useState<Phase>('input')
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingEditsRef = useRef<PendingEdit[]>([])
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const [position, setPosition] = useState({ top: 0 })

  useEffect(() => {
    try {
      // Use the actual scroll/positioning container (the element that InlineEditBar is
      // absolutely positioned within). Fall back to ProseMirror parent if needed.
      const containerEl =
        containerRef.current ??
        (editor.view.dom.closest('.ProseMirror')?.parentElement ?? null)
      if (!containerEl) return

      const containerRect = containerEl.getBoundingClientRect()

      // Selection may span multiple lines; use the lower edge of either end.
      const coordsStart = editor.view.coordsAtPos(selectionFrom)
      const coordsEnd = editor.view.coordsAtPos(selectionTo)
      const selectionBottom = Math.max(coordsStart.bottom, coordsEnd.bottom)

      // Position below the selection with enough gap to not overlap.
      // Add scrollTop so the absolute position matches document coordinates.
      const gap = 16
      const scrollTop = containerEl instanceof HTMLElement ? containerEl.scrollTop : 0
      setPosition({ top: selectionBottom - containerRect.top + scrollTop + gap })
    } catch {
      // Selection might be invalid
    }
    // Small delay to let the bar render before focusing so selection is preserved
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [editor, selectionFrom, selectionTo, containerRef])

  const chatId = useMemo(() => `inline-${projectId}`, [projectId])
  const chatSendMessageRef = useRef<null | ((
    message: { text: string },
    options?: { body?: Record<string, unknown> }
  ) => void)>(null)
  const acceptedCountRef = useRef(0)
  const rejectedCountRef = useRef(0)

  const transport = useMemo(() => new DefaultChatTransport({
    api: '/api/editor/chat',
    body: { projectId, isInlineEdit: true },
  }), [projectId])

  const sendInlineToolResultSummary = useCallback(() => {
    const sender = chatSendMessageRef.current
    if (!sender) return

    const accepted = acceptedCountRef.current
    const rejected = rejectedCountRef.current
    const total = accepted + rejected
    if (total === 0) return

    const summary = rejected === 0
      ? `[TOOL_RESULT] User accepted ${accepted} inline edit${accepted === 1 ? '' : 's'}.`
      : accepted === 0
        ? `[TOOL_RESULT] User rejected ${rejected} inline edit${rejected === 1 ? '' : 's'}.`
        : `[TOOL_RESULT] User accepted ${accepted} inline edit${accepted === 1 ? '' : 's'} and rejected ${rejected}.`

    sender(
      { text: summary },
      {
        body: {
          projectId,
          isToolResultMessage: true,
          isInlineEdit: true,
        },
      }
    )

    acceptedCountRef.current = 0
    rejectedCountRef.current = 0
  }, [projectId])

  const handleAcceptEdit = useCallback((editId: string) => {
    const edit = pendingEditsRef.current.find(e => e.id === editId)
    if (!edit) return

    editor.commands.clearGhostEdit(editId)

    import('../services/tool-executor').then(({ executeDocumentTool }) => {
      const result = executeDocumentTool(editor, edit.toolName, edit.args, { ghostEditId: editId })

      if (result.success) {
        acceptedCountRef.current += 1
      } else {
        rejectedCountRef.current += 1
        toast.error('Edit failed to apply')
      }

      const remaining = pendingEditsRef.current.filter(e => e.id !== editId)
      pendingEditsRef.current = remaining

      if (remaining.length === 0) {
        if (acceptedCountRef.current > 0) {
          toast.success('Edit applied')
        }
        sendInlineToolResultSummary()
        onCloseRef.current()
      }
    })
  }, [editor, sendInlineToolResultSummary])

  const handleRejectEdit = useCallback((editId: string) => {
    editor.commands.clearGhostEdit(editId)
    rejectedCountRef.current += 1

    const remaining = pendingEditsRef.current.filter(e => e.id !== editId)
    pendingEditsRef.current = remaining

    if (remaining.length === 0) {
      sendInlineToolResultSummary()
      onCloseRef.current()
    }
  }, [editor, sendInlineToolResultSummary])

  const { sendMessage: chatSendMessage } = useChat({
    id: chatId,
    transport,
    onFinish: ({ message }) => {
      const tools = extractToolInvocations(message.parts || [])

      if (tools.length === 0) {
        toast.info('No edits generated')
        setPhase('input')
        return
      }

      const edits: PendingEdit[] = []
      const calculatedEdits: CalculatedEdit[] = []

      for (const { toolName, args } of tools) {
        const editId = `inline-${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        const result = calculateEdit(editor, toolName, args, editId)

        if (result.success && result.edit) {
          edits.push({ id: editId, toolName, args, calculatedEdit: result.edit })
          calculatedEdits.push(result.edit)
        }
      }

      if (edits.length > 0) {
        acceptedCountRef.current = 0
        rejectedCountRef.current = 0
        pendingEditsRef.current = edits
        editor.commands.setGhostEdits(
          calculatedEdits,
          (editId: string) => handleAcceptEdit(editId),
          (editId: string) => handleRejectEdit(editId),
        )
        toast.info('Review suggested edits in the diff blocks and accept/reject there.')
        setPhase('review')
      } else {
        toast.error('Could not target the edit location')
        setPhase('input')
      }
    },
    onError: (error) => {
      console.error('[InlineEditBar] Error:', error)
      toast.error('Edit failed', { description: error?.message?.slice(0, 100) })
      setPhase('input')
    },
  })
  chatSendMessageRef.current = chatSendMessage

  const getEditorContext = useCallback(() => {
    let documentContent = serializeForAIContext(editor.state.doc)
    const documentStructure = getDocumentStructure(editor)
    documentContent = truncateDocumentForAIContext(documentContent, {
      maxChars: 20_000,
      focusText: selectedText,
    })

    return { documentContent, selectedText, documentStructure }
  }, [editor, selectedText])

  const handleSubmit = useCallback(() => {
    if (!instruction.trim()) return

    const context = getEditorContext()

    chatSendMessage({
      text: `Edit the selected text based on my instruction.\n\nSelected text: "${selectedText}"\n\nInstruction: ${instruction}\n\nApply the edit using document tools. Make only the requested change.`,
    }, {
      body: {
        projectId,
        ...context,
        isInlineEdit: true,
      },
    })

    setPhase('loading')
  }, [instruction, selectedText, projectId, getEditorContext, chatSendMessage])

  const clearPendingInlineEdits = useCallback(() => {
    if (pendingEditsRef.current.length > 0) {
      for (const edit of pendingEditsRef.current) {
        editor.commands.clearGhostEdit(edit.id)
      }
      pendingEditsRef.current = []
      acceptedCountRef.current = 0
      rejectedCountRef.current = 0
    }
  }, [editor])

  const handleClose = useCallback(() => {
    clearPendingInlineEdits()
    onClose()
  }, [clearPendingInlineEdits, onClose])

  useEffect(() => {
    return () => {
      clearPendingInlineEdits()
    }
  }, [clearPendingInlineEdits])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (phase === 'loading') return
      handleClose()
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (phase === 'input') {
        handleSubmit()
      }
    }
  }, [phase, handleSubmit, handleClose])

  return (
    <div
      className="absolute z-50 left-0 right-0 px-4 sm:px-8 md:px-12 lg:px-16"
      style={{ top: position.top }}
    >
      <div className={cn(
        "flex items-center gap-2 p-1.5 rounded-xl border border-border/50 bg-popover shadow-lg max-w-3xl mx-auto",
      )}>
        <Sparkles className="h-3.5 w-3.5 text-muted-foreground ml-2 shrink-0" aria-hidden="true" />

        {phase === 'input' && (
          <>
            <input
              ref={inputRef}
              type="text"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter editing instruction…"
              aria-label="Editing instruction"
              className="flex-1 text-sm bg-transparent border-none outline-none placeholder:text-muted-foreground/40 text-foreground"
              autoFocus
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full"
              onClick={handleClose}
              aria-label="Close"
            >
              <X className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              className="h-7 px-3.5 text-xs rounded-full bg-foreground text-background hover:bg-foreground/90"
              onClick={handleSubmit}
              disabled={!instruction.trim()}
            >
              Edit
            </Button>
          </>
        )}

        {phase === 'loading' && (
          <>
            <span className="flex-1 text-sm text-muted-foreground">Generating edit…</span>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground/60 mr-2" aria-hidden="true" />
          </>
        )}

        {phase === 'review' && (
          <>
            <span className="flex-1 text-sm text-muted-foreground">
              Review edits in the document and accept/reject each change.
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full"
              onClick={handleClose}
              aria-label="Close"
            >
              <X className="h-3 w-3" />
            </Button>
          </>
        )}

      </div>

      {/* Keyboard hints */}
      <div className="flex justify-end mt-1 px-1 max-w-3xl mx-auto">
        <span className="text-[10px] text-muted-foreground/40">
          {phase === 'input' && 'Enter to submit · Esc to cancel'}
          {phase === 'review' && 'Esc to close'}
        </span>
      </div>
    </div>
  )
}
