'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import { 
  Sparkles, 
  FileText, 
  CheckCircle, 
  AlertCircle,
  Loader2,
  BookOpen,
  Zap
} from 'lucide-react'
import type { 
  GenerateRequest, 
  LibraryPaper
} from '@/types/simplified'
import { useStreamGeneration, useStartGeneration } from '@/lib/hooks/useStreamGeneration'
import SourceReview from '@/components/SourceReview'

interface PaperGeneratorProps {
  onGenerationComplete?: (projectId: string) => void
  className?: string
}

export default function PaperGenerator({ onGenerationComplete, className }: PaperGeneratorProps) {
  const router = useRouter()
  
  // Form state
  const [topic, setTopic] = useState('')
  const [selectedPapers, setSelectedPapers] = useState<string[]>([])
  const [useLibraryOnly, setUseLibraryOnly] = useState(false)
  const [config, setConfig] = useState<{
    length: 'short' | 'medium' | 'long'
    style: 'academic' | 'review' | 'survey'
    citationStyle: 'apa' | 'mla' | 'chicago' | 'ieee'
    includeMethodology: boolean
  }>({
    length: 'medium',
    style: 'academic',
    citationStyle: 'apa',
    includeMethodology: true
  })
  
  // Generation state - now using SWR hooks (Task 5)
  const { startGeneration, stopGeneration, isStarting, streamUrl } = useStartGeneration()
  
  // Stabilize callbacks to prevent infinite loops
  const handleProgress = useCallback(() => {
    // Progress is handled by the hook state
  }, [])
  
  const handleComplete = useCallback((projectId: string) => {
    onGenerationComplete?.(projectId)
  }, [onGenerationComplete])
  
  const handleError = useCallback((error: string) => {
    console.error('Generation error:', error)
  }, [])
  
  const streamState = useStreamGeneration(streamUrl, {
    onProgress: handleProgress,
    onComplete: handleComplete,
    onError: handleError
  })
  
  // Refs for cleanup
  const intervalRefs = useRef<Set<NodeJS.Timeout>>(new Set())

  useEffect(() => {
    // Cleanup intervals on unmount
    return () => {
      intervalRefs.current.forEach(interval => clearInterval(interval))
    }
  }, [])

  const handlePaperSelection = useCallback((paperId: string, selected: boolean) => {
    setSelectedPapers(prev => 
      selected 
        ? [...prev, paperId]
        : prev.filter(id => id !== paperId)
    )
  }, [])

  const handlePinnedPapersChange = useCallback((pinnedIds: string[]) => {
    setSelectedPapers(pinnedIds)
  }, [])

  const handleGenerate = async () => {
    if (!topic.trim()) return

    const request: GenerateRequest = {
      topic: topic.trim(),
      libraryPaperIds: selectedPapers,
      useLibraryOnly,
      config
    }

    try {
      // Use the new SWR-based generation (Task 5)
      await startGeneration(request)
    } catch (error) {
      console.error('Generation error:', error)
      // Error is handled by the stream state
    }
  }

  const handleViewProject = () => {
    if (streamState.projectId) {
      router.push(`/projects/${streamState.projectId}`)
    }
  }

  const handleStopGeneration = () => {
    stopGeneration()
  }

  // Determine current state
  const isGenerating = streamState.isConnected || isStarting
  const progress = streamState.progress
  const error = streamState.error

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
              disabled={isGenerating}
            />
          </div>

          {/* Paper Settings */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Paper Length</Label>
              <Select 
                value={config.length} 
                onValueChange={(value: 'short' | 'medium' | 'long') => 
                  setConfig(prev => ({ ...prev, length: value }))
                }
                disabled={isGenerating}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="short">Short (3-5 pages)</SelectItem>
                  <SelectItem value="medium">Medium (8-12 pages)</SelectItem>
                  <SelectItem value="long">Long (15-20 pages)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Writing Style</Label>
              <Select 
                value={config.style} 
                onValueChange={(value: 'academic' | 'review' | 'survey') => 
                  setConfig(prev => ({ ...prev, style: value }))
                }
                disabled={isGenerating}
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
                disabled={isGenerating}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="apa">APA</SelectItem>
                  <SelectItem value="mla">MLA</SelectItem>
                  <SelectItem value="chicago">Chicago</SelectItem>
                  <SelectItem value="ieee">IEEE</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="methodology"
              checked={config.includeMethodology}
              onCheckedChange={(checked) => 
                setConfig(prev => ({ ...prev, includeMethodology: checked }))
              }
              disabled={isGenerating}
            />
            <Label htmlFor="methodology">Include Methodology Section</Label>
          </div>

          <Separator />

          {/* Source Selection with SourceReview component (Task 6) */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-medium">Source Selection</h3>
                <p className="text-sm text-muted-foreground">
                  Choose papers from your library to use as sources. Pinned papers will be combined with automatic discovery unless Library Only is enabled.
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="library-only"
                  checked={useLibraryOnly}
                  onCheckedChange={setUseLibraryOnly}
                  disabled={isGenerating}
                />
                <Label htmlFor="library-only">Library Only</Label>
              </div>
            </div>
            
            <SourceReview
              selectedPaperIds={selectedPapers}
              onPaperSelectionChange={handlePaperSelection}
              onPinnedPapersChange={handlePinnedPapersChange}
            />
          </div>

          <Separator />

          {/* Generation Button and Status */}
          <div className="space-y-4">
            {!isGenerating ? (
              <Button 
                onClick={handleGenerate}
                disabled={!topic.trim() || isStarting}
                className="w-full"
                size="lg"
              >
                {isStarting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Starting Generation...
                  </>
                ) : (
                  <>
                    <Zap className="mr-2 h-4 w-4" />
                    Generate Paper
                  </>
                )}
              </Button>
            ) : (
              <div className="space-y-4">
                <Button 
                  onClick={handleStopGeneration}
                  variant="destructive"
                  className="w-full"
                  size="lg"
                >
                  Stop Generation
                </Button>
                
                {progress && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium capitalize">
                        {progress.stage.replace('_', ' ')}
                      </span>
                      <span>{Math.round(progress.progress)}%</span>
                    </div>
                    <Progress value={progress.progress} className="w-full" />
                    <p className="text-sm text-muted-foreground">
                      {progress.message}
                    </p>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">{error}</span>
              </div>
            )}

            {streamState.isComplete && streamState.projectId && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 p-3 bg-green-50 text-green-700 rounded-lg">
                  <CheckCircle className="h-4 w-4" />
                  <span className="text-sm">Paper generated successfully!</span>
                </div>
                <Button 
                  onClick={handleViewProject}
                  className="w-full"
                  size="lg"
                >
                  <FileText className="mr-2 h-4 w-4" />
                  View Generated Paper
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
} 