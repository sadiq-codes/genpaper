'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import { useState, useCallback, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import { 
  FileText, 
  Edit3, 
  Zap, 
  Save,
  Download,
  Eye,
  Sparkles
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import { Citation } from './editor/CitationExtension'
import CitationBubbleMenu from './editor/CitationBubbleMenu'
import ReferenceList from './editor/ReferenceList'
import type { CSLItem } from '@/lib/utils/csl'

// AI Command types
interface AICommand {
  label: string
  description: string
  icon: React.ReactNode
  action: string
}

interface AIProgress {
  isGenerating: boolean
  progress: number
  message: string
}

interface EditorProps {
  className?: string
  initialContent?: string
  documentId?: string
  initialTopic?: string
  onSave?: (content: string) => void
  citations?: Map<string, CSLItem>

}



// AI Slash Commands Configuration
const AI_COMMANDS: AICommand[] = [
  {
    label: '/write',
    description: 'Generate new content section',
    icon: <Edit3 className="h-4 w-4" />,
    action: 'write'
  },
  {
    label: '/rewrite',
    description: 'Rewrite selected text for clarity',
    icon: <Zap className="h-4 w-4" />,
    action: 'rewrite'
  },
  {
    label: '/cite',
    description: 'Search and insert citations',
    icon: <FileText className="h-4 w-4" />,
    action: 'cite'
  },
  {
    label: '/outline',
    description: 'Generate section outline',
    icon: <Sparkles className="h-4 w-4" />,
    action: 'outline'
  }
]

export default function Editor({ 
  className, 
  initialContent = '', 
  documentId,
  initialTopic = '',
  onSave,
  citations = new Map()
}: EditorProps) {
  const [topic, setTopic] = useState(initialTopic)
  const [aiProgress, setAiProgress] = useState<AIProgress>({
    isGenerating: false,
    progress: 0,
    message: ''
  })
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [slashMenuPosition, setSlashMenuPosition] = useState({ x: 0, y: 0 })
  const [pendingAISuggestion, setPendingAISuggestion] = useState<{
    content: string
    range: { from: number, to: number }
  } | null>(null)
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const editorRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Initialize Tiptap editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Configure heading levels
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
        // Enable all basic formatting
        bold: {},
        italic: {},
        strike: {},
        code: {},
        codeBlock: {},
        blockquote: {},
        bulletList: {},
        orderedList: {},
        listItem: {},
        horizontalRule: {},
      }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === 'heading') {
            return 'What\'s the title?'
          }
          return 'Start writing your research paper... Type "/" for AI commands or select text to add citations'
        },
        showOnlyWhenEditable: true,
        showOnlyCurrent: false,
      }),
      CharacterCount,
      Citation,
    ],
    content: initialContent || `
      <h1>Research Paper Title</h1>
      <p>Start writing your paper here. Use slash commands for AI assistance:</p>
      <ul>
        <li><strong>/write</strong> - Generate new content</li>
        <li><strong>/rewrite</strong> - Improve selected text</li>
        <li><strong>/cite</strong> - Add citations</li>
        <li><strong>/outline</strong> - Create section outline</li>
      </ul>
      <h2>Introduction</h2>
      <p>Begin your introduction here...</p>
    `,
    editorProps: {
      attributes: {
        class: 'prose prose-lg max-w-none focus:outline-none min-h-[500px] p-6',
      },
      handleKeyDown: (view, event) => {
        if (event.key === '/') {
          const { selection } = view.state
          const { from } = selection
          
          // Check if the character before the cursor is whitespace or we're at document start
          const charBefore = from > 0 ? view.state.doc.textBetween(from - 1, from) : ' '
          if (from > 0 && !/\s/.test(charBefore)) {
            return false // Don't show menu if we're in the middle of a word
          }
          
          // Get coordinates and adjust for scroll position
          const coords = view.coordsAtPos(from)
          const editorRect = editorRef.current?.getBoundingClientRect()
          
          if (editorRect) {
            setSlashMenuPosition({
              x: coords.left - editorRect.left,
              y: coords.bottom - editorRect.top
            })
          } else {
            setSlashMenuPosition({ x: coords.left, y: coords.bottom })
          }
          
          setShowSlashMenu(true)
          setSelectedCommandIndex(0)
          return false
        }
        
        if (showSlashMenu) {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setSelectedCommandIndex(prev => (prev + 1) % AI_COMMANDS.length)
            return true
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setSelectedCommandIndex(prev => prev === 0 ? AI_COMMANDS.length - 1 : prev - 1)
            return true
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            handleSlashCommand(AI_COMMANDS[selectedCommandIndex].action)
            return true
          }
          if (event.key === 'Escape') {
            setShowSlashMenu(false)
            return true
          }
        }
        
        return false
      },
    },
    onUpdate: ({ editor }) => {
      // Auto-save logic could go here
      const content = editor.getHTML()
      onSave?.(content)
      
      // Hide slash menu if user continues typing
      if (showSlashMenu) {
        const { state } = editor
        const { selection } = state
        const textBefore = state.doc.textBetween(Math.max(0, selection.from - 10), selection.from)
        if (!textBefore.endsWith('/')) {
          setShowSlashMenu(false)
        }
      }
    },
  })



  // Accept AI suggestion
  const acceptAISuggestion = useCallback(() => {
    if (!editor || !pendingAISuggestion) return

    const { content, range } = pendingAISuggestion
    
    // Replace the selected range with AI content
    editor.chain()
      .focus()
      .setTextSelection({ from: range.from, to: range.to })
      .insertContent(content)
      .run()

    setPendingAISuggestion(null)
  }, [editor, pendingAISuggestion])

  // Reject AI suggestion
  const rejectAISuggestion = useCallback(() => {
    setPendingAISuggestion(null)
  }, [])



  // Save document
  const handleSave = useCallback(() => {
    if (!editor) return
    const content = editor.getHTML()
    onSave?.(content)
    // Here you could also save to your blocks table by parsing the HTML
    console.log('Document saved:', content)
  }, [editor, onSave])

  // Export document
  const handleExport = useCallback(() => {
    if (!editor) return
    const content = editor.getHTML()
    const blob = new Blob([content], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'research-paper.html'
    a.click()
    URL.revokeObjectURL(url)
  }, [editor])

  const handleSlashCommand = useCallback(async (command: string) => {
    if (!editor) return
    
    setShowSlashMenu(false)
    
    // Handle cite command differently - trigger citation search
    if (command === 'cite') {
      const { selection } = editor.state
      const { from } = selection
      const coords = editor.view.coordsAtPos(from)
      
      // Trigger citation search via custom event
      const event = new CustomEvent('openCitationSearch', {
        detail: { 
          citationId: null, 
          position: { x: coords.left, y: coords.bottom } 
        }
      })
      window.dispatchEvent(event)
      return
    }
    
    // Abort any existing generation
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    
    // Create new abort controller
    abortControllerRef.current = new AbortController()
    
    setAiProgress({ isGenerating: true, progress: 0, message: `Running ${command} command...` })
    
    const { selection } = editor.state
    const selectedText = editor.state.doc.textBetween(selection.from, selection.to)
    
    try {
      const response = await fetch('/api/generate/unified', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortControllerRef.current.signal,
        body: JSON.stringify({
          command,
          topic: topic.trim(),
          selection: selectedText,
          documentContent: editor.getHTML(),
          documentId,
          cursorPosition: selection.from
        })
      })

      if (!response.ok) throw new Error('Generation failed')
      
      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')
      
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        const chunk = new TextDecoder().decode(value)
        const lines = chunk.split('\n').filter(line => line.trim())
        
        for (const line of lines) {
          try {
            const data = JSON.parse(line)
            
            if (data.type === 'progress') {
              setAiProgress({
                isGenerating: true,
                progress: data.progress,
                message: data.message || 'Processing...'
              })
            } else if (data.type === 'content') {
              setAiProgress({
                isGenerating: true,
                progress: data.progress,
                message: data.message || 'Processing...'
              })
            } else if (data.type === 'complete') {
              setAiProgress({
                isGenerating: false,
                progress: 100,
                message: 'Content generated successfully'
              })
              break
            } else if (data.type === 'error') {
              throw new Error(data.message)
            }
          } catch (parseError) {
            console.warn('Failed to parse chunk:', parseError)
          }
        }
      }
      
    } catch (error: unknown) {
      const errorObj = error as Error
      if (errorObj.name === 'AbortError') {
        console.log('Generation aborted')
      } else {
        console.error('Generation error:', error)
        toast.error('Failed to generate content')
      }
    } finally {
      setAiProgress({ isGenerating: false, progress: 0, message: '' })
      abortControllerRef.current = null
    }
  }, [editor, topic, documentId])

  // Clean up abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  const stats = editor ? {
    words: editor.storage.characterCount.words({ nodeTypes: ['paragraph', 'heading'] }),
    characters: editor.storage.characterCount.characters({ nodeTypes: ['paragraph', 'heading'] })
  } : { words: 0, characters: 0 }

  return (
    <div className={`max-w-6xl mx-auto p-6 space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Research Paper Editor</h1>
          <p className="text-muted-foreground">
            Write naturally and use AI slash commands for assistance
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleSave}>
            <Save className="h-4 w-4 mr-2" />
            Save
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Topic Input */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Research Topic</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Enter your research topic to enable AI commands..."
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="min-h-[60px]"
          />
        </CardContent>
      </Card>

      {/* AI Progress */}
      {aiProgress.isGenerating && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <LoadingSpinner size="sm" />
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">AI Processing</span>
                  <span className="text-sm text-muted-foreground">{aiProgress.progress}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div 
                    className="bg-primary h-2 rounded-full transition-all"
                    style={{ width: `${aiProgress.progress}%` }}
                  />
                </div>
                <p className="text-sm text-muted-foreground mt-1">{aiProgress.message}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Suggestion Approval */}
      {pendingAISuggestion && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-4">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-blue-600" />
                <span className="font-medium text-blue-900">AI Suggestion</span>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={acceptAISuggestion}>
                  Accept
                </Button>
                <Button size="sm" variant="outline" onClick={rejectAISuggestion}>
                  Reject
                </Button>
              </div>
            </div>
            <div className="bg-white rounded border p-3 text-sm">
              <div dangerouslySetInnerHTML={{ __html: pendingAISuggestion.content.replace(/\n/g, '<br/>') }} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Editor */}
      <Card>
        <div className="relative">
          <EditorContent 
            editor={editor} 
            className="min-h-[600px] focus-within:ring-2 focus-within:ring-ring rounded-lg"
          />
          
          {/* Citation Bubble Menu */}
          {editor && <CitationBubbleMenu editor={editor} />}
          
          {/* Slash Command Menu */}
          {showSlashMenu && (
            <div 
              className="absolute z-50 bg-white border rounded-lg shadow-lg p-2 w-64"
              style={{
                left: slashMenuPosition.x,
                top: slashMenuPosition.y + 5
              }}
            >
              <div className="text-sm font-medium text-muted-foreground mb-2 px-2">
                AI Commands
              </div>
              {AI_COMMANDS.map((command, index) => (
                <button
                  key={command.action}
                  className={`w-full flex items-center gap-3 px-2 py-2 text-sm hover:bg-muted rounded text-left ${index === selectedCommandIndex ? 'bg-primary text-primary' : ''}`}
                  onClick={() => handleSlashCommand(command.action)}
                >
                  {command.icon}
                  <div>
                    <div className="font-medium">{command.label}</div>
                    <div className="text-muted-foreground text-xs">{command.description}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Reference List */}
      {editor && (
        <ReferenceList
          content={editor.getHTML()}
          citations={citations}
          onCitationClick={(citationId: string) => {
            // Handle citation click - could open citation editor
            console.log('Citation clicked:', citationId)
          }}
        />
      )}

      {/* Editor Stats */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-1">
          <Eye className="h-4 w-4" />
          Words: {stats.words}
        </div>
        <div className="flex items-center gap-1">
          <FileText className="h-4 w-4" />
          Characters: {stats.characters}
        </div>
        {topic && (
          <Badge variant="secondary" className="ml-auto">
            <Sparkles className="h-3 w-3 mr-1" />
            AI Ready
          </Badge>
        )}
      </div>
    </div>
  )
} 