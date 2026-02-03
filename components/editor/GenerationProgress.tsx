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
  /** Optional: Pass existing runId to resume watching */
  runId?: string
}

// =============================================================================
// CONNECTION MANAGEMENT
// =============================================================================

interface ConnectionState {
  isConnected: boolean
  runId: string | null
  lastEventId: number
  wasDisconnectedWhileHidden: boolean
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

// UI stages displayed to user (5 clear stages)
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
  // Track processed event IDs to prevent duplicate processing on reconnect
  processedEventIds: Set<number>
}

type GenerationAction =
  | { type: 'PROGRESS_UPDATE'; payload: { progress?: number; stage: string; message: string; papersFound?: number; eventId?: number } }
  | { type: 'STREAMING_CHUNK'; payload: { sectionTitle?: string; chunkText: string; eventId?: number } }
  | { type: 'STREAMING_UPDATE'; payload: { sectionTitle?: string; streamingContent: string } }
  | { type: 'SECTION_COMPLETE'; payload: { sectionTitle: string; sectionContent: string; eventId?: number } }
  | { type: 'SECTION_STARTED'; payload: { sectionTitle: string; eventId?: number } }
  | { type: 'COMPLETE'; payload?: { eventId?: number } }
  | { type: 'ERROR'; payload: { error: string; eventId?: number } }

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
    processedEventIds: new Set(),
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
  // Helper to track processed event IDs for idempotency
  const markEventProcessed = (eventId?: number): Set<number> => {
    if (eventId === undefined || eventId < 0) return state.processedEventIds
    const newSet = new Set(state.processedEventIds)
    newSet.add(eventId)
    return newSet
  }

  switch (action.type) {
    case 'PROGRESS_UPDATE': {
      const { progress, stage, message, papersFound, eventId } = action.payload
      const uiStage = STAGE_MAPPING[stage] || stage
      const newStages = updateStageStatuses(state.stages, stage)
      
      return {
        ...state,
        progress: progress !== undefined && progress >= 0 ? progress : state.progress,
        currentStage: uiStage,
        message,
        stages: newStages,
        papersFound: papersFound ?? state.papersFound,
        processedEventIds: markEventProcessed(eventId),
      }
    }
    
    case 'STREAMING_CHUNK': {
      // Accumulate text chunks locally for live preview
      const { sectionTitle, chunkText, eventId } = action.payload
      return {
        ...state,
        currentSection: sectionTitle ?? state.currentSection,
        // Append chunk to existing content
        currentSectionContent: state.currentSectionContent + chunkText,
        processedEventIds: markEventProcessed(eventId),
      }
    }
    
    case 'STREAMING_UPDATE': {
      // Legacy: full content replacement (kept for backwards compatibility)
      const { sectionTitle, streamingContent } = action.payload
      return {
        ...state,
        currentSection: sectionTitle ?? state.currentSection,
        currentSectionContent: streamingContent,
      }
    }
    
    case 'SECTION_COMPLETE': {
      const { sectionTitle, sectionContent, eventId } = action.payload
      // Check if we already have this section (idempotency)
      const alreadyCompleted = state.completedSections.some(s => s.title === sectionTitle)
      if (alreadyCompleted) {
        return { ...state, processedEventIds: markEventProcessed(eventId) }
      }
      return {
        ...state,
        completedSections: [...state.completedSections, { title: sectionTitle, content: sectionContent }],
        currentSection: null,
        currentSectionContent: "",
        processedEventIds: markEventProcessed(eventId),
      }
    }
    
    case 'SECTION_STARTED': {
      const { sectionTitle, eventId } = action.payload
      return {
        ...state,
        currentSection: sectionTitle,
        // Clear content when starting a new section
        currentSectionContent: "",
        processedEventIds: markEventProcessed(eventId),
      }
    }
    
    case 'COMPLETE': {
      return {
        ...state,
        progress: 100,
        currentStage: "complete",
        message: "Paper generated successfully!",
        stages: state.stages.map((s) => ({ ...s, status: "complete" as const })),
        processedEventIds: markEventProcessed(action.payload?.eventId),
      }
    }
    
    case 'ERROR': {
      return {
        ...state,
        error: action.payload.error,
        stages: state.stages.map((s) => 
          s.status === "active" ? { ...s, status: "error" as const } : s
        ),
        processedEventIds: markEventProcessed(action.payload.eventId),
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
  runId: initialRunId,
}: GenerationProgressProps) {
  // Use reducer for batched state updates - prevents multiple re-renders per SSE event
  const [state, dispatch] = useReducer(generationReducer, null, createInitialState)
  const { progress, currentStage, message, stages, error, papersFound, currentSection, currentSectionContent, completedSections, processedEventIds } = state

  const eventSourceRef = useRef<EventSource | null>(null)
  const hasCompletedRef = useRef(false)
  const isStartingRef = useRef(false)
  
  // Use refs for values needed in callbacks to avoid recreating callbacks
  // This prevents the EventSource from being constantly reconnected
  const lastEventIdRef = useRef(0)
  const processedEventIdsRef = useRef<Set<number>>(new Set())
  
  // Connection state for reconnection handling
  const [connectionState, setConnectionState] = useState<ConnectionState>({
    isConnected: false,
    runId: initialRunId || null,
    lastEventId: 0,
    wasDisconnectedWhileHidden: false,
  })
  const isPageVisibleRef = useRef(true)

  // Start generation and get runId
  const startGeneration = useCallback(async () => {
    if (isStartingRef.current || hasCompletedRef.current) return
    isStartingRef.current = true

    try {
      console.log('[Generation] Starting generation for project:', projectId)
      
      const response = await fetch('/api/generate/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          paperType,
          projectId,
          length: 'medium',
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to start generation')
      }

      const data = await response.json()
      
      // Handle already complete case
      if (data.status === 'already_complete' && data.content) {
        console.log('[Generation] Project already complete')
        hasCompletedRef.current = true
        dispatch({ type: 'COMPLETE' })
        onComplete(data.content)
        return
      }

      console.log('[Generation] Started run:', data.runId)
      setConnectionState(prev => ({
        ...prev,
        runId: data.runId,
      }))
    } catch (err) {
      console.error('[Generation] Failed to start:', err)
      dispatch({ type: 'ERROR', payload: { error: err instanceof Error ? err.message : 'Failed to start generation' } })
      onError(err instanceof Error ? err.message : 'Failed to start generation')
    } finally {
      isStartingRef.current = false
    }
  }, [projectId, topic, paperType, onComplete, onError])

  // Connect to event stream once we have a runId
  const connectToEvents = useCallback((runId: string, lastEventId: number = 0) => {
    if (hasCompletedRef.current) return
    
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    console.log('[Generation] Connecting to events stream, runId:', runId, 'lastEventId:', lastEventId)
    
    // Create EventSource with Last-Event-ID support
    const url = `/api/generate/${runId}/events`
    const eventSource = new EventSource(url)
    eventSourceRef.current = eventSource

    // Note: EventSource doesn't support Last-Event-ID on initial connection via header
    // The server handles this via query params or we reconnect with it
    // For now, the server will send all events and we filter client-side if needed

    eventSource.onmessage = (event) => {
      try {
        // Parse event ID for idempotency and resume support
        let eventId: number | undefined
        if (event.lastEventId) {
          const parsedId = parseInt(event.lastEventId, 10)
          if (!isNaN(parsedId)) {
            eventId = parsedId
            // Update ref (doesn't cause re-render/reconnect)
            lastEventIdRef.current = parsedId
            // Also update state for UI purposes, but this won't cause reconnect
            setConnectionState(prev => ({ ...prev, lastEventId: parsedId }))
          }
        }

        // Skip already-processed events (idempotency on reconnect)
        // Use ref to avoid stale closure issues
        if (eventId !== undefined && processedEventIdsRef.current.has(eventId)) {
          return
        }
        // Mark as processed in ref immediately
        if (eventId !== undefined) {
          processedEventIdsRef.current.add(eventId)
        }

        const data = JSON.parse(event.data)
        
        switch (data.type) {
          case 'progress':
            // Handle streaming chunks (live character-by-character content)
            if (data.streaming && data.streamingContent) {
              dispatch({
                type: 'STREAMING_UPDATE',
                payload: {
                  sectionTitle: data.sectionTitle,
                  streamingContent: data.streamingContent,
                },
              })
              break
            }
            
            // Regular progress update
            dispatch({
              type: 'PROGRESS_UPDATE',
              payload: {
                progress: data.progress,
                stage: data.stage,
                message: data.message || "",
                papersFound: data.papersFound,
                eventId,
              },
            })
            break

          case 'text_chunk':
            // Streaming text chunk - accumulate locally (no fullContentSoFar from server)
            dispatch({
              type: 'STREAMING_CHUNK',
              payload: {
                sectionTitle: data.section,
                chunkText: data.text,
                eventId,
              },
            })
            break

          case 'section_start':
            dispatch({ 
              type: 'SECTION_STARTED', 
              payload: { sectionTitle: data.section, eventId } 
            })
            break

          case 'section_complete':
            dispatch({
              type: 'SECTION_COMPLETE',
              payload: {
                sectionTitle: data.section,
                sectionContent: data.content,
                eventId,
              },
            })
            break

          case 'complete':
            hasCompletedRef.current = true
            dispatch({ type: 'COMPLETE', payload: { eventId } })
            setTimeout(() => {
              onComplete(data.content)
            }, 500)
            break

          case 'error':
            hasCompletedRef.current = true
            dispatch({ type: 'ERROR', payload: { error: data.message, eventId } })
            onError(data.message)
            break

          case 'cancelled':
            hasCompletedRef.current = true
            dispatch({ type: 'ERROR', payload: { error: 'Generation was cancelled', eventId } })
            onError('Generation was cancelled')
            break
        }
      } catch (err) {
        console.error("[Generation] Failed to parse SSE message:", err)
      }
    }

    eventSource.onopen = () => {
      console.log('[Generation] EventSource connected')
      setConnectionState(prev => ({ 
        ...prev, 
        isConnected: true,
        wasDisconnectedWhileHidden: false,
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
        
        // Auto-reconnect after a short delay
        // The event stream supports Last-Event-ID, so we'll get missed events
        setTimeout(() => {
          if (!hasCompletedRef.current && isPageVisibleRef.current && runId) {
            console.log('[Generation] Attempting reconnect with lastEventId:', lastEventIdRef.current)
            connectToEvents(runId, lastEventIdRef.current)
          }
        }, 2000)
      }
      eventSource.close()
    }

    return () => {
      eventSource.close()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Use refs for lastEventId/processedEventIds to avoid reconnection loops
  }, [onComplete, onError])

  // Start generation on mount
  useEffect(() => {
    if (initialRunId) {
      // Already have a runId - just connect to events
      setConnectionState(prev => ({ ...prev, runId: initialRunId }))
    } else {
      // Need to start a new generation
      startGeneration()
    }
  }, [initialRunId, startGeneration])

  // Connect to events when we have a runId
  useEffect(() => {
    if (connectionState.runId && !hasCompletedRef.current) {
      // Use ref for lastEventId to get current value without causing reconnects
      const cleanup = connectToEvents(connectionState.runId, lastEventIdRef.current)
      return cleanup
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- connectToEvents is stable, only reconnect on runId change
  }, [connectionState.runId])

  // Handle page visibility changes - reconnect when page becomes visible
  useEffect(() => {
    const handleVisibilityChange = async () => {
      const isVisible = !document.hidden
      isPageVisibleRef.current = isVisible
      console.log('[Generation] Visibility changed:', isVisible ? 'visible' : 'hidden')
      
      if (isVisible && !hasCompletedRef.current && connectionState.runId) {
        // Page became visible - check status and reconnect
        if (connectionState.wasDisconnectedWhileHidden || !connectionState.isConnected) {
          console.log('[Generation] Page visible after disconnect, checking status...')
          
          try {
            // Check current run status
            const response = await fetch(`/api/generate/${connectionState.runId}/status`)
            if (response.ok) {
              const status = await response.json()
              console.log('[Generation] Server status:', status)
              
              if (status.status === 'completed' && status.content) {
                // Generation completed while we were away
                console.log('[Generation] Generation completed while hidden')
                hasCompletedRef.current = true
                dispatch({ type: 'COMPLETE' })
                onComplete(status.content)
                return
              } else if (status.status === 'failed') {
                hasCompletedRef.current = true
                dispatch({ type: 'ERROR', payload: { error: status.errorMessage || 'Generation failed' } })
                onError(status.errorMessage || 'Generation failed')
                return
              } else if (status.status === 'cancelled') {
                hasCompletedRef.current = true
                dispatch({ type: 'ERROR', payload: { error: 'Generation was cancelled' } })
                onError('Generation was cancelled')
                return
              } else if (status.status === 'running' || status.status === 'pending') {
                // Still running - reconnect EventSource
                console.log('[Generation] Generation still running, reconnecting...')
                setConnectionState(prev => ({
                  ...prev,
                  wasDisconnectedWhileHidden: false,
                }))
                connectToEvents(connectionState.runId!, connectionState.lastEventId)
              }
            }
          } catch (err) {
            console.warn('[Generation] Failed to check status:', err)
            // Try to reconnect anyway
            if (connectionState.runId) {
              connectToEvents(connectionState.runId, connectionState.lastEventId)
            }
          }
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [connectionState.runId, connectionState.wasDisconnectedWhileHidden, connectionState.isConnected, connectionState.lastEventId, onComplete, onError, connectToEvents])

  const handleCancel = useCallback(async () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }
    
    // Cancel on server
    if (connectionState.runId) {
      try {
        await fetch(`/api/generate/${connectionState.runId}/cancel`, {
          method: 'POST',
        })
      } catch (err) {
        console.warn('[Generation] Failed to cancel on server:', err)
      }
    }
    
    onCancel?.()
  }, [connectionState.runId, onCancel])

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
