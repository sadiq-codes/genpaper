'use client'

import { useCallback, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'
import {
  AtSign,
  MessageSquare,
  Sparkles,
  ChevronDown,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
} from 'lucide-react'

interface FloatingToolbarProps {
  editor: Editor
  onAiEdit: (text: string) => void
  onInsertCitation: () => void
  onChat: (text: string) => void
}

const COLORS = [
  { name: 'Default', value: null },
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Purple', value: '#a855f7' },
]

export function FloatingToolbar({ 
  editor, 
  onAiEdit, 
  onInsertCitation,
  onChat,
}: FloatingToolbarProps) {
  const selectionRef = useRef<{ from: number; to: number } | null>(null)

  const getSelectionRange = useCallback(() => {
    const saved = selectionRef.current
    if (saved && saved.from !== saved.to) {
      return saved
    }
    const { from, to } = editor.state.selection
    if (from !== to) {
      return { from, to }
    }
    return null
  }, [editor])
  
  const getSelectedText = useCallback(() => {
    const range = getSelectionRange()
    if (!range) return ''
    return editor.state.doc.textBetween(range.from, range.to, ' ')
  }, [editor, getSelectionRange])

  const handleAiEdit = useCallback(() => {
    const text = getSelectedText()
    if (text) onAiEdit(text)
  }, [getSelectedText, onAiEdit])

  const handleChat = useCallback(() => {
    const text = getSelectedText()
    if (text) onChat(text)
  }, [getSelectedText, onChat])

  // Memoized formatting handlers
  const toggleBold = useCallback(() => editor.chain().focus().toggleBold().run(), [editor])
  const toggleItalic = useCallback(() => editor.chain().focus().toggleItalic().run(), [editor])
  const toggleUnderline = useCallback(() => editor.chain().focus().toggleUnderline().run(), [editor])
  const toggleStrike = useCallback(() => editor.chain().focus().toggleStrike().run(), [editor])
  const toggleCode = useCallback(() => editor.chain().focus().toggleCode().run(), [editor])
  const setParagraph = useCallback(() => editor.chain().focus().setParagraph().run(), [editor])
  const toggleHeading1 = useCallback(() => editor.chain().focus().toggleHeading({ level: 1 }).run(), [editor])
  const toggleHeading2 = useCallback(() => editor.chain().focus().toggleHeading({ level: 2 }).run(), [editor])
  const toggleHeading3 = useCallback(() => editor.chain().focus().toggleHeading({ level: 3 }).run(), [editor])

  const applyTextStyle = useCallback((action: () => void) => {
    const savedSelection = selectionRef.current
    if (savedSelection && savedSelection.from !== savedSelection.to) {
      editor.chain()
        .focus()
        .setTextSelection(savedSelection)
        .run()
    }
    action()
  }, [editor])

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ state }) => {
        const { from, to } = state.selection
        if (from === to) return false
        
        const node = state.doc.nodeAt(from)
        if (node?.type.name === 'citation') return false
        
        const selection = state.selection as { node?: { type: { name: string } } }
        if (selection.node?.type.name === 'citation') return false
        
        selectionRef.current = { from, to }
        return true
      }}
      options={{ placement: 'top' }}
      className="flex items-center gap-0.5 p-1 bg-popover border border-border/50 rounded-full shadow-lg"
    >
      {/* AI Actions */}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs px-2.5 rounded-full text-foreground hover:bg-muted"
        onMouseDown={(event) => event.preventDefault()}
        onClick={handleAiEdit}
      >
        <Sparkles className="h-3 w-3" />
        <span className="hidden sm:inline">AI Edit</span>
      </Button>
      
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs px-2.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
        onMouseDown={(event) => event.preventDefault()}
        onClick={handleChat}
      >
        <MessageSquare className="h-3 w-3" />
        <span className="hidden sm:inline">Chat</span>
      </Button>
      
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs px-2.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onInsertCitation}
      >
        <AtSign className="h-3 w-3" />
        <span className="hidden sm:inline">Cite</span>
      </Button>

      <div className="w-px h-4 bg-border/50 mx-0.5" />

      {/* Text formatting */}
      <Button
        variant="ghost"
        size="icon"
        className={cn("h-7 w-7 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted", editor.isActive('bold') && "bg-muted text-foreground")}
        onClick={toggleBold}
        aria-label="Bold"
      >
        <Bold className="h-3 w-3" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className={cn("h-7 w-7 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted", editor.isActive('italic') && "bg-muted text-foreground")}
        onClick={toggleItalic}
        aria-label="Italic"
      >
        <Italic className="h-3 w-3" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className={cn("h-7 w-7 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted", editor.isActive('underline') && "bg-muted text-foreground")}
        onClick={toggleUnderline}
        aria-label="Underline"
      >
        <Underline className="h-3 w-3" />
      </Button>

      {/* More options */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted" aria-label="More formatting options">
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuPrimitive.Content
          align="end"
          side="bottom"
          sideOffset={4}
          alignOffset={0}
          collisionPadding={8}
          avoidCollisions={true}
          className={cn(
            "bg-popover text-popover-foreground z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-32 overflow-x-hidden overflow-y-auto rounded-xl border p-1 shadow-lg",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
          )}
        >
          <DropdownMenuItem 
            onSelect={(e) => { e.preventDefault(); applyTextStyle(setParagraph) }}
          >
            Paragraph
          </DropdownMenuItem>
          <DropdownMenuItem 
            onSelect={(e) => { e.preventDefault(); applyTextStyle(toggleHeading1) }}
          >
            Heading 1
          </DropdownMenuItem>
          <DropdownMenuItem 
            onSelect={(e) => { e.preventDefault(); applyTextStyle(toggleHeading2) }}
          >
            Heading 2
          </DropdownMenuItem>
          <DropdownMenuItem 
            onSelect={(e) => { e.preventDefault(); applyTextStyle(toggleHeading3) }}
          >
            Heading 3
          </DropdownMenuItem>
          
          <Separator className="my-1" />
          
          <DropdownMenuItem 
            onSelect={(e) => { e.preventDefault(); applyTextStyle(toggleStrike) }}
          >
            <Strikethrough className="h-3.5 w-3.5 mr-2" />
            Strikethrough
          </DropdownMenuItem>
          <DropdownMenuItem 
            onSelect={(e) => { e.preventDefault(); applyTextStyle(toggleCode) }}
          >
            <Code className="h-3.5 w-3.5 mr-2" />
            Code
          </DropdownMenuItem>
          
          <Separator className="my-1" />
          
          {COLORS.map((color) => (
            <DropdownMenuItem 
              key={color.name}
              onSelect={() => {
                if (color.value) {
                  editor.chain().focus().setColor(color.value).run()
                } else {
                  editor.chain().focus().unsetColor().run()
                }
              }}
            >
              <span 
                className="w-3 h-3 rounded-full mr-2 border border-border" 
                style={{ backgroundColor: color.value || 'transparent' }}
              />
              {color.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuPrimitive.Content>
      </DropdownMenu>
    </BubbleMenu>
  )
}
