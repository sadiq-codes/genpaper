'use client'

import { useCallback } from 'react'
import type { Editor } from '@tiptap/react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  AtSign,
  Type,
  Image as ImageIcon,
  Table,
  Minus,
  Code,
  Sigma,
  Undo,
  Redo,
  ChevronDown,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSubscription } from '@/lib/hooks/use-subscription'

interface PrimaryToolbarProps {
  editor: Editor | null
  autocompleteEnabled: boolean
  onAutocompleteChange: (enabled: boolean) => void
  onInsertCitation: () => void
  onInsertMath: () => void
}

export function PrimaryToolbar({
  editor,
  autocompleteEnabled,
  onAutocompleteChange,
  onInsertCitation,
  onInsertMath,
}: PrimaryToolbarProps) {
  const insertImage = useCallback(() => {
    const url = window.prompt('Enter image URL')
    if (url && editor) {
      editor.chain().focus().setImage({ src: url }).run()
    }
  }, [editor])

  const insertTable = useCallback(() => {
    editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
  }, [editor])

  const insertHorizontalRule = useCallback(() => {
    editor?.chain().focus().setHorizontalRule().run()
  }, [editor])

  const insertCodeBlock = useCallback(() => {
    editor?.chain().focus().toggleCodeBlock().run()
  }, [editor])

  // Get daily usage for autocomplete indicator (free tier only)
  const { dailyUsage, isPaid } = useSubscription()
  
  // Calculate autocomplete remaining for free tier
  const autocompleteRemaining = dailyUsage && !dailyUsage.autocomplete.isUnlimited
    ? Math.max(0, dailyUsage.autocomplete.limit - dailyUsage.autocomplete.used)
    : null
  const autocompleteIsLow = autocompleteRemaining !== null && autocompleteRemaining <= 3
  const autocompleteIsOut = autocompleteRemaining === 0

  if (!editor) return null

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 bg-muted/30">
      <div className="flex items-center gap-3">
        {/* Autocomplete toggle with usage indicator */}
        <div className="flex items-center gap-2">
          <Switch
            id="autocomplete"
            checked={autocompleteEnabled}
            onCheckedChange={onAutocompleteChange}
            className="data-[state=checked]:bg-primary"
            disabled={autocompleteIsOut}
          />
          <label 
            htmlFor="autocomplete" 
            className="text-sm font-medium cursor-pointer select-none"
          >
            Autocomplete
          </label>
          {/* Usage indicator for free tier */}
          {!isPaid && autocompleteRemaining !== null && (
            <span className={cn(
              "text-xs px-1.5 py-0.5 rounded-full",
              autocompleteIsOut && "bg-destructive/10 text-destructive",
              autocompleteIsLow && !autocompleteIsOut && "bg-yellow-500/10 text-yellow-600 dark:text-yellow-500",
              !autocompleteIsLow && "bg-muted text-muted-foreground"
            )}>
              {autocompleteRemaining} left
            </span>
          )}
        </div>

        <Separator orientation="vertical" className="h-6" />

        <TooltipProvider delayDuration={300}>
          {/* Cite button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-sm"
                onClick={onInsertCitation}
              >
                <AtSign className="h-4 w-4" />
                Cite
              </Button>
            </TooltipTrigger>
            <TooltipContent>Insert citation</TooltipContent>
          </Tooltip>

          {/* Text style dropdown */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1.5 text-sm">
                    <Type className="h-4 w-4" />
                    Text
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Text styles</TooltipContent>
            </Tooltip>
            <DropdownMenuContent>
              <DropdownMenuItem 
                onClick={() => editor.chain().focus().setParagraph().run()}
                className={cn(editor.isActive('paragraph') && 'bg-accent')}
              >
                Paragraph
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                className={cn(editor.isActive('heading', { level: 1 }) && 'bg-accent')}
              >
                Heading 1
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                className={cn(editor.isActive('heading', { level: 2 }) && 'bg-accent')}
              >
                Heading 2
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                className={cn(editor.isActive('heading', { level: 3 }) && 'bg-accent')}
              >
                Heading 3
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Separator orientation="vertical" className="h-6" />

          {/* Insert icons */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={insertImage} aria-label="Insert image">
                <ImageIcon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Insert image</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={insertTable}>
                <Table className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Insert table</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={insertHorizontalRule}>
                <Minus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Horizontal rule</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={insertCodeBlock}>
                <Code className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Code block</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onInsertMath}>
                <Sigma className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Insert math formula</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Right side: Undo/Redo */}
      <div className="flex items-center gap-1">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => editor.chain().focus().undo().run()}
                disabled={!editor.can().undo()}
              >
                <Undo className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Undo</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => editor.chain().focus().redo().run()}
                disabled={!editor.can().redo()}
              >
                <Redo className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Redo</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  )
}
