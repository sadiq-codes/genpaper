'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { PaperMention, PaperMentionPluginKey, extractMentionedPaperIds, type MentionedPaper } from './PaperMention'
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
  /** Callback to insert a citation into the document editor */
  onCitePaper?: (paper: MentionedPaper) => void
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
  onCitePaper,
  onImageUpload,
  isUploadingImage = false,
}: RichChatInputProps) {
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const [isEmpty, setIsEmpty] = useState(true)

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
          onCite: onCitePaper,
        }),
      },
    })
  }, [searchPapersCallback, onCitePaper])

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
        // Check if mention suggestion is active - if so, let it handle Enter
        const { state } = view
        const suggestionState = PaperMentionPluginKey.getState(state)
        
        // If suggestion menu is open, let it handle Enter/Tab keys
        if (suggestionState?.active) {
          // Don't intercept - let suggestion plugin handle it
          return false
        }
        
        // Send on Enter (without Shift) only if suggestion is not active
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
    onUpdate: ({ editor: e }) => {
      const hasText = !!e.getText().trim()
      const hasImage = e.getHTML().includes('<img')
      setIsEmpty(!hasText && !hasImage)
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

  return (
    <div className="px-3 py-2">
      <div 
        ref={editorContainerRef}
        className={cn(
          "rich-chat-input-container relative",
          "rounded-xl border border-border/40 bg-muted/30",
          "focus-within:border-border/60 transition-colors",
          disabled && "opacity-60 cursor-not-allowed"
        )}
      >
        {/* Bubble Menu for text selection */}
        {editor && (
          <BubbleMenu
            editor={editor}
            options={{ placement: 'top' }}
            className="bubble-menu flex items-center gap-0.5 p-0.5 bg-popover border border-border/50 rounded-full shadow-lg"
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={cn(
                "h-6 w-6 p-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted",
                editor.isActive('bold') && "bg-muted text-foreground"
              )}
            >
              <Bold className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={cn(
                "h-6 w-6 p-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted",
                editor.isActive('italic') && "bg-muted text-foreground"
              )}
            >
              <Italic className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor.chain().focus().toggleCode().run()}
              className={cn(
                "h-6 w-6 p-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted",
                editor.isActive('code') && "bg-muted text-foreground"
              )}
            >
              <Code className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAddLink}
              className={cn(
                "h-6 w-6 p-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted",
                editor.isActive('link') && "bg-muted text-foreground"
              )}
            >
              <LinkIcon className="h-3 w-3" />
            </Button>
          </BubbleMenu>
        )}

        {/* Editor Content */}
        <div 
          className="min-h-[56px] max-h-[180px] overflow-y-auto px-3.5 pt-2.5 pb-10 cursor-text"
          onClick={() => editor?.commands.focus()}
        >
          <EditorContent 
            editor={editor} 
            disabled={disabled}
            className="rich-chat-input-content"
          />
        </div>

        {/* Bottom Toolbar */}
        <div className="absolute bottom-1.5 left-2.5 right-2.5 flex items-center justify-between">
          <div className="flex items-center gap-1">
            {onImageUpload && (
              <button
                onClick={handleAddImage}
                disabled={disabled || isUploadingImage}
                className="h-6 w-6 flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground transition-colors rounded-full disabled:opacity-40 cursor-pointer"
                title="Add image"
              >
                {isUploadingImage ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ImageIcon className="h-3 w-3" />
                )}
              </button>
            )}
            <span className="text-[10px] text-muted-foreground/40">
              @ to mention
            </span>
          </div>

          <button
            onClick={handleSend}
            disabled={disabled || isEmpty}
            className={cn(
              "h-7 w-7 shrink-0 rounded-full flex items-center justify-center transition-all cursor-pointer",
              disabled || isEmpty 
                ? "bg-muted text-muted-foreground/30" 
                : "bg-foreground text-background hover:bg-foreground/90 shadow-sm"
            )}
          >
            <Send className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  )
}
