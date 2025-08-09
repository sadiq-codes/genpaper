'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { useStartGeneration, useStreamGeneration } from '@/lib/hooks/useStreamGeneration'
import Editor from './Editor'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Sparkles, Play, Square, CheckCircle, Target, Zap } from 'lucide-react'
import { toast } from 'sonner'

interface ProjectData {
  id: string
  topic: string
  status: string
  generation_config?: {
    paper_settings?: {
      paperType?: string
      length?: string
    }
    library_papers_used?: string[]
  }
  content?: string
}

export function ProjectEditor() {
  const params = useParams()
  const projectId = params.id as string
  
  const [project, setProject] = useState<ProjectData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Generation hooks
  const { startGeneration, stopGeneration, isStarting, streamUrl } = useStartGeneration()

  // Load project data
  const loadProject = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/projects/${projectId}`)
      
      if (!response.ok) {
        throw new Error('Failed to load project')
      }
      
      const data = await response.json()
      // Normalize API payload shape
      const normalizedProject: ProjectData | null = data?.project
        ? data.project
        : (data && typeof data === 'object' && 'id' in data ? (data as ProjectData) : null)

      if (!normalizedProject) {
        throw new Error('Invalid project payload')
      }

      setProject(normalizedProject)
      
      // Auto-start generation for new projects (status 'generating' and no content)
      if (normalizedProject.status === 'generating' && !normalizedProject.content) {
        // Small delay to show the workspace has loaded, then start generation
        setTimeout(() => {
          handleStartGeneration()
        }, 500)
      }
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const handleStreamComplete = useCallback((id: string) => {
    toast.success('Paper generation completed!')
    loadProject()
  }, [loadProject])

  const handleStreamError = useCallback((err: string) => {
    toast.error(`Generation failed: ${err}`)
  }, [])

  const { progress, isConnected, isComplete, projectId: streamProjectId } = useStreamGeneration(
    streamUrl,
    {
      onComplete: handleStreamComplete,
      onError: handleStreamError
    }
  )

  // Handle generation start
  const handleStartGeneration = async () => {
    if (!project) return
    
    try {
      await startGeneration({
        topic: project.topic,
        config: {
          paperType: (project.generation_config?.paper_settings?.paperType as 'researchArticle' | 'literatureReview' | 'capstoneProject' | 'mastersThesis' | 'phdDissertation') || 'researchArticle',
          length: (project.generation_config?.paper_settings?.length as 'short' | 'medium' | 'long') || 'medium'
        },
        libraryPaperIds: project.generation_config?.library_papers_used || [],
        useLibraryOnly: false
      })
    } catch (err) {
      toast.error('Failed to start generation')
    }
  }

  // Load project on mount
  useEffect(() => {
    if (projectId) {
      loadProject()
    }
  }, [projectId, loadProject])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-background to-muted/20">
        <div className="text-center space-y-6 max-w-md mx-auto p-8">
          <div className="relative">
            <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-primary mx-auto"></div>
            <Sparkles className="absolute inset-0 m-auto h-6 w-6 text-primary/60 animate-pulse" />
          </div>
          <div className="space-y-3">
            <h3 className="text-xl font-semibold">Setting up your workspace</h3>
            <p className="text-muted-foreground">Loading project and preparing AI generation...</p>
          </div>
          <div className="w-80 mx-auto space-y-2">
            <Progress value={75} className="h-3" />
            <p className="text-xs text-muted-foreground">Almost ready...</p>
          </div>
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
    <div className="h-screen flex flex-col">
      {/* Generation Progress - Your seamless approach */}
      {(isConnected || progress || isStarting) && (
        <div className="border-b bg-gradient-to-r from-primary/10 to-purple-500/10 p-6" role="status" aria-live="polite" aria-atomic="true">
          <div className="max-w-2xl mx-auto space-y-4">
            {/* Progress Bar */}
            <div className="space-y-2">
              <Progress 
                value={progress?.progress || (isStarting ? 5 : 0)} 
                className="h-3 bg-background"
                aria-valuemin={0}
                aria-valuemax={100}
              />
              <div className="flex justify-between text-sm">
                <span className="font-medium">
                  {isStarting 
                    ? 'Initializing AI generation pipeline...' 
                    : progress?.message || 'Preparing generation...'
                  }
                </span>
                <span className="text-muted-foreground">
                  {progress?.progress || (isStarting ? 5 : 0)}%
                </span>
              </div>
            </div>

            {/* Step Progress - Like your example */}
            <div className="flex justify-center gap-8">
              <GenerationStep 
                label="Project" 
                active={(progress?.progress ?? 0) > 0 && (progress?.progress ?? 0) < 30} 
                done={(progress?.progress ?? 0) >= 25} 
              />
              <GenerationStep 
                label="Generate" 
                active={(progress?.progress ?? 0) >= 30 && (progress?.progress ?? 0) < 100} 
                done={(progress?.progress ?? 0) >= 95} 
              />
              <GenerationStep 
                label="Edit" 
                active={(progress?.progress ?? 0) === 100} 
                done={(progress?.progress ?? 0) === 100} 
              />
            </div>

            {/* Stop Button */}
            {isConnected && !isComplete && (
              <div className="flex justify-center">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={stopGeneration}
                  className="gap-2 hover:bg-destructive/10"
                >
                  <Square className="h-3 w-3" />
                  Stop Generation
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Generation Controls */}
      {!isConnected && !progress && project?.status !== 'completed' && (
        <div className="border-b bg-background p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">Ready to Generate</h3>
              <p className="text-sm text-muted-foreground">
                Topic: {project.topic}
              </p>
            </div>
            <Button
              onClick={handleStartGeneration}
              disabled={isStarting}
              className="gap-2"
            >
              <Play className="h-4 w-4" />
              {isStarting ? 'Starting...' : 'Generate Paper'}
            </Button>
          </div>
        </div>
      )}

      {/* Editor */}
      <div className="flex-1">
        <Editor 
          documentId={projectId}
          className="h-full"
          initialTopic={project.topic}
          initialContent={project.content || '# ' + project.topic + '\n\nYour AI-generated research paper will appear here...'}
        />
      </div>
    </div>
  )
}

// Generation Step Component - Like your example
function GenerationStep({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  const color = active ? 'text-primary' : done ? 'text-green-600' : 'text-muted-foreground'
  const bg = done ? 'bg-green-100' : active ? 'bg-primary/10' : 'bg-muted'
  const Icon = done ? CheckCircle : active ? Zap : Target
  
  return (
    <div className={`flex flex-col items-center gap-2 ${color}`}>
      <div className={`flex h-8 w-8 items-center justify-center rounded-full ${bg}`}>
        <Icon className="h-4 w-4" />
      </div>
      <span className="text-xs font-medium">{label}</span>
    </div>
  )
}