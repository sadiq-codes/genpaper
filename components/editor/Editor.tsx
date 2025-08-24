'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { EditorState } from '@codemirror/state'
import { EditorView, minimalSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { Sparkles, Play, Save, Edit3, Zap } from 'lucide-react'
import { toast } from 'sonner'

interface ProjectData {
  id: string
  topic: string
  status: string
  generation_config?: {
    paperType?: string
    length?: string
    library_papers_used?: string[]
  }
  content?: string
}

// Clean generation artifacts (e.g., tool-call lines) before rendering
function cleanGeneratedContent(text: string): string {
  if (!text) return text
  // Remove standalone addCitation(...) lines (from tool calls)
  const cleaned = text
    .split(/\r?\n/)
    .filter(line => !/^\s*addCitation\s*\(/i.test(line.trim()))
    .join('\n')
    // Collapse 3+ blank lines to at most 2
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return cleaned
}

// Replace addCitation(...) lines by appending formatted inline citations to the preceding paragraph
async function processCitationsInline(
  projectId: string,
  text: string,
  style: 'apa' | 'mla' | 'chicago' | 'ieee'
): Promise<string> {
  const lines = text.split(/\r?\n/)
  const addCiteRegex = /^\s*addCitation\s*\(\s*paper_id\s*=\s*"([a-f0-9-]{36})"/i
  const paperIds: string[] = []
  for (const line of lines) {
    const m = line.match(addCiteRegex)
    if (m && m[1]) paperIds.push(m[1])
  }
  if (paperIds.length === 0) {
    return cleanGeneratedContent(text)
  }
  try {
    const res = await fetch('/api/citations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, refs: paperIds.map((id) => ({ type: 'paperId', value: id })), style })
    })
    if (!res.ok) throw new Error('citation resolve failed')
    const data = await res.json()
    const map: Record<string, string> = data?.citeKeyMap || {}
    const out: string[] = []
    let lastContentIndex = -1
    for (const line of lines) {
      const trimmed = line.trim()
      const m = trimmed.match(addCiteRegex)
      if (m && m[1]) {
        const formatted = map[`paperId:${m[1]}`] || ''
        if (formatted && lastContentIndex >= 0) {
          out[lastContentIndex] = `${out[lastContentIndex]} ${formatted}`
        }
      } else {
        out.push(line)
        if (trimmed.length > 0) lastContentIndex = out.length - 1
      }
    }
    return cleanGeneratedContent(out.join('\n'))
  } catch {
    return cleanGeneratedContent(text)
  }
}

export function Editor() {
  const params = useParams()
  const projectId = params.id as string
  const searchParams = useSearchParams()
  
  const [project, setProject] = useState<ProjectData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Unified editor state
  const [content, setContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationProgress, setGenerationProgress] = useState(0)
  const [citationStyle, setCitationStyle] = useState<'apa' | 'mla' | 'chicago' | 'ieee'>('apa')
  const rawContentRef = useRef<string>('')
  
  // EventSource reference for cleanup
  const eventSourceRef = useRef<EventSource | null>(null)
  const isStreamingRef = useRef(false)
  const hasStartedRef = useRef(false)
  
  // CodeMirror integration
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [editorReady, setEditorReady] = useState(false)

  // Load project data
  const loadProject = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/projects/${projectId}`)
      const data = await response.json()
      
      if (!response.ok) throw new Error(data.error || 'Failed to load project')
      
      const normalizedProject = {
        id: data.id,
        topic: data.topic,
        status: data.status,
        generation_config: data.generation_config,
        content: data.content
      }

      setProject(normalizedProject)
      const initial = normalizedProject.content || `# ${normalizedProject.topic}\n\nYour AI-generated research paper will appear here...`
      rawContentRef.current = initial
      const processed = await processCitationsInline(projectId, initial, citationStyle)
      setContent(processed)
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project')
    } finally {
      setLoading(false)
    }
  }, [projectId, citationStyle])

  // Show toast on first load if created
  useEffect(() => {
    const created = searchParams?.get('created')
    if (created === '1') {
      toast.success('Project created!')
    }
  }, [searchParams])

  // Initialize CodeMirror editor
  useEffect(() => {
    if (!editorRef.current || !project) return

    const initEditor = async () => {
      try {
        const state = EditorState.create({
          doc: content,
          extensions: [
            minimalSetup,
            markdown(),
          ],
        })

        viewRef.current = new EditorView({
          state,
          parent: editorRef.current!,
          dispatch: (tr) => {
            viewRef.current?.update([tr])
            if (tr.docChanged) {
              setContent(viewRef.current?.state.doc.toString() || '')
            }
          }
        })

        setEditorReady(true)
      } catch (err) {
        console.error('Failed to initialize editor:', err)
        setError('Failed to initialize editor')
      }
    }

    initEditor()

    return () => {
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, [project, content])

  // Integrated generation handler
  const handleStartGeneration = useCallback(async () => {
    if (!project) return
    if (isStreamingRef.current) return
    
    // Close any existing EventSource
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    
    setIsGenerating(true)
    isStreamingRef.current = true
    hasStartedRef.current = true
    setGenerationProgress(0)
    
    try {
      const params = new URLSearchParams({
        topic: project.topic,
        paperType: project.generation_config?.paperType || 'researchArticle',
        length: project.generation_config?.length || 'medium',
        projectId: project.id
      })
      
      const eventSource = new EventSource(`/api/generate?${params}`)
      eventSourceRef.current = eventSource
      console.log('🔌 EventSource created for:', `/api/generate?${params}`)
      
      eventSource.onopen = () => {
        console.log('✅ EventSource connection established')
      }
      
      eventSource.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data)
          console.log('📊 SSE event received:', data)
          
          if (data.type === 'progress') {
            console.log('📈 Progress update:', data.progress, data.message)
            setGenerationProgress(data.progress || 0)
            if (data.message) {
              toast.info(data.message)
            }
          } else if (data.type === 'complete') {
            // Handle full content from generation completion
            if (data.content) {
              rawContentRef.current = data.content
              const processed = await processCitationsInline(project.id, data.content, citationStyle)
              setContent(processed)
              if (viewRef.current) {
                const transaction = viewRef.current.state.update({
                  changes: { from: 0, to: viewRef.current.state.doc.length, insert: processed }
                })
                viewRef.current.dispatch(transaction)
              }
            }
            setIsGenerating(false)
            isStreamingRef.current = false
            toast.success('Generation completed!')
            eventSource.close()
            eventSourceRef.current = null
            loadProject()
          } else if (data.type === 'error') {
            if (data.error === 'GENERATION_IN_PROGRESS') {
              toast.warning('Generation is already in progress. Please wait.')
            } else {
              toast.error(data.error || 'Generation failed')
            }
            setIsGenerating(false)
            isStreamingRef.current = false
            eventSource.close()
            eventSourceRef.current = null
          }
        } catch (parseError) {
          console.error('Failed to parse SSE data:', parseError)
          toast.error('Received invalid data from server')
        }
      }
      
      eventSource.onerror = (event) => {
        console.error('❌ EventSource error:', event)
        console.error('EventSource state:', eventSource.readyState)
        console.error('EventSource URL:', eventSource.url)
        
        setIsGenerating(false)
        isStreamingRef.current = false
        toast.error('Connection failed. Please try again.')
        eventSource.close()
        eventSourceRef.current = null
      }
      
    } catch (err) {
      console.error('Generation failed:', err)
      toast.error('Generation failed')
      setIsGenerating(false)
      isStreamingRef.current = false
    }
  }, [project, loadProject, citationStyle])

  // Save content handler
  const handleSave = useCallback(async () => {
    if (!project || isSaving) return
    
    setIsSaving(true)
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      })
      
      if (response.ok) {
        toast.success('Content saved!')
      } else {
        throw new Error('Failed to save')
      }
    } catch (error) {
      console.error('Save failed:', error)
      toast.error('Failed to save content')
    } finally {
      setIsSaving(false)
    }
  }, [project, content, isSaving])

  // Simple AI commands
  const handleAICommand = useCallback(async (action: 'rewrite' | 'expand') => {
    if (!viewRef.current) return
    
    const selection = viewRef.current.state.selection.main
    const selectedText = viewRef.current.state.doc.sliceString(selection.from, selection.to)
    
    if (!selectedText) {
      toast.error('Please select some text first')
      return
    }
    
    try {
      const response = await fetch('/api/edits/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: projectId,
          prompt: `${action}: ${selectedText}`,
          selection: { start: selection.from, end: selection.to }
        })
      })
      
      if (response.ok) {
        const result = await response.json()
        // Apply the edit result
        const transaction = viewRef.current.state.update({
          changes: { from: selection.from, to: selection.to, insert: result.newText }
        })
        viewRef.current.dispatch(transaction)
        toast.success(`${action} completed!`)
      }
    } catch (error) {
      console.error('AI command failed:', error)
      toast.error(`${action} failed`)
    }
  }, [projectId])

  // Load project on mount
  useEffect(() => {
    if (projectId) {
      loadProject()
    }
  }, [projectId, loadProject])
  
  // Cleanup EventSource on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      isStreamingRef.current = false
    }
  }, [])

  // Auto-start generation for new projects
  useEffect(() => {
    if (project && project.status === 'generating' && !project.content && !isStreamingRef.current && !hasStartedRef.current) {
      setTimeout(() => {
        handleStartGeneration()
      }, 500)
    }
  }, [project, handleStartGeneration])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground">Loading project...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Card className="w-96">
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">{error}</p>
            <Button onClick={loadProject} variant="outline" className="w-full">
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">Project not found</p>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Generation Progress Overlay */}
      {isGenerating && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 flex items-center justify-center">
          <Card className="w-96 shadow-xl">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Sparkles className="h-6 w-6 text-primary animate-pulse" />
              </div>
              <CardTitle>Generating Research Paper</CardTitle>
              <div className="flex items-center justify-between text-xs text-muted-foreground mt-2">
                <span>Progress</span>
                <span>{Math.round(generationProgress)}%</span>
              </div>
              <Progress value={generationProgress} className="mt-2" />
              {/* Debug info */}
              <div className="text-xs text-muted-foreground mt-1">
                Debug: {generationProgress}% | {isGenerating ? 'Generating' : 'Not generating'}
              </div>
            </CardHeader>
          </Card>
        </div>
      )}

      {/* Main Editor Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="border-b bg-background p-3 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <h1 className="font-semibold truncate">{project?.topic || 'Untitled Project'}</h1>
            {project?.status === 'draft' && !isGenerating && (
              <Button
                onClick={handleStartGeneration}
                size="sm"
                className="gap-2"
              >
                <Play className="h-3 w-3" />
                Generate
              </Button>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <Select
              value={citationStyle}
              onValueChange={async (v) => {
                const val = v as 'apa' | 'mla' | 'chicago' | 'ieee'
                setCitationStyle(val)
                if (project && rawContentRef.current) {
                  const processed = await processCitationsInline(project.id, rawContentRef.current, val)
                  setContent(processed)
                  if (viewRef.current) {
                    const tr = viewRef.current.state.update({ changes: { from: 0, to: viewRef.current.state.doc.length, insert: processed } })
                    viewRef.current.dispatch(tr)
                  }
                }
              }}
            >
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Citation Style" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="apa">APA</SelectItem>
                <SelectItem value="chicago">Chicago</SelectItem>
                <SelectItem value="mla">MLA</SelectItem>
                <SelectItem value="ieee">IEEE</SelectItem>
              </SelectContent>
            </Select>
            {/* Simple AI Commands */}
            {editorReady && (
              <>
                <Button
                  onClick={() => handleAICommand('rewrite')}
                  size="sm"
                  variant="outline"
                  className="gap-1"
                >
                  <Edit3 className="h-3 w-3" />
                  Rewrite
                </Button>
                <Button
                  onClick={() => handleAICommand('expand')}
                  size="sm"
                  variant="outline"
                  className="gap-1"
                >
                  <Zap className="h-3 w-3" />
                  Expand
                </Button>
              </>
            )}
            
            <Button
              onClick={handleSave}
              disabled={isSaving}
              size="sm"
              variant="outline"
              className="gap-2"
            >
              <Save className="h-3 w-3" />
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>

        {/* CodeMirror Editor */}
        <div className="flex-1 relative">
          <div 
            ref={editorRef} 
            className="absolute inset-0 overflow-hidden"
          />
        </div>
      </div>
    </div>
  )
}
