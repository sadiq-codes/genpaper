'use client'

import { useCallback, useState, useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import { Image } from '@tiptap/extension-image'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import Placeholder from '@tiptap/extension-placeholder'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import Typography from '@tiptap/extension-typography'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Undo, Redo } from 'lucide-react'
import { FloatingToolbar } from './FloatingToolbar'
import { Citation } from '../extensions/Citation'
import { Mathematics } from '../extensions/Mathematics'
import { GhostText } from '../extensions/GhostText'
import { SlashCommands } from '../extensions/SlashCommands'
import { useSmartCompletion } from '../hooks/useSmartCompletion'
import { processContent, hasMarkdownFormatting } from '../utils/content-processor'
import type { Editor } from '@tiptap/react'
import type { ProjectPaper } from '../types'

// Create lowlight instance with common languages
const lowlight = createLowlight(common)
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import katex from 'katex'

interface DocumentEditorProps {
  initialContent?: string
  onUpdate?: (content: string) => void
  onEditorReady?: (editor: Editor) => void
  autocompleteEnabled?: boolean
  onInsertCitation: () => void
  onAiEdit: (text: string) => void
  onChat: (text: string) => void
  onInsertMath?: () => void
  // Context for smart completion
  projectId?: string
  projectTopic?: string
  papers?: ProjectPaper[]
}

const DEFAULT_CONTENT = `<h1></h1><p></p>`

export function DocumentEditor({
  initialContent = DEFAULT_CONTENT,
  onUpdate,
  onEditorReady,
  autocompleteEnabled = true,
  onInsertCitation,
  onAiEdit,
  onChat,
  onInsertMath: _onInsertMath,
  projectId = '',
  projectTopic = '',
  papers = [],
}: DocumentEditorProps) {
  const [mathDialogOpen, setMathDialogOpen] = useState(false)
  const [mathLatex, setMathLatex] = useState('')
  const [mathDisplayMode, setMathDisplayMode] = useState(false)

  // Track if initial content has been set
  const [hasSetInitialContent, setHasSetInitialContent] = useState(false)
  
  // Process content helper function - converts markdown to TipTap-compatible format
  const processInitialContent = useCallback((content: string, papersList: ProjectPaper[]) => {
    // If no content or empty, use default
    if (!content || content.trim() === '') {
      return DEFAULT_CONTENT
    }
    
    const trimmedContent = content.trim()
    
    // Check if content is already proper HTML (saved by editor's getHTML())
    // Proper HTML starts with tags AND contains proper heading tags (not raw ##)
    const htmlTagPattern = /^<(h[1-6]|p|div|ul|ol|blockquote|pre|table)[^>]*>/i
    const looksLikeHtml = htmlTagPattern.test(trimmedContent)
    const hasProperHeadings = /<h[1-6][^>]*>/.test(content)
    
    // Check for markdown patterns anywhere in the content
    const hasRawMarkdownHeadings = /^#{1,6}\s+/m.test(content) || />##?\s+[^<]/.test(content)
    const hasRawMarkdownFormatting = /\*\*[^*]+\*\*/.test(content) || /\*[^*]+\*/.test(content)
    
    if (looksLikeHtml && hasProperHeadings && !hasRawMarkdownHeadings) {
      // Content is properly formatted HTML - use directly
      return content
    }
    
    if (looksLikeHtml && (hasRawMarkdownHeadings || hasRawMarkdownFormatting)) {
      // Corrupted content: HTML with unprocessed markdown inside
      // e.g., <p>## Introduction...</p> - markdown wasn't converted
      const textContent = content
        .replace(/<br\s*\/?>/gi, '\n') // Convert br to newlines
        .replace(/<\/p>/gi, '\n\n') // Convert paragraph closes to double newlines
        .replace(/<\/h[1-6]>/gi, '\n\n') // Convert heading closes to double newlines
        .replace(/<[^>]+>/g, '') // Remove all other HTML tags
        .replace(/&nbsp;/g, ' ') // Convert nbsp to spaces
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/\n{3,}/g, '\n\n') // Collapse multiple newlines
        .trim()
      
      if (textContent && hasMarkdownFormatting(textContent)) {
        try {
          const { json, isFullDoc } = processContent(textContent, papersList)
          if (isFullDoc && json) {
            return json
          }
        } catch (err) {
          console.error('Failed to re-process corrupted HTML content:', err)
        }
      }
    }
    
    // Content is pure markdown (from AI generation or database) - process it
    if (hasMarkdownFormatting(trimmedContent)) {
      try {
        const { json, isFullDoc } = processContent(trimmedContent, papersList)
        if (isFullDoc && json) {
          return json
        }
      } catch (err) {
        console.error('Failed to process markdown content:', err)
      }
    }
    
    // Fallback: if content looks like plain text without HTML, wrap it properly
    if (!looksLikeHtml) {
      // Try to process as markdown anyway - might have subtle formatting
      try {
        const { json, isFullDoc } = processContent(trimmedContent, papersList)
        if (isFullDoc && json) {
          return json
        }
      } catch {
        // Ignore and fall through
      }
    }
    
    // Final fallback: return as-is (TipTap will handle plain text)
    return content
  }, [])

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
          // Ensure markdown shortcuts work (e.g., ## for H2)
        },
        codeBlock: false, // Disable default code block, use CodeBlockLowlight instead
        // Explicitly enable markdown shortcuts for bold, italic, etc.
      }),
      CodeBlockLowlight.configure({
        lowlight,
        HTMLAttributes: {
          class: 'hljs rounded-lg',
        },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-blue-600 hover:text-blue-800 underline cursor-pointer',
        },
      }),
      Image.configure({
        HTMLAttributes: {
          class: 'max-w-full h-auto rounded-lg my-4',
        },
      }),
      Table.configure({
        resizable: true,
        HTMLAttributes: {
          class: 'border-collapse table-auto w-full my-4',
        },
      }),
      TableRow,
      TableHeader.configure({
        HTMLAttributes: {
          class: 'bg-muted font-semibold border border-border p-2 text-left',
        },
      }),
      TableCell.configure({
        HTMLAttributes: {
          class: 'border border-border p-2',
        },
      }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === 'heading') {
            const level = node.attrs.level
            if (level === 1) return 'Untitled'
            return `Heading ${level}`
          }
          return "Type '/' for commands..."
        },
      }),
      TextStyle,
      Color,
      Highlight.configure({
        multicolor: true,
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Typography,
      Citation,
      Mathematics,
      GhostText,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      SlashCommands,
    ],
    content: DEFAULT_CONTENT, // Initial empty state - real content set via effect
    editorProps: {
      attributes: {
        class: 'prose prose-lg max-w-none focus:outline-none min-h-[calc(100vh-200px)] px-16 py-12 md:px-24',
      },
    },
    onUpdate: ({ editor }) => {
      onUpdate?.(editor.getHTML())
    },
    onCreate: ({ editor }) => {
      onEditorReady?.(editor)
    },
  })

  // Set initial content after editor is created - handles markdown processing
  useEffect(() => {
    if (!editor || editor.isDestroyed || hasSetInitialContent) return
    if (!initialContent || initialContent.trim() === '') return
    
    // Process and set the initial content
    const processed = processInitialContent(initialContent, papers)
    
    // Always log content processing in development for debugging
    if (process.env.NODE_ENV === 'development') {
      const contentPreview = initialContent.slice(0, 200)
      const isHtml = /^<(h[1-6]|p|div|ul|ol|blockquote|pre|table)[^>]*>/i.test(initialContent.trim())
      const hasRawMarkdown = /^#{1,6}\s+/m.test(initialContent)
      console.log('[DocumentEditor] Processing initial content:', {
        contentLength: initialContent.length,
        isHtml,
        hasMarkdown: hasMarkdownFormatting(initialContent),
        hasRawMarkdownHeadings: hasRawMarkdown,
        processedType: typeof processed === 'object' ? 'JSON' : 'string',
        processedIsDoc: typeof processed === 'object' && processed?.type === 'doc',
        papersCount: papers.length,
        contentPreview: contentPreview + (initialContent.length > 200 ? '...' : ''),
      })
    }
    
    // Set the processed content
    editor.commands.setContent(processed)
    setHasSetInitialContent(true)
  }, [editor, initialContent, papers, hasSetInitialContent, processInitialContent])

  // Smart completion hook - ghost text appears seamlessly
  useSmartCompletion({
    editor,
    enabled: autocompleteEnabled,
    papers,
    projectId,
    projectTopic
  })

  const _handleInsertMath = useCallback(() => {
    setMathDialogOpen(true)
  }, [])

  const confirmInsertMath = useCallback(() => {
    if (editor && mathLatex) {
      editor.chain().focus().insertMath(mathLatex, mathDisplayMode).run()
      setMathLatex('')
      setMathDisplayMode(false)
      setMathDialogOpen(false)
    }
  }, [editor, mathLatex, mathDisplayMode])

  const renderMathPreview = () => {
    try {
      return katex.renderToString(mathLatex, {
        displayMode: mathDisplayMode,
        throwOnError: false,
      })
    } catch {
      return `<span class="text-red-500">${mathLatex}</span>`
    }
  }

  if (!editor) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading editor...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Minimal undo/redo bar - Notion-like */}
      <div className="flex items-center justify-end px-4 py-1 border-b border-border/30">
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
          >
            <Undo className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
          >
            <Redo className="h-4 w-4" />
          </Button>
        </div>
      </div>
      
      <div className="flex-1 overflow-auto relative">
        <FloatingToolbar
          editor={editor}
          onAiEdit={onAiEdit}
          onInsertCitation={onInsertCitation}
          onChat={onChat}
        />
        <EditorContent editor={editor} className="h-full" />
      </div>

      {/* Math Input Dialog */}
      <Dialog open={mathDialogOpen} onOpenChange={setMathDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Insert Math Formula</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="latex">LaTeX Expression</Label>
              <Input
                id="latex"
                value={mathLatex}
                onChange={(e) => setMathLatex(e.target.value)}
                placeholder="e.g., E = mc^2"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="displayMode"
                checked={mathDisplayMode}
                onChange={(e) => setMathDisplayMode(e.target.checked)}
                className="rounded"
              />
              <Label htmlFor="displayMode">Display mode (block)</Label>
            </div>
            {mathLatex && (
              <div className="p-4 bg-muted rounded-lg text-center">
                <span className="text-sm text-muted-foreground">Preview:</span>
                <div 
                  className="mt-2"
                  dangerouslySetInnerHTML={{ __html: renderMathPreview() }}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMathDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmInsertMath} disabled={!mathLatex}>
              Insert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
