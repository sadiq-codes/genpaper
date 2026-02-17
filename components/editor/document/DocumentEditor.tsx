'use client'

import { useCallback, useState, useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
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
import { Undo, Redo, ChevronsRight, ChevronsLeft, Bold, Italic, Underline as UnderlineIcon, Strikethrough, List, ListOrdered, Quote, Code, Minus, ChevronDown, Trash2, Plus, Rows3, Columns3 } from 'lucide-react'
import { FloatingToolbar } from './FloatingToolbar'
import { InlineEditBar } from './InlineEditBar'
import { InlineCitationPicker } from './InlineCitationPicker'
import { CitationPopover } from '../CitationPopover'
import { ReviewToolbar } from '../ReviewToolbar'
import { Citation } from '../extensions/Citation'
import { Mathematics } from '../extensions/Mathematics'
import { GhostText } from '../extensions/GhostText'
import { GhostEdit } from '../extensions/GhostEdit'
import { SlashCommands } from '../extensions/SlashCommands'
import { BlockId } from '../extensions/BlockId'
import { ReferencesBlock } from '../extensions/ReferencesBlock'
import { useSmartCompletion } from '../hooks/useSmartCompletion'
import { useReferencesManager } from '../hooks/useReferencesManager'
import { processContent, hasMarkdownFormatting } from '../utils/content-processor'
import { editorToMarkdown } from '../utils/tiptap-to-markdown'
import type { InstanceQuotesMap } from '../utils/markdown-to-tiptap'
import type { Editor } from '@tiptap/react'
import type { ProjectPaper } from '../types'
import { isNumericStyle, clearCaches as clearCitationCaches, resolveStyleId, isStyleAvailable, loadStyle } from '@/lib/citations/local-formatter'
import { toast } from 'sonner'
import { useResearchEditor } from '../research-editor-context'
import { useSubscription } from '@/lib/hooks/use-subscription'
import { getVisibleReferencesCount } from '@/types/subscription'

// Create lowlight instance with common languages
const lowlight = createLowlight(common)

/**
 * Extract all instanceIds from content that uses [@paperId#instanceId] format
 */
function extractInstanceIds(content: string): string[] {
  // instanceId may be non-UUID (alphanumeric with timestamp), so use [^\]]+ to match any chars
  const pattern = /\[@[a-f0-9-]{36}#([^\]]+)\]/gi
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import katex from 'katex'
import { cn } from '@/lib/utils'

interface DocumentEditorProps {
  initialContent?: string
  onUpdate?: (content: string) => void
  onEditorReady?: (editor: Editor) => void
  autocompleteEnabled?: boolean
  onChat: (text: string) => void
  /** Called when a paper's citation metadata is edited (title/authors/year/etc.) */
  onPaperUpdated?: (paperId: string, updates: Partial<ProjectPaper>) => void
}

const DEFAULT_CONTENT = `<h1></h1><p></p>`

export function DocumentEditor({
  initialContent = DEFAULT_CONTENT,
  onUpdate,
  onEditorReady,
  autocompleteEnabled = true,
  onChat,
  onPaperUpdated,
}: DocumentEditorProps) {
  const {
    projectId = '',
    projectTitle: projectTopic = '',
    papers = [],
    citationStyle = 'apa',
    autocompletePrefs,
    pendingEditCount,
    activeEditIndex,
    navigateEdit: onNavigateEdit,
    acceptAllEdits: onAcceptAllEdits,
    rejectAllEdits: onRejectAllEdits,
    mobileMenuOpen,
    toggleSidebar: onToggleMobileMenu,
  } = useResearchEditor()
  const { subscription } = useSubscription()
  // Default to free-tier limit (1) while loading; opens up once subscription confirms paid tier
  const referencesVisible = subscription ? getVisibleReferencesCount(subscription.tier) : 1
  // Ref for debouncing markdown conversion - prevents typing lag in large documents
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  const [mathDialogOpen, setMathDialogOpen] = useState(false)
  const [mathLatex, setMathLatex] = useState('')
  const [mathDisplayMode, setMathDisplayMode] = useState(false)
  const [toolbarMinimized, setToolbarMinimized] = useState(false)

  // Inline edit state
  const [inlineEdit, setInlineEdit] = useState<{
    selectedText: string
    from: number
    to: number
  } | null>(null)

  // Scroll/positioning container for absolute overlays (InlineEditBar, etc.)
  const editorScrollContainerRef = useRef<HTMLDivElement>(null)

  const handleCloseInlineEdit = useCallback(() => {
    setInlineEdit(null)
  }, [])

  // Citation picker state
  const [citationPickerPos, setCitationPickerPos] = useState<number | null>(null)

  const handleCloseCitationPicker = useCallback(() => {
    setCitationPickerPos(null)
  }, [])
  
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
        referencesVisible: referencesVisible,
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
      ReferencesBlock,
    ],
    content: DEFAULT_CONTENT, // Initial empty state - real content set via effect
    editorProps: {
      attributes: {
        class: 'prose prose-lg max-w-5xl mx-auto focus:outline-none min-h-[calc(100vh-200px)] px-4 pt-3 pb-6 sm:px-8 sm:pt-4 sm:pb-8 md:px-12 md:pt-6 lg:px-16 lg:pt-8 lg:pb-12',
      },
    },
    onUpdate: ({ editor }) => {
      // Debounce markdown conversion to prevent typing lag in large documents
      // This avoids blocking the main thread on every keystroke
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }
      debounceTimeoutRef.current = setTimeout(() => {
        const markdown = editorToMarkdown(editor)
        onUpdate?.(markdown)
        debounceTimeoutRef.current = null
      }, 300)
    },
    onCreate: ({ editor }) => {
      onEditorReady?.(editor)
    },
  })

  // Callbacks that depend on editor (must be after useEditor)
  const handleAiEdit = useCallback((text: string) => {
    if (!editor) return
    const { from, to } = editor.state.selection
    setInlineEdit({ selectedText: text, from, to })
  }, [editor])

  const handleOpenCitationPicker = useCallback(() => {
    if (!editor) return
    const { to } = editor.state.selection
    setCitationPickerPos(to)
  }, [editor])

  // Store citation picker callback in editor storage so SlashCommands can call it
  useEffect(() => {
    if (editor) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const storage = (editor.storage as any).slashCommands
      if (storage) storage.onOpenCitationPicker = handleOpenCitationPicker
    }
  }, [editor, handleOpenCitationPicker])

  const handleInsertCitationFromPicker = useCallback((citation: { id: string; authors: string[]; title: string; year: number; journal?: string; doi?: string }) => {
    if (!editor) return
    editor.chain().focus().insertCitation(citation).run()
  }, [editor])

  // Track what we last processed to avoid redundant re-renders
  const [processedKey, setProcessedKey] = useState<string>('')
  const pendingProcessedKeyRef = useRef<string | null>(null)
  
  // Set initial content after editor is created - handles markdown processing
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (!initialContent || initialContent.trim() === '') return
    
    // Skip if we already processed the same content payload.
    // Do not key this by papers, otherwise late paper-sync updates can
    // overwrite in-progress user edits by reapplying initial content.
    const key = `${initialContent.length}:${initialContent.slice(0, 80)}:${initialContent.slice(-80)}`
    if (processedKey === key || pendingProcessedKeyRef.current === key) return
    pendingProcessedKeyRef.current = key
    
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
    
    // Defer content application to a microtask to avoid React lifecycle flush warnings.
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      if (!editor || editor.isDestroyed) {
        if (pendingProcessedKeyRef.current === key) {
          pendingProcessedKeyRef.current = null
        }
        return
      }
      // Skip stale scheduled work if a newer content key superseded this one.
      if (pendingProcessedKeyRef.current !== key) return

      // Set the processed content, then apply citation style to build numbers.
      editor.commands.setContent(processed)
      editor.commands.setCitationStyle(citationStyle)
      setProcessedKey(key)
      pendingProcessedKeyRef.current = null
    })

    return () => {
      cancelled = true
    }
  }, [editor, initialContent, papers, processedKey, processInitialContent, citationStyle])

  // Track previous and latest citation style to avoid stale async style-load races.
  const prevCitationStyleRef = useRef<string | null>(null)
  const latestCitationStyleRef = useRef(citationStyle)
  useEffect(() => {
    latestCitationStyleRef.current = citationStyle
  }, [citationStyle])
  
  // Apply citation style on mount and on style changes.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (prevCitationStyleRef.current === citationStyle) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[DocEditor] citationStyle effect skipped (same as prev): "${citationStyle}"`)
      }
      return
    }
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DocEditor] citationStyle changed: "${prevCitationStyleRef.current}" → "${citationStyle}"`)
    }
    prevCitationStyleRef.current = citationStyle
    
    // Clear cached inline citation text so it regenerates with the new style
    clearCitationCaches()
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DocEditor] Cleared citation caches`)
    }
    
    // Apply the style immediately (uses fallback for non-loaded styles)
    editor.commands.setCitationStyle(citationStyle)
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DocEditor] setCitationStyle command dispatched`)
    }
    
    // Load the CSL style (same-origin endpoint first) if not already available,
    // then re-apply so citations render with the proper style formatting.
    const resolved = resolveStyleId(citationStyle)
    if (!isStyleAvailable(resolved)) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[DocEditor] Style "${resolved}" not loaded yet, fetching async…`)
      }
      loadStyle(resolved)
        .then(success => {
          if (process.env.NODE_ENV === 'development') {
            console.log(
              `[DocEditor] loadStyle("${resolved}") resolved: success=${success}, editorAlive=${!editor.isDestroyed}`
            )
          }
          if (success && editor && !editor.isDestroyed) {
            // Ignore stale completions from older style requests.
            if (resolveStyleId(latestCitationStyleRef.current) !== resolved) {
              if (process.env.NODE_ENV === 'development') {
                console.log(
                  `[DocEditor] Stale style load ignored: loaded="${resolved}", current="${resolveStyleId(latestCitationStyleRef.current)}"`
                )
              }
              return
            }
            clearCitationCaches()
            editor.commands.setCitationStyle(latestCitationStyleRef.current)
            if (process.env.NODE_ENV === 'development') {
              console.log(`[DocEditor] Re-applied style after async load: "${latestCitationStyleRef.current}"`)
            }
          }
        })
        .catch((err) => {
          console.warn(`[DocEditor] loadStyle("${resolved}") failed:`, err)
        })
    } else {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[DocEditor] Style "${resolved}" already loaded`)
      }
    }
  }, [editor, citationStyle])

  // Rebuild numeric citation numbers map when citations are added/removed.
  // Without this, IEEE/Vancouver inline citations can show "[?]" until refresh
  // because numbers are only built when the style is set.
  const prevCitationSignatureRef = useRef<string>('')
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (!isNumericStyle(citationStyle)) return

    const computeSignature = (): string => {
      const ids: string[] = []
      const seen = new Set<string>()
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'citation' && node.attrs?.id) {
          const id = String(node.attrs.id)
          if (!seen.has(id)) {
            seen.add(id)
            ids.push(id)
          }
        }
      })
      return ids.join('|')
    }

    // Initialize signature
    prevCitationSignatureRef.current = computeSignature()

    const handleTransaction = ({ transaction }: { transaction: { docChanged: boolean; getMeta: (key: string) => unknown } }) => {
      if (!transaction.docChanged) return
      const isPaste = transaction.getMeta('paste')
      const nextSig = computeSignature()
      // Always rebuild on paste (pasted citations for existing papers won't change
      // the unique-ID signature but still need numbers assigned)
      if (!isPaste && nextSig === prevCitationSignatureRef.current) return
      prevCitationSignatureRef.current = nextSig
      editor.commands.setCitationStyle(citationStyle)
    }

    editor.on('transaction', handleTransaction)
    return () => {
      editor.off('transaction', handleTransaction)
    }
  }, [editor, citationStyle])
  
  // Sync papers to Citation extension storage
  // This allows CitationNodeView to look up paper metadata at render time,
  // ensuring citations always display correctly even when node.attrs are incomplete
  const prevPapersRef = useRef<ProjectPaper[]>([])
  
  // Fast signature function for paper comparison - avoids expensive JSON.stringify
  const getPaperSignature = useCallback((p: ProjectPaper) => 
    `${p.id}|${p.title}|${p.year}|${p.authors?.join(',') || ''}`, 
    []
  )
  
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    
    // Detect if paper metadata has changed (not just array reference)
    // Uses fast signature comparison instead of JSON.stringify for better performance
    const papersChanged = papers.length !== prevPapersRef.current.length ||
      papers.some((p, i) => {
        const prev = prevPapersRef.current[i]
        if (!prev) return true
        return p.id !== prev.id || 
          p.title !== prev.title || 
          p.year !== prev.year ||
          getPaperSignature(p) !== getPaperSignature(prev)
      })
    
    if (papersChanged) {
      // Clear citation formatter caches so inline text regenerates with new metadata
      clearCitationCaches()
      if (process.env.NODE_ENV === 'development') {
        console.log(`[DocumentEditor] Papers changed, cleared citation caches`)
      }
    }
    
    prevPapersRef.current = papers
    
    // Update Citation extension storage with current papers
    editor.commands.setPapers(papers)
    
    if (process.env.NODE_ENV === 'development' && papers.length > 0) {
      console.log(`[DocumentEditor] Synced ${papers.length} papers to Citation extension storage`)
    }
  }, [editor, papers, getPaperSignature])

  // Sync referencesVisible to Citation extension storage when subscription loads
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.commands.setReferencesVisible(referencesVisible)
  }, [editor, referencesVisible])
  
  // Fetch citation instance quotes after content is loaded
  // This populates citedContent for hover previews
  useEffect(() => {
    if (!editor || editor.isDestroyed || !projectId || !initialContent) return
    if (!processedKey) return // Wait for initial content to be set
    
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
  }, [editor, projectId, initialContent, processedKey])

  // Smart completion hook - ghost text appears seamlessly
  useSmartCompletion({
    editor,
    enabled: autocompleteEnabled,
    papers,
    projectId,
    projectTopic,
    prefs: autocompletePrefs
  })
  
  // References manager - auto-inserts/removes References section based on citations
  useReferencesManager(editor)

  // Note: RAG cache prewarm was removed to save ~4s on page load
  // Cache populates naturally on first autocomplete use

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
          toast.error('Failed to save citation metadata', {
            description: 'The citation is in your document but hover preview may be unavailable.',
            duration: 4000,
          })
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

  // Cleanup debounce timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
        debounceTimeoutRef.current = null
      }
    }
  }, [])

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
        <div className="animate-pulse text-muted-foreground">Loading editor…</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Editor toolbar */}
      <div className="flex items-center border-b border-border/30 shrink-0 sticky top-0 z-10 bg-background">
        {/* Sidebar toggle - pinned outside scroll area */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground ml-1 sm:ml-2"
          onClick={onToggleMobileMenu}
          aria-label={mobileMenuOpen ? "Close sidebar" : "Open sidebar"}
        >
          {mobileMenuOpen ? <ChevronsLeft className="h-3.5 w-3.5" /> : <ChevronsRight className="h-3.5 w-3.5" />}
        </Button>

        {/* Scrollable formatting buttons */}
        <div className="flex items-center justify-end flex-1 gap-0.5 px-1 py-0.5 sm:px-2 sm:py-1 overflow-x-auto scrollbar-none">

        {/* Heading dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 shrink-0 text-muted-foreground hover:text-foreground">
              {editor.isActive('heading', { level: 1 }) ? 'H1' :
               editor.isActive('heading', { level: 2 }) ? 'H2' :
               editor.isActive('heading', { level: 3 }) ? 'H3' : 'P'}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => editor.chain().focus().setParagraph().run()} className={cn(editor.isActive('paragraph') && 'bg-accent')}>
              Paragraph
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} className={cn(editor.isActive('heading', { level: 1 }) && 'bg-accent')}>
              Heading 1
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={cn(editor.isActive('heading', { level: 2 }) && 'bg-accent')}>
              Heading 2
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} className={cn(editor.isActive('heading', { level: 3 }) && 'bg-accent')}>
              Heading 3
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="h-4 mx-0.5" />

        {/* Inline formatting */}
        <Button variant="ghost" size="icon" aria-label="Bold" className={cn("h-7 w-7 shrink-0", editor.isActive('bold') ? "text-foreground bg-accent" : "text-muted-foreground hover:text-foreground")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Italic" className={cn("h-7 w-7 shrink-0", editor.isActive('italic') ? "text-foreground bg-accent" : "text-muted-foreground hover:text-foreground")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Underline" className={cn("h-7 w-7 shrink-0", editor.isActive('underline') ? "text-foreground bg-accent" : "text-muted-foreground hover:text-foreground")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Strikethrough" className={cn("h-7 w-7 shrink-0", editor.isActive('strike') ? "text-foreground bg-accent" : "text-muted-foreground hover:text-foreground")} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough className="h-3.5 w-3.5" />
        </Button>

        <Separator orientation="vertical" className="h-4 mx-0.5" />

        {/* Block formatting */}
        <Button variant="ghost" size="icon" aria-label="Bullet list" className={cn("h-7 w-7 shrink-0", editor.isActive('bulletList') ? "text-foreground bg-accent" : "text-muted-foreground hover:text-foreground")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Numbered list" className={cn("h-7 w-7 shrink-0", editor.isActive('orderedList') ? "text-foreground bg-accent" : "text-muted-foreground hover:text-foreground")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Blockquote" className={cn("h-7 w-7 shrink-0", editor.isActive('blockquote') ? "text-foreground bg-accent" : "text-muted-foreground hover:text-foreground")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Code block" className={cn("h-7 w-7 shrink-0", editor.isActive('codeBlock') ? "text-foreground bg-accent" : "text-muted-foreground hover:text-foreground")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
          <Code className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Horizontal rule" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          <Minus className="h-3.5 w-3.5" />
        </Button>

        <Separator orientation="vertical" className="h-4 mx-0.5" />

        {/* Undo / Redo */}
        <Button variant="ghost" size="icon" aria-label="Undo" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
          <Undo className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Redo" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
          <Redo className="h-3.5 w-3.5" />
        </Button>
        
        
        </div>
      </div>
      
      <div ref={editorScrollContainerRef} className="flex-1 overflow-auto relative">
        {/* Review Toolbar - only shows when multiple edits are pending */}
        {pendingEditCount > 1 && (
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
          onAiEdit={handleAiEdit}
          onInsertCitation={handleOpenCitationPicker}
          onChat={onChat}
        />

        {/* Table Bubble Menu - shows when cursor is inside a table */}
        <BubbleMenu
          editor={editor}
          options={{
            placement: 'top',
          }}
          shouldShow={({ editor: e }) => e.isActive('table')}
          className="flex items-center gap-0.5 p-1 bg-card border border-border rounded-lg shadow-md"
        >
          <Button variant="ghost" size="sm" aria-label="Add row" className="h-7 px-2 text-xs gap-1" onClick={() => editor.chain().focus().addRowAfter().run()}>
            <Rows3 className="h-3 w-3" aria-hidden="true" /> Row
            <Plus className="h-2.5 w-2.5" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" aria-label="Add column" className="h-7 px-2 text-xs gap-1" onClick={() => editor.chain().focus().addColumnAfter().run()}>
            <Columns3 className="h-3 w-3" aria-hidden="true" /> Col
            <Plus className="h-2.5 w-2.5" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" aria-label="Delete row" className="h-7 px-2 text-xs gap-1 text-muted-foreground" onClick={() => editor.chain().focus().deleteRow().run()}>
            <Rows3 className="h-3 w-3" aria-hidden="true" />
            <Minus className="h-2.5 w-2.5" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" aria-label="Delete column" className="h-7 px-2 text-xs gap-1 text-muted-foreground" onClick={() => editor.chain().focus().deleteColumn().run()}>
            <Columns3 className="h-3 w-3" aria-hidden="true" />
            <Minus className="h-2.5 w-2.5" aria-hidden="true" />
          </Button>
          <div className="w-px h-4 bg-border mx-0.5" />
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => editor.chain().focus().deleteTable().run()}>
            <Trash2 className="h-3 w-3" /> Delete
          </Button>
        </BubbleMenu>
        {inlineEdit && (
          <InlineEditBar
            editor={editor}
            projectId={projectId}
            selectedText={inlineEdit.selectedText}
            selectionFrom={inlineEdit.from}
            selectionTo={inlineEdit.to}
            containerRef={editorScrollContainerRef}
            onClose={handleCloseInlineEdit}
          />
        )}
        {citationPickerPos !== null && (
          <InlineCitationPicker
            editor={editor}
            papers={papers}
            selectionTo={citationPickerPos}
            onInsertCitation={handleInsertCitationFromPicker}
            onClose={handleCloseCitationPicker}
          />
        )}
        <EditorContent editor={editor} className="h-full" />
        <CitationPopover
          editor={editor}
          projectId={projectId}
          papers={papers}
          onPaperUpdated={onPaperUpdated}
        />
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
