'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { 
  Loader2, 
  Search, 
  FileText, 
  BookOpen, 
  Sparkles, 
  CheckCircle2,
  XCircle,
  AlertCircle,
  X
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface GenerationProgressProps {
  projectId: string
  topic: string
  paperType?: 'researchArticle' | 'literatureReview' | 'capstoneProject' | 'mastersThesis' | 'phdDissertation'
  onComplete: (content: string) => void
  onError: (error: string) => void
  onCancel?: () => void
}

interface ProgressStage {
  id: string
  label: string
  icon: React.ReactNode
  status: 'pending' | 'active' | 'complete' | 'error'
  message?: string
  data?: Record<string, unknown>
}

const STAGE_CONFIG: Record<string, { label: string; icon: React.ReactNode }> = {
  start: { label: 'Initializing', icon: <Loader2 className="h-4 w-4" /> },
  initialization: { label: 'Initializing', icon: <Loader2 className="h-4 w-4" /> },
  search: { label: 'Finding Sources', icon: <Search className="h-4 w-4" /> },
  outline: { label: 'Creating Outline', icon: <FileText className="h-4 w-4" /> },
  context: { label: 'Building Context', icon: <BookOpen className="h-4 w-4" /> },
  generation: { label: 'Writing Sections', icon: <Sparkles className="h-4 w-4" /> },
  quality: { label: 'Quality Review', icon: <CheckCircle2 className="h-4 w-4" /> },
  saving: { label: 'Saving', icon: <Loader2 className="h-4 w-4" /> },
  complete: { label: 'Complete', icon: <CheckCircle2 className="h-4 w-4" /> },
}

const ORDERED_STAGES = ['search', 'outline', 'context', 'generation', 'quality', 'saving']

export function GenerationProgress({
  projectId,
  topic,
  paperType = 'literatureReview',
  onComplete,
  onError,
  onCancel
}: GenerationProgressProps) {
  console.log('🎬 GenerationProgress component mounted/rendered for project:', projectId, 'paperType:', paperType)
  
  const [progress, setProgress] = useState(0)
  const [_currentStage, setCurrentStage] = useState<string>('start')
  const [message, setMessage] = useState('Starting paper generation...')
  const [stages, setStages] = useState<ProgressStage[]>(
    ORDERED_STAGES.map(id => ({
      id,
      label: STAGE_CONFIG[id]?.label || id,
      icon: STAGE_CONFIG[id]?.icon || <Loader2 className="h-4 w-4" />,
      status: 'pending'
    }))
  )
  const [error, setError] = useState<string | null>(null)
  const [papersFound, setPapersFound] = useState<number>(0)
  const [currentSection, setCurrentSection] = useState<string | null>(null)
  const [sectionsCompleted, setSectionsCompleted] = useState(0)
  const [totalSections, setTotalSections] = useState(0)
  
  const eventSourceRef = useRef<EventSource | null>(null)
  const hasCompletedRef = useRef(false)
  const connectionIdRef = useRef<string | null>(null) // Track which projectId we connected for

  // Update stage statuses based on current stage
  const updateStageStatuses = useCallback((activeStage: string) => {
    setStages(prevStages => {
      const activeIndex = ORDERED_STAGES.indexOf(activeStage)
      return prevStages.map((stage, index) => {
        if (index < activeIndex) {
          return { ...stage, status: 'complete' as const }
        } else if (index === activeIndex) {
          return { ...stage, status: 'active' as const }
        }
        return { ...stage, status: 'pending' as const }
      })
    })
  }, [])

  useEffect(() => {
    // Prevent duplicate connections for the same project
    // But allow new connections if projectId changes
    if (hasCompletedRef.current) {
      console.log('⏭️ Skipping EventSource - generation already completed')
      return
    }
    if (connectionIdRef.current === projectId) {
      console.log('⏭️ Skipping EventSource - already connected for project:', projectId)
      return
    }
    
    // Close any existing connection before starting new one
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    
    connectionIdRef.current = projectId

    // Build URL for EventSource
    const params = new URLSearchParams({
      topic,
      projectId,
      length: 'medium',
      paperType
    })
    
    console.log('🚀 Starting EventSource connection for project:', projectId)
    console.log('🔗 EventSource URL:', `/api/generate?${params.toString()}`)
    const eventSource = new EventSource(`/api/generate?${params.toString()}`)
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      console.log('✅ EventSource connection opened for project:', projectId)
    }

    eventSource.onmessage = (event) => {
      try {
        console.log('📨 SSE message received:', event.data.slice(0, 100))
        const data = JSON.parse(event.data)
        
        switch (data.type) {
          case 'progress':
            setProgress(data.progress || 0)
            setCurrentStage(data.stage)
            setMessage(data.message || '')
            updateStageStatuses(data.stage)
            
            // Extract additional data
            if (data.data?.papersFound) {
              setPapersFound(data.data.papersFound)
            }
            if (data.data?.sectionCount) {
              setTotalSections(data.data.sectionCount)
            }
            
            // Parse section info from message
            const sectionMatch = data.message?.match(/Generating (\w+(?:\s+\w+)*) \((\d+)\/(\d+)\)/)
            if (sectionMatch) {
              setCurrentSection(sectionMatch[1])
              setSectionsCompleted(parseInt(sectionMatch[2]) - 1)
              setTotalSections(parseInt(sectionMatch[3]))
            }
            break
            
          case 'complete':
            hasCompletedRef.current = true
            setProgress(100)
            setCurrentStage('complete')
            setMessage('Paper generated successfully!')
            setStages(prev => prev.map(s => ({ ...s, status: 'complete' as const })))
            
            // Small delay to show completion state before transitioning
            setTimeout(() => {
              onComplete(data.content)
            }, 500)
            break
            
          case 'error':
            hasCompletedRef.current = true
            setError(data.error)
            setStages(prev => prev.map(s => 
              s.status === 'active' ? { ...s, status: 'error' as const } : s
            ))
            onError(data.error)
            break
        }
      } catch (err) {
        console.error('Failed to parse SSE message:', err)
      }
    }

    eventSource.onerror = (err) => {
      console.error('❌ EventSource error for project:', projectId, err)
      if (!hasCompletedRef.current) {
        setError('Connection lost. Please refresh and try again.')
        onError('Connection lost')
      }
      eventSource.close()
    }

    return () => {
      console.log('🔌 Closing EventSource connection for project:', projectId)
      eventSource.close()
      eventSourceRef.current = null
      // Reset connectionIdRef to allow reconnection after cleanup (important for React Strict Mode)
      connectionIdRef.current = null
    }
  }, [projectId, topic, onComplete, onError, updateStageStatuses])

  const handleCancel = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }
    onCancel?.()
  }, [onCancel])

  // Estimate remaining time based on progress
  const getTimeEstimate = () => {
    if (progress === 0) return 'Calculating...'
    if (progress >= 100) return 'Complete!'
    
    // Rough estimates based on typical generation times
    const remainingPercent = 100 - progress
    const secondsPerPercent = 1.2 // ~2 minutes total
    const remainingSeconds = Math.ceil(remainingPercent * secondsPerPercent)
    
    if (remainingSeconds < 60) return `~${remainingSeconds}s remaining`
    const minutes = Math.ceil(remainingSeconds / 60)
    return `~${minutes} min remaining`
  }

  return (
    <div className="absolute inset-0 z-50 bg-background/95 backdrop-blur-sm flex items-center justify-center">
      <div className="w-full max-w-lg mx-4">
        <div className="bg-card border rounded-lg shadow-lg p-6 space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Generating Your Paper</h2>
              <p className="text-sm text-muted-foreground line-clamp-1">
                {topic}
              </p>
            </div>
            {onCancel && !error && progress < 100 && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCancel}
                className="h-8 w-8 -mt-1 -mr-2"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{getTimeEstimate()}</span>
              <span className="font-medium">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {/* Current Status */}
          <div className="flex items-center gap-2 text-sm">
            {error ? (
              <AlertCircle className="h-4 w-4 text-destructive" />
            ) : progress < 100 ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            )}
            <span className={cn(
              error && "text-destructive"
            )}>
              {error || message}
            </span>
          </div>

          {/* Stage List */}
          <div className="space-y-2">
            {stages.map((stage) => (
              <div
                key={stage.id}
                className={cn(
                  "flex items-center gap-3 text-sm py-1.5 px-2 rounded-md transition-colors",
                  stage.status === 'active' && "bg-primary/5",
                  stage.status === 'complete' && "text-muted-foreground",
                  stage.status === 'pending' && "text-muted-foreground/50",
                  stage.status === 'error' && "text-destructive bg-destructive/5"
                )}
              >
                <div className={cn(
                  "flex-shrink-0",
                  stage.status === 'active' && "text-primary animate-pulse",
                  stage.status === 'complete' && "text-green-500",
                  stage.status === 'error' && "text-destructive"
                )}>
                  {stage.status === 'complete' ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : stage.status === 'error' ? (
                    <XCircle className="h-4 w-4" />
                  ) : stage.status === 'active' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <div className="h-4 w-4 rounded-full border-2 border-current opacity-30" />
                  )}
                </div>
                <span className="flex-1">{stage.label}</span>
                
                {/* Extra info for specific stages */}
                {stage.id === 'search' && stage.status === 'complete' && papersFound > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {papersFound} papers
                  </span>
                )}
                {stage.id === 'generation' && stage.status === 'active' && currentSection && (
                  <span className="text-xs text-muted-foreground">
                    {currentSection} ({sectionsCompleted}/{totalSections})
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Error Actions */}
          {error && (
            <div className="flex gap-2 pt-2">
              <Button 
                variant="outline" 
                onClick={handleCancel}
                className="flex-1"
              >
                Go Back
              </Button>
              <Button 
                onClick={() => window.location.reload()}
                className="flex-1"
              >
                Retry
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
