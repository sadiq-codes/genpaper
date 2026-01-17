'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import { Button } from '@/components/ui/button'
import { 
  Send, 
  Bold, 
  Italic, 
  Link as LinkIcon, 
  Code,
  ImageIcon,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PaperMention, extractMentionedPaperIds, type MentionedPaper } from './PaperMention'
import { createMentionSuggestionRender } from './MentionSuggestion'
import { searchPapers } from '../hooks/usePaperSearch'
import type { ProjectPaper } from '../types'

// =============================================================================
// TYPES
// =============================================================================

export interface RichChatInputProps {
  /** Callback when message is sent */
  onSend: (content: string, mentionedPaperIds: string[], attachedImages: string[]) => void
  /** Whether input is disabled (e.g., AI is responding) */
  disabled?: boolean
  /** Placeholder text */
  placeholder?: string
  /** Papers available for @ mentions */
  papers?: ProjectPaper[]
  /** Project ID for image uploads */
  projectId?: string
  /** Callback for image upload */
  onImageUpload?: (file: File) => Promise<string | null>
  /** Whether an image is being uploaded */
  isUploadingImage?: boolean
}

export interface RichChatInputRef {
  focus: () => void
  clear: () => void
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Extract image URLs from editor JSON content
 */
function extractImageUrls(json: Record<string, unknown>): string[] {
  const urls: string[] = []
  
  function traverse(node: Record<string, unknown>) {
    if (node.type === 'image' && node.attrs) {
      const attrs = node.attrs as Record<string, unknown>
      if (attrs.src && typeof attrs.src === 'string') {
        urls.push(attrs.src)
      }
    }
    
    if (node.content && Array.isArray(node.content)) {
      for (const child of node.content) {
        traverse(child as Record<string, unknown>)
      }
    }
  }
  
  traverse(json)
  return urls
}

// =============================================================================
// COMPONENT
// =============================================================================

export function RichChatInput({
  onSend,
  disabled = false,
  placeholder = 'Ask about your research... Use @ to mention papers',
  papers = [],
  onImageUpload,
  isUploadingImage = false,
}: RichChatInputProps) {
  const editorContainerRef = useRef<HTMLDivElement>(null)

  // Create the search function for mentions
  const searchPapersCallback = useCallback(async (query: string): Promise<MentionedPaper[]> => {
    return searchPapers(papers, query, 10)
  }, [papers])

  // Configure PaperMention extension with suggestion
  const paperMentionExtension = useMemo(() => {
    return PaperMention.configure({
      suggestion: {
        render: createMentionSuggestionRender({
          onSearch: searchPapersCallback,
        }),
      },
    })
  }, [searchPapersCallback])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable features we don't need in chat
        heading: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        horizontalRule: false,
        codeBlock: false,
        // Keep basic formatting (empty object means use defaults)
        bold: {},
        italic: {},
        strike: {},
        code: {},
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: 'is-editor-empty',
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-primary underline cursor-pointer',
        },
      }),
      Image.configure({
        inline: true,
        allowBase64: true,
        HTMLAttributes: {
          class: 'chat-input-image',
        },
      }),
      paperMentionExtension,
    ],
    editorProps: {
      attributes: {
        class: 'rich-chat-input-editor',
      },
      handleKeyDown: (view, event) => {
        // Send on Enter (without Shift)
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          handleSend()
          return true
        }
        return false
      },
      handlePaste: (view, event) => {
        // Handle image paste
        const items = event.clipboardData?.items
        if (items) {
          for (const item of Array.from(items)) {
            if (item.type.startsWith('image/')) {
              event.preventDefault()
              const file = item.getAsFile()
              if (file && onImageUpload) {
                handleImageUpload(file)
              }
              return true
            }
          }
        }
        return false
      },
      handleDrop: (view, event) => {
        // Handle image drop
        const files = event.dataTransfer?.files
        if (files && files.length > 0) {
          const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'))
          if (imageFiles.length > 0 && onImageUpload) {
            event.preventDefault()
            handleImageUpload(imageFiles[0])
            return true
          }
        }
        return false
      },
    },
    immediatelyRender: false,
  })

  // Focus editor when not disabled
  useEffect(() => {
    if (!disabled && editor) {
      editor.commands.focus()
    }
  }, [disabled, editor])

  const handleImageUpload = useCallback(async (file: File) => {
    if (!onImageUpload || !editor) return
    
    const url = await onImageUpload(file)
    if (url) {
      editor.chain().focus().setImage({ src: url }).run()
    }
  }, [editor, onImageUpload])

  const handleSend = useCallback(() => {
    if (!editor || disabled) return

    const text = editor.getText().trim()
    if (!text && !editor.getHTML().includes('<img')) return

    // Extract mentioned paper IDs
    const json = editor.getJSON()
    const mentionedPaperIds = extractMentionedPaperIds(json)
    const imageUrls = extractImageUrls(json)

    // Get plain text content
    const content = text

    // Clear editor
    editor.commands.clearContent()

    // Send message
    onSend(content, mentionedPaperIds, imageUrls)
  }, [editor, disabled, onSend])

  const handleAddLink = useCallback(() => {
    if (!editor) return
    
    const previousUrl = editor.getAttributes('link').href
    const url = window.prompt('Enter URL:', previousUrl || 'https://')
    
    if (url === null) return
    
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }, [editor])

  const handleAddImage = useCallback(() => {
    if (!editor) return
    
    // Create hidden file input
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file && onImageUpload) {
        handleImageUpload(file)
      }
    }
    input.click()
  }, [editor, onImageUpload, handleImageUpload])

  const isEmpty = !editor?.getText().trim() && !editor?.getHTML().includes('<img')

  return (
    <div className="border-t border-border p-3 bg-muted/30">
      <div 
        ref={editorContainerRef}
        className={cn(
          "rich-chat-input-container",
          "flex flex-col rounded-lg border border-border bg-background",
          disabled && "opacity-60 cursor-not-allowed"
        )}
      >
        {/* Bubble Menu for text selection */}
        {editor && (
          <BubbleMenu
            editor={editor}
            options={{ placement: 'top' }}
            className="bubble-menu flex items-center gap-0.5 p-1 bg-card border border-border rounded-lg shadow-md"
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={cn(
                "h-7 w-7 p-0",
                editor.isActive('bold') && "bg-muted"
              )}
            >
              <Bold className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={cn(
                "h-7 w-7 p-0",
                editor.isActive('italic') && "bg-muted"
              )}
            >
              <Italic className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor.chain().focus().toggleCode().run()}
              className={cn(
                "h-7 w-7 p-0",
                editor.isActive('code') && "bg-muted"
              )}
            >
              <Code className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAddLink}
              className={cn(
                "h-7 w-7 p-0",
                editor.isActive('link') && "bg-muted"
              )}
            >
              <LinkIcon className="h-3.5 w-3.5" />
            </Button>
          </BubbleMenu>
        )}

        {/* Editor Content */}
        <div className="flex-1 min-h-[40px] max-h-[200px] overflow-y-auto px-3 py-2">
          <EditorContent 
            editor={editor} 
            disabled={disabled}
            className="rich-chat-input-content"
          />
        </div>

        {/* Bottom Toolbar */}
        <div className="flex items-center justify-between px-2 py-1.5 border-t border-border">
          <div className="flex items-center gap-1">
            {/* Image upload button */}
            {onImageUpload && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleAddImage}
                disabled={disabled || isUploadingImage}
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                title="Add image"
              >
                {isUploadingImage ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ImageIcon className="h-4 w-4" />
                )}
              </Button>
            )}
            
            {/* Hint text */}
            <span className="text-[10px] text-muted-foreground ml-1">
              @ to mention papers
            </span>
          </div>

          {/* Send button */}
          <Button
            onClick={handleSend}
            disabled={disabled || isEmpty}
            size="icon"
            className="h-7 w-7 shrink-0 rounded-lg"
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
