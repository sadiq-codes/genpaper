'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { 
  BookOpen, 
  Sparkles, 
  Settings, 
  Send, 
  Clock,
  CheckCircle,
  XCircle,
  FileText,
  Loader2,
  Search,
  Plus
} from 'lucide-react'
import type { 
  GenerateRequest, 
  LibraryPaper, 
  GenerationProgress,
  LibraryCollection
} from '@/types/simplified'

interface PaperGeneratorProps {
  onGenerationComplete?: (projectId: string) => void
  className?: string
}

export default function PaperGenerator({ onGenerationComplete, className }: PaperGeneratorProps) {
  const router = useRouter()
  
  // Form state
  const [topic, setTopic] = useState('')
  const [selectedLibraryPapers, setSelectedLibraryPapers] = useState<Set<string>>(new Set())
  const [useLibraryOnly, setUseLibraryOnly] = useState(false)
  const [useStreaming, setUseStreaming] = useState(true)
  
  // Generation config
  const [config, setConfig] = useState({
    length: 'medium' as 'short' | 'medium' | 'long',
    style: 'academic' as 'academic' | 'review' | 'survey',
    citationStyle: 'apa' as 'apa' | 'mla' | 'chicago' | 'ieee',
    includeMethodology: true
  })

  // Library data
  const [libraryPapers, setLibraryPapers] = useState<LibraryPaper[]>([])
  const [collections, setCollections] = useState<LibraryCollection[]>([])
  const [selectedCollection, setSelectedCollection] = useState<string>('')
  const [librarySearch, setLibrarySearch] = useState('')

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null)
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null)
  const [generationError, setGenerationError] = useState<string | null>(null)

  // Refs for cleanup and preventing double loads
  const intervalRefs = useRef<Set<NodeJS.Timeout>>(new Set())
  const hasLoadedRef = useRef(false)

  // Load library data on mount with double-fetch prevention
  useEffect(() => {
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true
      loadLibraryData()
    }
    
    // Cleanup intervals on unmount
    return () => {
      intervalRefs.current.forEach(clearInterval)
      intervalRefs.current.clear()
    }
  }, [])

  const loadLibraryData = async () => {
    try {
      // Load library papers
      const libraryResponse = await fetch('/api/library', { credentials: 'include' })
      if (libraryResponse.ok) {
        const { papers } = await libraryResponse.json()
        setLibraryPapers(papers)
      }

      // Load collections
      const collectionsResponse = await fetch('/api/collections', { credentials: 'include' })
      if (collectionsResponse.ok) {
        const { collections } = await collectionsResponse.json()
        setCollections(collections)
      }
    } catch (error) {
      console.error('Error loading library data:', error)
    }
  }

  const filteredLibraryPapers = libraryPapers.filter(paper => {
    const matchesSearch = !librarySearch || 
      paper.paper.title.toLowerCase().includes(librarySearch.toLowerCase()) ||
      paper.paper.abstract?.toLowerCase().includes(librarySearch.toLowerCase())
    
    // Collection filtering would go here if needed
    return matchesSearch
  })

  const handlePaperSelection = (paperId: string, selected: boolean) => {
    setSelectedLibraryPapers(prev => {
      const newSet = new Set(prev)
      if (selected) {
        newSet.add(paperId)
      } else {
        newSet.delete(paperId)
      }
      return newSet
    })
  }

  const handleGenerate = async () => {
    if (!topic.trim()) return

    setIsGenerating(true)
    setGenerationProgress(null)
    setGenerationError(null)
    setCurrentProjectId(null)

    const request: GenerateRequest = {
      topic: topic.trim(),
      libraryPaperIds: Array.from(selectedLibraryPapers),
      useLibraryOnly,
      config
    }

    try {
      if (useStreaming) {
        await generateWithStreaming(request)
      } else {
        await generateWithPolling(request)
      }
    } catch (error) {
      console.error('Generation error:', error)
      setGenerationError(error instanceof Error ? error.message : 'Generation failed')
      setIsGenerating(false)
    }
  }

  const generateWithStreaming = async (request: GenerateRequest) => {
    const response = await fetch('/api/generate/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(request)
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Error starting generation:', response.status, errorText)
      throw new Error(`Error starting generation: ${response.status} "${errorText}"`)
    }

    const reader = response.body?.getReader()
    const decoder = new TextDecoder()

    if (!reader) {
      throw new Error('No response stream available')
    }

    // Buffer for accumulating partial chunks
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        // Accumulate chunks and process complete lines
        buffer += decoder.decode(value, { stream: true })
        
        let lineEndIndex
        while ((lineEndIndex = buffer.indexOf('\n\n')) !== -1) {
          const line = buffer.slice(0, lineEndIndex)
          buffer = buffer.slice(lineEndIndex + 2)
          
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              
              // Ignore ping messages
              if (data.type === 'ping') continue
              
              if (data.type === 'status' && data.projectId) {
                setCurrentProjectId(data.projectId)
              }
              
              if (data.type === 'progress') {
                setGenerationProgress({
                  stage: data.stage,
                  progress: data.progress,
                  message: data.message,
                  currentVersion: 1
                })
              }
              
              if (data.type === 'complete') {
                setIsGenerating(false)
                setGenerationProgress({
                  stage: 'complete',
                  progress: 100,
                  message: 'Paper generation completed!',
                  currentVersion: 1
                })
                
                if (data.projectId) {
                  setCurrentProjectId(data.projectId)
                  onGenerationComplete?.(data.projectId)
                }
              }
              
              if (data.type === 'error') {
                throw new Error(data.error || 'Generation failed')
              }
            } catch (parseError) {
              // Log parsing errors for debugging but don't break the stream
              console.warn('Failed to parse SSE data:', line, parseError)
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  const generateWithPolling = async (request: GenerateRequest) => {
    // Start generation
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(request)
    })

    if (!response.ok) {
      throw new Error('Failed to start generation')
    }

    const { projectId } = await response.json()
    setCurrentProjectId(projectId)

    // Poll for status with proper cleanup
    const pollInterval = setInterval(async () => {
      try {
        const statusResponse = await fetch(`/api/generate?projectId=${projectId}`, {
          credentials: 'include'
        })
        if (statusResponse.ok) {
          const status = await statusResponse.json()
          
          if (status.status === 'complete') {
            clearInterval(pollInterval)
            intervalRefs.current.delete(pollInterval)
            setIsGenerating(false)
            setGenerationProgress({
              stage: 'complete',
              progress: 100,
              message: 'Paper generation completed!',
              currentVersion: 1
            })
            onGenerationComplete?.(projectId)
          } else if (status.status === 'failed') {
            clearInterval(pollInterval)
            intervalRefs.current.delete(pollInterval)
            throw new Error('Generation failed')
          }
        }
      } catch (error) {
        clearInterval(pollInterval)
        intervalRefs.current.delete(pollInterval)
        throw error
      }
    }, 2000)
    
    intervalRefs.current.add(pollInterval)

    // Simulate progress for polling mode with cleanup
    let progress = 0
    const progressInterval = setInterval(() => {
      if (progress < 90) {
        progress += Math.random() * 10
        setGenerationProgress({
          stage: 'writing',
          progress: Math.min(progress, 90),
          message: 'Generating paper...',
          currentVersion: 1
        })
      }
    }, 1000)
    
    intervalRefs.current.add(progressInterval)

    // Clean up progress simulation after 30s
    setTimeout(() => {
      clearInterval(progressInterval)
      intervalRefs.current.delete(progressInterval)
    }, 30000)
  }

  const handleViewProject = () => {
    if (currentProjectId) {
      router.push(`/projects/${currentProjectId}`)
    }
  }

  return (
    <div className={`max-w-4xl mx-auto p-6 space-y-6 ${className}`}>
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Generate Research Paper</h1>
        <p className="text-muted-foreground">
          Enter your research topic and let AI create a comprehensive paper with citations
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Paper Generation
          </CardTitle>
          <CardDescription>
            Configure your research paper generation settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Topic Input */}
          <div className="space-y-2">
            <Label htmlFor="topic">Research Topic *</Label>
            <Textarea
              id="topic"
              placeholder="Enter your research topic or question (e.g., 'The impact of artificial intelligence on healthcare diagnostics')"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>

          <Tabs defaultValue="config" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="config">
                <Settings className="h-4 w-4 mr-2" />
                Configuration
              </TabsTrigger>
              <TabsTrigger value="library">
                <BookOpen className="h-4 w-4 mr-2" />
                Library Papers
              </TabsTrigger>
              <TabsTrigger value="advanced">
                <Settings className="h-4 w-4 mr-2" />
                Advanced
              </TabsTrigger>
            </TabsList>

            <TabsContent value="config" className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Paper Length</Label>
                  <Select 
                    value={config.length} 
                    onValueChange={(value: 'short' | 'medium' | 'long') => 
                      setConfig(prev => ({ ...prev, length: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="short">Short (~1,000 words)</SelectItem>
                      <SelectItem value="medium">Medium (~2,000 words)</SelectItem>
                      <SelectItem value="long">Long (~4,000+ words)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Paper Style</Label>
                  <Select 
                    value={config.style} 
                    onValueChange={(value: 'academic' | 'review' | 'survey') => 
                      setConfig(prev => ({ ...prev, style: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="academic">Academic Paper</SelectItem>
                      <SelectItem value="review">Literature Review</SelectItem>
                      <SelectItem value="survey">Survey Paper</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Citation Style</Label>
                  <Select 
                    value={config.citationStyle} 
                    onValueChange={(value: 'apa' | 'mla' | 'chicago' | 'ieee') => 
                      setConfig(prev => ({ ...prev, citationStyle: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="apa">APA Style</SelectItem>
                      <SelectItem value="mla">MLA Style</SelectItem>
                      <SelectItem value="chicago">Chicago Style</SelectItem>
                      <SelectItem value="ieee">IEEE Style</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Include Methodology</Label>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="methodology"
                      checked={config.includeMethodology}
                      onCheckedChange={(checked) => 
                        setConfig(prev => ({ ...prev, includeMethodology: !!checked }))
                      }
                    />
                    <Label htmlFor="methodology" className="text-sm">
                      Include methodology section
                    </Label>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="library" className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h3 className="text-sm font-medium">Select Papers from Library</h3>
                  <p className="text-xs text-muted-foreground">
                    Choose specific papers to include in your research
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="library-only"
                    checked={useLibraryOnly}
                    onCheckedChange={(checked) => setUseLibraryOnly(!!checked)}
                  />
                  <Label htmlFor="library-only" className="text-sm">
                    Library only
                  </Label>
                </div>
              </div>

              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search library papers..."
                    value={librarySearch}
                    onChange={(e) => setLibrarySearch(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto">
                {filteredLibraryPapers.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No papers in your library</p>
                    <Button variant="outline" size="sm" className="mt-2">
                      <Plus className="h-4 w-4 mr-2" />
                      Add Papers
                    </Button>
                  </div>
                ) : (
                  filteredLibraryPapers.map((libraryPaper) => (
                    <div key={libraryPaper.id} className="flex items-start space-x-3 p-3 border rounded-lg">
                      <Checkbox
                        id={libraryPaper.id}
                        checked={selectedLibraryPapers.has(libraryPaper.paper.id)}
                        onCheckedChange={(checked) => 
                          handlePaperSelection(libraryPaper.paper.id, !!checked)
                        }
                      />
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium truncate">
                          {libraryPaper.paper.title}
                        </h4>
                        <p className="text-xs text-muted-foreground">
                          {libraryPaper.paper.authors?.map(a => a.name).join(', ')}
                        </p>
                        {libraryPaper.paper.venue && (
                          <Badge variant="secondary" className="mt-1">
                            {libraryPaper.paper.venue}
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {selectedLibraryPapers.size > 0 && (
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-sm">
                    <strong>{selectedLibraryPapers.size}</strong> papers selected from library
                  </p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="advanced" className="space-y-4">
              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="streaming"
                    checked={useStreaming}
                    onCheckedChange={(checked) => setUseStreaming(!!checked)}
                  />
                  <Label htmlFor="streaming" className="text-sm">
                    Real-time streaming (recommended)
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Enable real-time updates during paper generation for better user experience
                </p>
              </div>
            </TabsContent>
          </Tabs>

          <Separator />

          {/* Generation Status */}
          {(isGenerating || generationProgress) && (
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    {isGenerating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : generationProgress?.stage === 'complete' ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    <span className="font-medium">
                      {generationProgress?.message || 'Starting generation...'}
                    </span>
                  </div>
                  
                  {generationProgress && (
                    <div className="space-y-2">
                      <Progress value={generationProgress.progress} className="h-2" />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Stage: {generationProgress.stage}</span>
                        <span>{Math.round(generationProgress.progress)}%</span>
                      </div>
                    </div>
                  )}

                  {generationProgress?.stage === 'complete' && currentProjectId && (
                    <Button onClick={handleViewProject} className="w-full">
                      <FileText className="h-4 w-4 mr-2" />
                      View Generated Paper
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Error Display */}
          {generationError && (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-red-700">
                  <XCircle className="h-4 w-4" />
                  <span className="font-medium">Generation Failed</span>
                </div>
                <p className="text-sm text-red-600 mt-1">{generationError}</p>
              </CardContent>
            </Card>
          )}

          {/* Generate Button */}
          <Button 
            onClick={handleGenerate} 
            disabled={!topic.trim() || isGenerating}
            className="w-full"
            size="lg"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating Paper...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Generate Research Paper
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
} 