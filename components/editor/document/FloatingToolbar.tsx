'use client'

import { useCallback, useState, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import {
  AtSign,
  MessageSquare,
  Sparkles,
  Heading2,
  ChevronDown,
  Palette,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Link,
  Undo,
  Redo,
} from 'lucide-react'
import { cn } from '@/lib/utils'

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
  const [linkUrl, setLinkUrl] = useState('')
  // Store selection when bubble menu opens to prevent losing it on dropdown click
  const selectionRef = useRef<{ from: number; to: number } | null>(null)
  
  const getSelectedText = useCallback(() => {
    const { from, to } = editor.state.selection
    return editor.state.doc.textBetween(from, to, ' ')
  }, [editor])

  const handleAiEdit = useCallback(() => {
    const text = getSelectedText()
    if (text) onAiEdit(text)
  }, [getSelectedText, onAiEdit])

  const handleChat = useCallback(() => {
    const text = getSelectedText()
    if (text) onChat(text)
  }, [getSelectedText, onChat])

  const setLink = useCallback(() => {
    if (linkUrl) {
      editor.chain().focus().setLink({ href: linkUrl }).run()
      setLinkUrl('')
    } else {
      editor.chain().focus().unsetLink().run()
    }
  }, [editor, linkUrl])

  const getCurrentHeadingLevel = () => {
    if (editor.isActive('heading', { level: 1 })) return 'Heading 1'
    if (editor.isActive('heading', { level: 2 })) return 'Heading 2'
    if (editor.isActive('heading', { level: 3 })) return 'Heading 3'
    return 'Paragraph'
  }

  // Apply text style with saved selection to prevent affecting entire document
  const applyTextStyle = useCallback((action: () => void) => {
    const savedSelection = selectionRef.current
    if (savedSelection && savedSelection.from !== savedSelection.to) {
      // Restore selection before applying command
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
        
        // Don't show for empty selections
        if (from === to) return false
        
        // Don't show when a citation node is selected (let CitationPopover handle it)
        const node = state.doc.nodeAt(from)
        if (node?.type.name === 'citation') return false
        
        // Also check if we're in a NodeSelection of a citation
        // NodeSelection has a 'node' property
        const selection = state.selection as { node?: { type: { name: string } } }
        if (selection.node?.type.name === 'citation') return false
        
        // Save selection for later use
        selectionRef.current = { from, to }
        
        // Show menu when there's a text selection
        return true
      }}
      options={{ placement: 'top' }}
      className="flex items-center gap-1 p-1 bg-background border border-border/60 rounded-full shadow-lg"
    >
      {/* AI Actions - Primary group */}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 text-xs px-3 rounded-full text-primary hover:bg-primary/10"
        onClick={handleAiEdit}
      >
        <Sparkles className="h-3.5 w-3.5" />
        AI Edit
      </Button>
      
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 text-xs px-3 rounded-full"
        onClick={handleChat}
      >
        <MessageSquare className="h-3.5 w-3.5" />
        Chat
      </Button>
      
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 text-xs px-3 rounded-full"
        onClick={onInsertCitation}
      >
        <AtSign className="h-3.5 w-3.5" />
        Cite
      </Button>

      <Separator orientation="vertical" className="h-6 mx-0.5" />

      {/* Text formatting - Secondary group */}
      <Button
        variant="ghost"
        size="icon"
        className={cn("h-8 w-8 rounded-full", editor.isActive('bold') && "bg-muted")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="h-3.5 w-3.5" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className={cn("h-8 w-8 rounded-full", editor.isActive('italic') && "bg-muted")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="h-3.5 w-3.5" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className={cn("h-8 w-8 rounded-full", editor.isActive('underline') && "bg-muted")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <Underline className="h-3.5 w-3.5" />
      </Button>

      {/* More options dropdown */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent 
          align="end" 
          side="bottom" 
          sideOffset={4} 
          alignOffset={0}
          collisionPadding={8}
          avoidCollisions={true}
        >
          {/* Heading options */}
          <DropdownMenuItem 
            onSelect={(e) => {
              e.preventDefault()
              applyTextStyle(() => editor.chain().focus().setParagraph().run())
            }}
          >
            Paragraph
          </DropdownMenuItem>
          <DropdownMenuItem 
            onSelect={(e) => {
              e.preventDefault()
              applyTextStyle(() => editor.chain().focus().toggleHeading({ level: 1 }).run())
            }}
          >
            Heading 1
          </DropdownMenuItem>
          <DropdownMenuItem 
            onSelect={(e) => {
              e.preventDefault()
              applyTextStyle(() => editor.chain().focus().toggleHeading({ level: 2 }).run())
            }}
          >
            Heading 2
          </DropdownMenuItem>
          <DropdownMenuItem 
            onSelect={(e) => {
              e.preventDefault()
              applyTextStyle(() => editor.chain().focus().toggleHeading({ level: 3 }).run())
            }}
          >
            Heading 3
          </DropdownMenuItem>
          
          <Separator className="my-1" />
          
          {/* Additional formatting */}
          <DropdownMenuItem 
            onSelect={() => editor.chain().focus().toggleStrike().run()}
          >
            <Strikethrough className="h-3.5 w-3.5 mr-2" />
            Strikethrough
          </DropdownMenuItem>
          <DropdownMenuItem 
            onSelect={() => editor.chain().focus().toggleCode().run()}
          >
            <Code className="h-3.5 w-3.5 mr-2" />
            Code
          </DropdownMenuItem>
          
          <Separator className="my-1" />
          
          {/* Color submenu */}
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
                className="w-3.5 h-3.5 rounded-full mr-2 border border-border" 
                style={{ backgroundColor: color.value || 'transparent' }}
              />
              {color.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </BubbleMenu>
  )
}
