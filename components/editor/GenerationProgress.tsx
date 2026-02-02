"use client"

import { useEffect, useCallback, useRef, useReducer, useState } from "react"
import { Loader2, Search, FileText, Sparkles, CheckCircle2, FileStack } from "lucide-react"
import { GenerationLoadingUI, type ProgressStage, type CompletedSection } from "./GenerationLoadingUI"

interface GenerationProgressProps {
  projectId: string
  topic: string
  paperType?: "researchArticle" | "literatureReview" | "capstoneProject" | "mastersThesis" | "phdDissertation"
  onComplete: (content: string) => void
  onError: (error: string) => void
  onCancel?: () => void
}

// =============================================================================
// CONNECTION MANAGEMENT
// =============================================================================

interface ConnectionState {
  isConnected: boolean
  reconnectAttempts: number
  wasDisconnectedWhileHidden: boolean
}

const MAX_RECONNECT_ATTEMPTS = 5
const BASE_RECONNECT_DELAY = 1000 // 1 second
const MAX_RECONNECT_DELAY = 30000 // 30 seconds

/**
 * Calculate exponential backoff delay
 */
function getReconnectDelay(attempt: number): number {
  const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, attempt), MAX_RECONNECT_DELAY)
  // Add jitter (±20%) to prevent thundering herd
  return delay * (0.8 + Math.random() * 0.4)
}

// Stage configuration - maps pipeline stage IDs to display labels and icons
const STAGE_CONFIG: Record<string, { label: string; icon: React.ReactNode }> = {
  // Initialization stages (not shown in list)
  start: { label: "Starting", icon: <Loader2 className="h-4 w-4" /> },
  initialization: { label: "Starting", icon: <Loader2 className="h-4 w-4" /> },
  // Main stages (shown in list)
  profiling: { label: "Analyzing Topic", icon: <Search className="h-4 w-4" /> },
  search: { label: "Preparing Sources", icon: <FileStack className="h-4 w-4" /> },
  planning: { label: "Planning Structure", icon: <FileText className="h-4 w-4" /> },
  writing: { label: "Writing Paper", icon: <Sparkles className="h-4 w-4" /> },
  finishing: { label: "Finishing Up", icon: <CheckCircle2 className="h-4 w-4" /> },
  complete: { label: "Complete", icon: <CheckCircle2 className="h-4 w-4" /> },
}

// UI stages displayed to user (6 clear stages)
const ORDERED_STAGES = ["profiling", "search", "planning", "writing", "finishing"]

// Map pipeline stages to UI stages (for stages that were combined)
const STAGE_MAPPING: Record<string, string> = {
  'profiling': 'profiling',
  'search': 'search',
  'themes': 'planning',
  'outline': 'planning',
  'context': 'writing',
  'generation': 'writing',
  'quality': 'finishing',
  'saving': 'finishing',
}

// =============================================================================
// REDUCER FOR BATCHED STATE UPDATES
// =============================================================================

interface GenerationState {
  progress: number
  currentStage: string
  message: string
  stages: ProgressStage[]
  error: string | null
  papersFound: number
  currentSection: string | null
  currentSectionContent: string
  completedSections: CompletedSection[]
}

type GenerationAction =
  | { type: 'PROGRESS_UPDATE'; payload: { progress?: number; stage: string; message: string; papersFound?: number } }
  | { type: 'STREAMING_UPDATE'; payload: { sectionTitle?: string; streamingContent: string } }
  | { type: 'SECTION_COMPLETE'; payload: { sectionTitle: string; sectionContent: string } }
  | { type: 'SECTION_STARTED'; payload: { sectionTitle: string } }
  | { type: 'COMPLETE' }
  | { type: 'ERROR'; payload: { error: string } }

function createInitialState(): GenerationState {
  return {
    progress: 0,
    currentStage: "start",
    message: "Starting paper generation...",
    stages: ORDERED_STAGES.map((id) => ({
      id,
      label: STAGE_CONFIG[id]?.label || id,
      icon: STAGE_CONFIG[id]?.icon || <Loader2 className="h-4 w-4" />,
      status: "pending" as const,
    })),
    error: null,
    papersFound: 0,
    currentSection: null,
    currentSectionContent: "",
    completedSections: [],
  }
}

function updateStageStatuses(stages: ProgressStage[], pipelineStage: string): ProgressStage[] {
  const uiStage = STAGE_MAPPING[pipelineStage] || pipelineStage
  const activeIndex = ORDERED_STAGES.indexOf(uiStage)
  
  return stages.map((stage, index) => {
    if (index < activeIndex) {
      return stage.status === "complete" ? stage : { ...stage, status: "complete" as const }
    } else if (index === activeIndex) {
      return stage.status === "active" ? stage : { ...stage, status: "active" as const }
    }
    return stage.status === "pending" ? stage : { ...stage, status: "pending" as const }
  })
}

function generationReducer(state: GenerationState, action: GenerationAction): GenerationState {
  switch (action.type) {
    case 'PROGRESS_UPDATE': {
      const { progress, stage, message, papersFound } = action.payload
      const uiStage = STAGE_MAPPING[stage] || stage
      const newStages = updateStageStatuses(state.stages, stage)
      
      return {
        ...state,
        progress: progress !== undefined && progress >= 0 ? progress : state.progress,
        currentStage: uiStage,
        message,
        stages: newStages,
        papersFound: papersFound ?? state.papersFound,
      }
    }
    
    case 'STREAMING_UPDATE': {
      const { sectionTitle, streamingContent } = action.payload
      return {
        ...state,
        currentSection: sectionTitle ?? state.currentSection,
        currentSectionContent: streamingContent,
      }
    }
    
    case 'SECTION_COMPLETE': {
      const { sectionTitle, sectionContent } = action.payload
      return {
        ...state,
        completedSections: [...state.completedSections, { title: sectionTitle, content: sectionContent }],
        currentSection: null,
        currentSectionContent: "",
      }
    }
    
    case 'SECTION_STARTED': {
      return {
        ...state,
        currentSection: action.payload.sectionTitle,
      }
    }
    
    case 'COMPLETE': {
      return {
        ...state,
        progress: 100,
        currentStage: "complete",
        message: "Paper generated successfully!",
        stages: state.stages.map((s) => ({ ...s, status: "complete" as const })),
      }
    }
    
    case 'ERROR': {
      return {
        ...state,
        error: action.payload.error,
        stages: state.stages.map((s) => 
          s.status === "active" ? { ...s, status: "error" as const } : s
        ),
      }
    }
    
    default:
      return state
  }
}

export function GenerationProgress({
  projectId,
  topic,
  paperType = "literatureReview",
  onComplete,
  onError,
  onCancel,
}: GenerationProgressProps) {
  // Use reducer for batched state updates - prevents multiple re-renders per SSE event
  const [state, dispatch] = useReducer(generationReducer, null, createInitialState)
  const { progress, currentStage, message, stages, error, papersFound, currentSection, currentSectionContent, completedSections } = state

  const eventSourceRef = useRef<EventSource | null>(null)
  const hasCompletedRef = useRef(false)
  const connectionIdRef = useRef<string | null>(null)
  
  // Connection state for reconnection handling
  const [connectionState, setConnectionState] = useState<ConnectionState>({
    isConnected: false,
    reconnectAttempts: 0,
    wasDisconnectedWhileHidden: false,
  })
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isPageVisibleRef = useRef(true)

  useEffect(() => {
    if (hasCompletedRef.current) return
    if (connectionIdRef.current === projectId) return

    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    connectionIdRef.current = projectId

    const params = new URLSearchParams({
      topic,
      projectId,
      length: "medium",
      paperType,
    })

    const eventSource = new EventSource(`/api/generate?${params.toString()}`)
    eventSourceRef.current = eventSource

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        switch (data.type) {
          case "progress":
            // Handle streaming chunks (live character-by-character content)
            if (data.data?.streaming && data.data?.streamingContent) {
              dispatch({
                type: 'STREAMING_UPDATE',
                payload: {
                  sectionTitle: data.data.sectionTitle,
                  streamingContent: data.data.streamingContent,
                },
              })
              break
            }
            
            // Handle section completion with content
            if (data.data?.sectionComplete && data.data?.sectionContent) {
              dispatch({
                type: 'SECTION_COMPLETE',
                payload: {
                  sectionTitle: data.data.sectionTitle || 'Section',
                  sectionContent: data.data.sectionContent,
                },
              })
            } else {
              // Regular progress update (batched into single state change)
              dispatch({
                type: 'PROGRESS_UPDATE',
                payload: {
                  progress: data.progress,
                  stage: data.stage,
                  message: data.message || "",
                  papersFound: data.data?.papersFound,
                },
              })
              
              // Parse section info from message for "in progress" state
              const sectionMatch = data.message?.match(/Writing\s+(.+?)\s+\((\d+)\/(\d+)\)/)
              if (sectionMatch) {
                dispatch({ type: 'SECTION_STARTED', payload: { sectionTitle: sectionMatch[1] } })
              } else if ((data.stage === 'writing' || data.stage === 'generation') && data.message) {
                // Try to extract section name from various message formats
                const altMatch = data.message.match(/Writing\s+(.+?)(?:\s+\(|\.\.\.|$)/) ||
                               data.message.match(/Completed\s+(.+?)(?:\s+\(|$)/)
                if (altMatch && !data.message.includes('Completed')) {
                  dispatch({ type: 'SECTION_STARTED', payload: { sectionTitle: altMatch[1] } })
                }
              }
            }
            break

          case "complete":
            hasCompletedRef.current = true
            dispatch({ type: 'COMPLETE' })

            setTimeout(() => {
              onComplete(data.content)
            }, 500)
            break

          case "error":
            hasCompletedRef.current = true
            dispatch({ type: 'ERROR', payload: { error: data.error } })
            onError(data.error)
            break
        }
      } catch (err) {
        console.error("Failed to parse SSE message:", err)
      }
    }

    eventSource.onopen = () => {
      console.log('[Generation] EventSource connected')
      setConnectionState(prev => ({ 
        ...prev, 
        isConnected: true, 
        reconnectAttempts: 0 
      }))
    }

    eventSource.onerror = () => {
      console.log('[Generation] EventSource error, hasCompleted:', hasCompletedRef.current)
      setConnectionState(prev => ({ ...prev, isConnected: false }))
      
      if (!hasCompletedRef.current) {
        // If page is hidden, mark for reconnect when visible
        if (!isPageVisibleRef.current) {
          console.log('[Generation] Page hidden during disconnect, will reconnect on visibility')
          setConnectionState(prev => ({ ...prev, wasDisconnectedWhileHidden: true }))
          eventSource.close()
          return
        }
        
        // Attempt reconnection with exponential backoff
        setConnectionState(prev => {
          if (prev.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            dispatch({ type: 'ERROR', payload: { error: "Connection lost. Please refresh and try again." } })
            onError("Connection lost after multiple retries")
            return prev
          }
          
          const delay = getReconnectDelay(prev.reconnectAttempts)
          console.log(`[Generation] Scheduling reconnect attempt ${prev.reconnectAttempts + 1} in ${Math.round(delay)}ms`)
          
          reconnectTimeoutRef.current = setTimeout(() => {
            if (!hasCompletedRef.current && isPageVisibleRef.current) {
              console.log('[Generation] Attempting reconnect...')
              // Reset connection ID to force reconnect
              connectionIdRef.current = null
              // Trigger re-render to create new EventSource
              setConnectionState(p => ({ ...p, reconnectAttempts: p.reconnectAttempts + 1 }))
            }
          }, delay)
          
          return { ...prev, reconnectAttempts: prev.reconnectAttempts + 1 }
        })
      }
      eventSource.close()
    }

    return () => {
      eventSource.close()
      eventSourceRef.current = null
      connectionIdRef.current = null
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
    }
  }, [projectId, topic, paperType, onComplete, onError, connectionState.reconnectAttempts])

  // Handle page visibility changes - reconnect when page becomes visible
  useEffect(() => {
    const handleVisibilityChange = async () => {
      const isVisible = !document.hidden
      isPageVisibleRef.current = isVisible
      console.log('[Generation] Visibility changed:', isVisible ? 'visible' : 'hidden')
      
      if (isVisible && !hasCompletedRef.current) {
        // Page became visible - check if we need to reconnect or fetch status
        if (connectionState.wasDisconnectedWhileHidden || !connectionState.isConnected) {
          console.log('[Generation] Page visible after disconnect, checking status...')
          
          try {
            // Check if generation is still running server-side
            const response = await fetch(`/api/generate/status?projectId=${projectId}`)
            if (response.ok) {
              const status = await response.json()
              console.log('[Generation] Server status:', status)
              
              if (!status.isGenerating && status.hasContent) {
                // Generation completed while we were away - fetch content
                console.log('[Generation] Generation completed while hidden, fetching content...')
                hasCompletedRef.current = true
                dispatch({ type: 'COMPLETE' })
                
                // Fetch the actual content from the project
                const projectResponse = await fetch(`/api/projects/${projectId}`)
                if (projectResponse.ok) {
                  const project = await projectResponse.json()
                  if (project.content) {
                    onComplete(project.content)
                    return
                  }
                }
              } else if (status.isGenerating) {
                // Still generating - reconnect EventSource
                console.log('[Generation] Generation still running, reconnecting...')
                setConnectionState(prev => ({
                  ...prev,
                  wasDisconnectedWhileHidden: false,
                  reconnectAttempts: 0,
                }))
                connectionIdRef.current = null // Force reconnect
              }
            }
          } catch (err) {
            console.warn('[Generation] Failed to check status:', err)
            // Try to reconnect anyway
            setConnectionState(prev => ({
              ...prev,
              wasDisconnectedWhileHidden: false,
            }))
            connectionIdRef.current = null
          }
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [projectId, connectionState.wasDisconnectedWhileHidden, connectionState.isConnected, onComplete])

  const handleCancel = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }
    onCancel?.()
  }, [onCancel])

  const handleRetry = useCallback(() => {
    window.location.reload()
  }, [])

  const getTimeEstimate = () => {
    if (progress === 0) return "Calculating..."
    if (progress >= 100) return "Complete!"

    const remainingPercent = 100 - progress
    const secondsPerPercent = 1.2
    const remainingSeconds = Math.ceil(remainingPercent * secondsPerPercent)

    if (remainingSeconds < 60) return `~${remainingSeconds}s remaining`
    const minutes = Math.ceil(remainingSeconds / 60)
    return `~${minutes} min remaining`
  }

  return (
    <GenerationLoadingUI
      topic={topic}
      progress={progress}
      currentStage={currentStage}
      message={message}
      stages={stages}
      papersFound={papersFound}
      currentSection={currentSection}
      currentSectionContent={currentSectionContent}
      completedSections={completedSections}
      error={error}
      timeEstimate={getTimeEstimate()}
      onCancel={handleCancel}
      onRetry={handleRetry}
    />
  )
}
