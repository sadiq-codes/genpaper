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
      shouldShow={({ editor: editorInstance }) => {
        // Save selection whenever bubble menu visibility is computed
        const { from, to } = editorInstance.state.selection
        if (from !== to) {
          selectionRef.current = { from, to }
        }
        // Show menu when there's a selection
        return !editorInstance.state.selection.empty
      }}
      options={{ placement: 'top' }}
      className="flex items-center gap-0.5 p-1.5 bg-background border border-border rounded-lg shadow-lg"
    >
      {/* AI Actions */}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 text-xs px-2"
        onClick={onInsertCitation}
      >
        <AtSign className="h-3 w-3" />
        Cite
      </Button>
      
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 text-xs px-2"
        onClick={handleChat}
      >
        <MessageSquare className="h-3 w-3" />
        Chat
      </Button>
      
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 text-xs px-2 text-primary"
        onClick={handleAiEdit}
      >
        <Sparkles className="h-3 w-3" />
        AI Edit
      </Button>

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* Heading dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs px-2">
            <Heading2 className="h-3 w-3" />
            {getCurrentHeadingLevel()}
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
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
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Color picker */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <Palette className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {COLORS.map((color) => (
            <DropdownMenuItem 
              key={color.name}
              onClick={() => {
                if (color.value) {
                  editor.chain().focus().setColor(color.value).run()
                } else {
                  editor.chain().focus().unsetColor().run()
                }
              }}
            >
              <span 
                className="w-4 h-4 rounded-full mr-2 border" 
                style={{ backgroundColor: color.value || 'transparent' }}
              />
              {color.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* Formatting buttons */}
      <Button
        variant="ghost"
        size="icon"
        className={cn("h-7 w-7", editor.isActive('bold') && "bg-accent")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="h-3 w-3" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className={cn("h-7 w-7", editor.isActive('italic') && "bg-accent")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="h-3 w-3" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className={cn("h-7 w-7", editor.isActive('underline') && "bg-accent")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <Underline className="h-3 w-3" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className={cn("h-7 w-7", editor.isActive('strike') && "bg-accent")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="h-3 w-3" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className={cn("h-7 w-7", editor.isActive('code') && "bg-accent")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code className="h-3 w-3" />
      </Button>

      {/* Link button with popover */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-7 w-7", editor.isActive('link') && "bg-accent")}
          >
            <Link className="h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2">
          <div className="flex gap-2">
            <Input
              placeholder="Enter URL"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              className="h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter') setLink()
              }}
            />
            <Button size="sm" className="h-8" onClick={setLink}>
              Set
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* Undo/Redo */}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
      >
        <Undo className="h-3 w-3" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
      >
        <Redo className="h-3 w-3" />
      </Button>
    </BubbleMenu>
  )
}
