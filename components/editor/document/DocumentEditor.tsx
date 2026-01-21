'use client'

import { useCallback, useState, useEffect, useRef } from 'react'
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
import { ReviewToolbar } from '../ReviewToolbar'
import { Citation } from '../extensions/Citation'
import { Mathematics } from '../extensions/Mathematics'
import { GhostText } from '../extensions/GhostText'
import { GhostEdit } from '../extensions/GhostEdit'
import { SlashCommands } from '../extensions/SlashCommands'
import { BlockId } from '../extensions/BlockId'
import { useSmartCompletion } from '../hooks/useSmartCompletion'
import { processContent, hasMarkdownFormatting } from '../utils/content-processor'
import { editorToMarkdown } from '../utils/tiptap-to-markdown'
import type { InstanceQuotesMap } from '../utils/markdown-to-tiptap'
import type { Editor } from '@tiptap/react'
import type { ProjectPaper } from '../types'

// Create lowlight instance with common languages
const lowlight = createLowlight(common)

/**
 * Extract all instanceIds from content that uses [@paperId#instanceId] format
 */
function extractInstanceIds(content: string): string[] {
  const pattern = /\[@[a-f0-9-]{36}#([a-f0-9-]{36})\]/gi
  const instanceIds: string[] = []
  for (const match of content.matchAll(pattern)) {
    instanceIds.push(match[1])
  }
  return instanceIds
}

/**
 * Fetch citation instance quotes from the server
 */
async function fetchInstanceQuotes(projectId: string, instanceIds: string[]): Promise<InstanceQuotesMap> {
  const quotesMap: InstanceQuotesMap = new Map()
  
  if (!projectId || instanceIds.length === 0) {
    return quotesMap
  }
  
  try {
    const response = await fetch(`/api/citation-instances?projectId=${projectId}&instanceIds=${instanceIds.join(',')}`)
    if (response.ok) {
      const data = await response.json()
      const instances = Array.isArray(data.instances) ? data.instances : []
      for (const instance of instances) {
        if (instance.id && instance.quote) {
          quotesMap.set(instance.id, instance.quote)
        }
      }
    }
  } catch (error) {
    console.error('[DocumentEditor] Failed to fetch instance quotes:', error)
  }
  
  return quotesMap
}
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
  // Review toolbar props for pending edits
  pendingEditCount?: number
  activeEditIndex?: number
  onNavigateEdit?: (direction: 'next' | 'prev') => void
  onAcceptAllEdits?: () => void
  onRejectAllEdits?: () => void
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
  pendingEditCount = 0,
  activeEditIndex = 0,
  onNavigateEdit,
  onAcceptAllEdits,
  onRejectAllEdits,
}: DocumentEditorProps) {
  const [mathDialogOpen, setMathDialogOpen] = useState(false)
  const [mathLatex, setMathLatex] = useState('')
  const [mathDisplayMode, setMathDisplayMode] = useState(false)
  const [toolbarMinimized, setToolbarMinimized] = useState(false)
  
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
        class: 'prose prose-lg max-w-none focus:outline-none min-h-[calc(100vh-200px)] px-4 pt-3 pb-6 sm:px-8 sm:pt-4 sm:pb-8 md:px-16 md:pt-6 lg:px-24 lg:pt-8 lg:pb-12',
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
    
    // Set the processed content, then apply citation style to build numbers
    editor.commands.setContent(processed)
    editor.commands.setCitationStyle(citationStyle)
    setProcessedWithPapersCount(papers.length)
  }, [editor, initialContent, papers, processedWithPapersCount, processInitialContent, citationStyle])

  // Track previous citation style to detect changes
  const prevCitationStyleRef = useRef(citationStyle)
  
  // Update citation style when it changes (not on initial load - that's handled above)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (prevCitationStyleRef.current === citationStyle) return
    
    prevCitationStyleRef.current = citationStyle
    editor.commands.setCitationStyle(citationStyle)
  }, [editor, citationStyle])
  
  // Sync papers to Citation extension storage
  // This allows CitationNodeView to look up paper metadata at render time,
  // ensuring citations always display correctly even when node.attrs are incomplete
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    
    // Update Citation extension storage with current papers
    editor.commands.setPapers(papers)
    
    if (process.env.NODE_ENV === 'development' && papers.length > 0) {
      console.log(`[DocumentEditor] Synced ${papers.length} papers to Citation extension storage`)
    }
  }, [editor, papers])
  
  // Fetch citation instance quotes after content is loaded
  // This populates citedContent for hover previews
  useEffect(() => {
    if (!editor || editor.isDestroyed || !projectId || !initialContent) return
    if (processedWithPapersCount === -1) return // Wait for initial content to be set
    
    const instanceIds = extractInstanceIds(initialContent)
    if (instanceIds.length === 0) return
    
    // Fetch quotes and update citation nodes
    fetchInstanceQuotes(projectId, instanceIds).then(quotesMap => {
      if (quotesMap.size === 0 || !editor || editor.isDestroyed) return
      
      // Walk the document and update citation nodes with citedContent
      const { tr } = editor.state
      let modified = false
      
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'citation' && node.attrs.instanceId) {
          const quote = quotesMap.get(node.attrs.instanceId)
          if (quote && !node.attrs.citedContent) {
            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              citedContent: quote,
            })
            modified = true
          }
        }
      })
      
      if (modified) {
        editor.view.dispatch(tr)
        console.log(`[DocumentEditor] Populated citedContent for ${quotesMap.size} citation instances`)
      }
    })
  }, [editor, projectId, initialContent, processedWithPapersCount])

  // Smart completion hook - ghost text appears seamlessly
  useSmartCompletion({
    editor,
    enabled: autocompleteEnabled,
    papers,
    projectId,
    projectTopic
  })

  // Pre-warm RAG cache on editor load for faster autocomplete
  // This runs once when the editor is ready with papers
  const prewarmCalledRef = useRef(false)
  
  useEffect(() => {
    if (!projectId || papers.length === 0 || prewarmCalledRef.current) return
    prewarmCalledRef.current = true
    
    // Extract section titles from document outline for targeted pre-warming
    const sections = initialContent
      .match(/^#{1,3}\s+.+$/gm)
      ?.map(h => h.replace(/^#+\s+/, '').trim())
      .slice(0, 5) || []
    
    // Fire and forget - don't block editor
    fetch('/api/editor/prewarm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        paperIds: papers.map(p => p.id),
        sections
      })
    }).then(res => {
      if (res.ok) {
        res.json().then(data => {
          console.log(`[DocumentEditor] RAG cache pre-warmed: ${data.prewarmed} queries in ${data.duration}ms`)
        })
      }
    }).catch(err => {
      // Silently ignore pre-warm errors - it's just an optimization
      console.warn('[DocumentEditor] Pre-warm failed:', err)
    })
  }, [projectId, papers, initialContent])

  // Listen for citations accepted event to save citedContent to database
  useEffect(() => {
    if (!editor || editor.isDestroyed || !projectId) return

    const handleCitationsAccepted = async (event: Event) => {
      const customEvent = event as CustomEvent<{ citations: Array<{ paperId: string; citedContent?: string }> }>
      const { citations } = customEvent.detail

      if (!citations || citations.length === 0) return

      // Save each citation's citedContent to the database
      for (const citation of citations) {
        if (!citation.citedContent) continue

        try {
          await fetch('/api/citations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId,
              paperId: citation.paperId,
              quote: citation.citedContent,
              reason: 'AI-generated citation'
            })
          })
        } catch (error) {
          console.error('[DocumentEditor] Failed to save citation quote:', error)
        }
      }
    }

    const editorDom = editor.view.dom
    editorDom.addEventListener('ghosttext:citations-accepted', handleCitationsAccepted)

    return () => {
      editorDom.removeEventListener('ghosttext:citations-accepted', handleCitationsAccepted)
    }
  }, [editor, projectId])

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
      <div className="flex items-center justify-end px-2 py-0.5 sm:px-4 sm:py-1 border-b border-border/30">
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 sm:h-7 sm:w-7 text-muted-foreground hover:text-foreground"
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
          >
            <Undo className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 sm:h-7 sm:w-7 text-muted-foreground hover:text-foreground"
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
          >
            <Redo className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </Button>
        </div>
      </div>
      
      <div className="flex-1 overflow-auto relative">
        {/* Review Toolbar - only shows when multiple edits are pending */}
        {pendingEditCount > 1 && onNavigateEdit && onAcceptAllEdits && onRejectAllEdits && (
          <ReviewToolbar
            pendingCount={pendingEditCount}
            currentIndex={activeEditIndex}
            onNavigate={onNavigateEdit}
            onAcceptAll={onAcceptAllEdits}
            onRejectAll={onRejectAllEdits}
            isMinimized={toolbarMinimized}
            onToggleMinimize={() => setToolbarMinimized(!toolbarMinimized)}
          />
        )}
        
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
