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
import { CitationPopover } from '../CitationPopover'
import { Citation } from '../extensions/Citation'
import { Mathematics } from '../extensions/Mathematics'
import { GhostText } from '../extensions/GhostText'
import { GhostEdit } from '../extensions/GhostEdit'
import { SlashCommands } from '../extensions/SlashCommands'
import { BlockId } from '../extensions/BlockId'
import { useSmartCompletion } from '../hooks/useSmartCompletion'
import { processContent, hasMarkdownFormatting } from '../utils/content-processor'
import { editorToMarkdown } from '../utils/tiptap-to-markdown'
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
  // Citation style for formatting (apa, mla, chicago, ieee, harvard, etc.)
  citationStyle?: string
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
  citationStyle = 'apa',
}: DocumentEditorProps) {
  const [mathDialogOpen, setMathDialogOpen] = useState(false)
  const [mathLatex, setMathLatex] = useState('')
  const [mathDisplayMode, setMathDisplayMode] = useState(false)
  
  // Process content helper function - converts markdown to TipTap JSON
  const processInitialContent = useCallback((content: string, papersList: ProjectPaper[]) => {
    // If no content or empty, use default
    if (!content || content.trim() === '') {
      return DEFAULT_CONTENT
    }
    
    const trimmedContent = content.trim()
    
    // Check if content looks like HTML (legacy data)
    const looksLikeHtml = /^<(h[1-6]|p|div|ul|ol|blockquote|pre|table)[^>]*>/i.test(trimmedContent)
    
    if (looksLikeHtml) {
      // Legacy HTML content - extract text and try to recover markdown
      const textContent = content
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/h[1-6]>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/\s*(#{1,6})\s+/g, '\n\n$1 ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      
      if (textContent) {
        try {
          const { json, isFullDoc } = processContent(textContent, papersList)
          if (isFullDoc && json) {
            console.log('[DocumentEditor] Recovered markdown from legacy HTML')
            return json
          }
        } catch (err) {
          console.error('Failed to process legacy HTML content:', err)
        }
      }
      // If recovery failed, let TipTap try to parse the HTML directly
      return content
    }
    
    // Content is markdown - process through AST pipeline
    try {
      const { json, isFullDoc } = processContent(trimmedContent, papersList)
      if (isFullDoc && json) {
        return json
      }
      
      // Handle plain text with citations (returns a fragment, not full doc)
      if (Array.isArray(json) && json.length > 0) {
        return {
          type: 'doc',
          content: [{
            type: 'paragraph',
            content: json
          }]
        }
      }
    } catch (err) {
      console.error('Failed to process markdown content:', err)
    }
    
    // Final fallback: return as plain text for TipTap to handle
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
          class: 'text-gray-600 hover:text-gray-800 underline cursor-pointer',
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
      Citation.configure({
        citationStyle: citationStyle,
      }),
      Mathematics,
      GhostText,
      GhostEdit,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      SlashCommands,
      BlockId,
    ],
    content: DEFAULT_CONTENT, // Initial empty state - real content set via effect
    editorProps: {
      attributes: {
        class: 'prose prose-lg max-w-none focus:outline-none min-h-[calc(100vh-200px)] px-16 py-12 md:px-24',
      },
    },
    onUpdate: ({ editor }) => {
      // Save as markdown, not HTML
      const markdown = editorToMarkdown(editor)
      onUpdate?.(markdown)
    },
    onCreate: ({ editor }) => {
      onEditorReady?.(editor)
    },
  })

  // Track the papers count we used for initial content processing
  const [processedWithPapersCount, setProcessedWithPapersCount] = useState<number>(-1)
  
  // Set initial content after editor is created - handles markdown processing
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (!initialContent || initialContent.trim() === '') return
    
    // Skip if we already processed with the same papers count
    if (processedWithPapersCount === papers.length) return
    
    // Process and set the initial content
    const processed = processInitialContent(initialContent, papers)
    
    // Log content processing in development
    if (process.env.NODE_ENV === 'development') {
      const contentPreview = initialContent.slice(0, 200)
      const isHtml = /^<(h[1-6]|p|div|ul|ol|blockquote|pre|table)[^>]*>/i.test(initialContent.trim())
      const hasRawMarkdown = /^#{1,6}\s+/m.test(initialContent)
      
      // Extract citation IDs from content for debugging
      const citationPattern = /\[@([a-f0-9-]+)\]|\[CITE:\s*([a-f0-9-]+)\]/gi
      const citationIds = [...initialContent.matchAll(citationPattern)].map(m => m[1] || m[2])
      
      console.log('[DocumentEditor] Processing initial content:', {
        contentLength: initialContent.length,
        isHtml,
        hasMarkdown: hasMarkdownFormatting(initialContent),
        hasRawMarkdownHeadings: hasRawMarkdown,
        processedType: typeof processed === 'object' ? 'JSON' : 'string',
        processedIsDoc: typeof processed === 'object' && processed?.type === 'doc',
        papersCount: papers.length,
        paperIds: papers.map(p => p.id),
        citationIdsInContent: citationIds,
        missingPapers: citationIds.filter(id => !papers.some(p => p.id === id)),
        contentPreview: contentPreview + (initialContent.length > 200 ? '...' : ''),
      })
    }
    
    // Set the processed content
    editor.commands.setContent(processed)
    setProcessedWithPapersCount(papers.length)
  }, [editor, initialContent, papers, processedWithPapersCount, processInitialContent])

  // Smart completion hook - ghost text appears seamlessly
  useSmartCompletion({
    editor,
    enabled: autocompleteEnabled,
    papers,
    projectId,
    projectTopic
  })

  // Update citation style when it changes
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    
    // Use the setCitationStyle command to update all citations
    editor.commands.setCitationStyle(citationStyle)
  }, [editor, citationStyle])

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
      // Escape user input to prevent XSS in error fallback
      const escaped = mathLatex
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
      return `<span class="text-red-500">${escaped}</span>`
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
        <CitationPopover editor={editor} projectId={projectId} papers={papers} />
        {/* CitationUpdater removed - citations now format locally via CitationNodeView */}
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
