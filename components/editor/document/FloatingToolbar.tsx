'use client'

import { useCallback, useState, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverTrigger,
} from '@/components/ui/popover'
import * as PopoverPrimitive from '@radix-ui/react-popover'
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
  Settings,
} from 'lucide-react'
import { useAutocompletePrefs } from '../hooks/useAutocompletePrefs'

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
  
  // Autocomplete preferences
  const { prefs, setAutoSuggestions, setIncludeCitations, setAcceptKey } = useAutocompletePrefs()
  
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

  // Memoized formatting handlers to prevent unnecessary re-renders
  const toggleBold = useCallback(() => editor.chain().focus().toggleBold().run(), [editor])
  const toggleItalic = useCallback(() => editor.chain().focus().toggleItalic().run(), [editor])
  const toggleUnderline = useCallback(() => editor.chain().focus().toggleUnderline().run(), [editor])
  const toggleStrike = useCallback(() => editor.chain().focus().toggleStrike().run(), [editor])
  const toggleCode = useCallback(() => editor.chain().focus().toggleCode().run(), [editor])
  const setParagraph = useCallback(() => editor.chain().focus().setParagraph().run(), [editor])
  const toggleHeading1 = useCallback(() => editor.chain().focus().toggleHeading({ level: 1 }).run(), [editor])
  const toggleHeading2 = useCallback(() => editor.chain().focus().toggleHeading({ level: 2 }).run(), [editor])
  const toggleHeading3 = useCallback(() => editor.chain().focus().toggleHeading({ level: 3 }).run(), [editor])

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

      {/* AI Settings Popover */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverPrimitive.Content
          className={cn(
            "bg-popover text-popover-foreground z-50 w-72 rounded-md border p-4 shadow-md outline-hidden",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
          )}
          align="start"
          side="bottom"
          sideOffset={8}
        >
          <div className="space-y-4">
            <h4 className="font-medium text-sm">AI Suggestions</h4>
            
            {/* Auto-suggestions toggle */}
            <div className="flex items-center justify-between space-y-0">
              <div className="space-y-0.5">
                <Label htmlFor="auto-suggestions" className="text-sm cursor-pointer">
                  Auto-suggestions
                </Label>
                <p className="text-xs text-muted-foreground">Experimental feature</p>
              </div>
              <Switch
                id="auto-suggestions"
                checked={prefs.autoSuggestions}
                onCheckedChange={setAutoSuggestions}
              />
            </div>

            {/* Include citations toggle */}
            <div className="flex items-center justify-between space-y-0">
              <div className="space-y-0.5">
                <Label htmlFor="include-citations" className="text-sm cursor-pointer">
                  Include citations
                </Label>
                <p className="text-xs text-muted-foreground">Add sources to suggestions</p>
              </div>
              <Switch
                id="include-citations"
                checked={prefs.includeCitations}
                onCheckedChange={setIncludeCitations}
              />
            </div>

            <Separator className="my-2" />

            {/* Accept key selection */}
            <div className="space-y-2">
              <Label className="text-sm">Accept key</Label>
              <RadioGroup
                value={prefs.acceptKey}
                onValueChange={(value) => setAcceptKey(value as 'tab' | 'ctrlEnter')}
                className="flex flex-col gap-2"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="tab" id="tab" />
                  <Label htmlFor="tab" className="text-sm font-normal cursor-pointer">
                    Tab
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="ctrlEnter" id="ctrlEnter" />
                  <Label htmlFor="ctrlEnter" className="text-sm font-normal cursor-pointer">
                    Ctrl+Enter
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </div>
        </PopoverPrimitive.Content>
      </Popover>

      <Separator orientation="vertical" className="h-6 mx-0.5" />

      {/* Text formatting - Secondary group */}
      <Button
        variant="ghost"
        size="icon"
        className={cn("h-8 w-8 rounded-full", editor.isActive('bold') && "bg-muted")}
        onClick={toggleBold}
      >
        <Bold className="h-3.5 w-3.5" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className={cn("h-8 w-8 rounded-full", editor.isActive('italic') && "bg-muted")}
        onClick={toggleItalic}
      >
        <Italic className="h-3.5 w-3.5" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className={cn("h-8 w-8 rounded-full", editor.isActive('underline') && "bg-muted")}
        onClick={toggleUnderline}
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
        <DropdownMenuPrimitive.Content
          align="end"
          side="bottom"
          sideOffset={4}
          alignOffset={0}
          collisionPadding={8}
          avoidCollisions={true}
          className={cn(
            "bg-popover text-popover-foreground z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-32 overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
          )}
        >
          {/* Heading options - using memoized handlers wrapped with applyTextStyle */}
          <DropdownMenuItem 
            onSelect={(e) => {
              e.preventDefault()
              applyTextStyle(setParagraph)
            }}
          >
            Paragraph
          </DropdownMenuItem>
          <DropdownMenuItem 
            onSelect={(e) => {
              e.preventDefault()
              applyTextStyle(toggleHeading1)
            }}
          >
            Heading 1
          </DropdownMenuItem>
          <DropdownMenuItem 
            onSelect={(e) => {
              e.preventDefault()
              applyTextStyle(toggleHeading2)
            }}
          >
            Heading 2
          </DropdownMenuItem>
          <DropdownMenuItem 
            onSelect={(e) => {
              e.preventDefault()
              applyTextStyle(toggleHeading3)
            }}
          >
            Heading 3
          </DropdownMenuItem>
          
          <Separator className="my-1" />
          
          {/* Additional formatting */}
          <DropdownMenuItem 
            onSelect={(e) => {
              e.preventDefault()
              applyTextStyle(toggleStrike)
            }}
          >
            <Strikethrough className="h-3.5 w-3.5 mr-2" />
            Strikethrough
          </DropdownMenuItem>
          <DropdownMenuItem 
            onSelect={(e) => {
              e.preventDefault()
              applyTextStyle(toggleCode)
            }}
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
        </DropdownMenuPrimitive.Content>
      </DropdownMenu>
    </BubbleMenu>
  )
}
