"use client"

import { useEffect, useCallback, useRef, useReducer, useState } from "react"
import { Loader2, Search, FileText, Sparkles, CheckCircle2, FileStack } from "lucide-react"
import { GenerationLoadingUI, type ProgressStage, type CompletedSection } from "./GenerationLoadingUI"
import { LimitReachedModal, type LimitType } from "@/components/billing/limit-modal"
import { DEFAULT_LENGTH_BY_PAPER_TYPE } from "@/types/simplified"
import { toast } from "sonner"

interface GenerationProgressProps {
  projectId: string
  topic: string
  paperType?: "researchArticle" | "literatureReview" | "capstoneProject" | "mastersThesis" | "phdDissertation"
  onComplete: (content: string) => void
  onError: (error: string) => void
  onCancel?: () => void
  /** Optional: Pass existing runId to resume watching */
  runId?: string
  /** Optional: Server-known progress snapshot for immediate resume UI */
  initialProgress?: number
  /** Optional: Server-known stage snapshot for immediate resume UI */
  initialStage?: string | null
  /** Optional: Server-known section snapshot for immediate resume UI */
  initialSection?: string | null
  /** Skip status probe and start immediately (newly created project path) */
  startImmediately?: boolean
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
  start: { label: "Getting ready", icon: <Loader2 className="h-4 w-4" /> },
  initialization: { label: "Getting ready", icon: <Loader2 className="h-4 w-4" /> },
  // Main stages (shown in list)
  profiling: { label: "Understanding Your Research", icon: <Search className="h-4 w-4" /> },
  search: { label: "Finding Sources", icon: <FileStack className="h-4 w-4" /> },
  planning: { label: "Analyzing & Structuring", icon: <FileText className="h-4 w-4" /> },
  writing: { label: "Writing Your Paper", icon: <Sparkles className="h-4 w-4" /> },
  finishing: { label: "Final Touches", icon: <CheckCircle2 className="h-4 w-4" /> },
  complete: { label: "Complete", icon: <CheckCircle2 className="h-4 w-4" /> },
}

// UI stages displayed to user (5 clear stages)
const ORDERED_STAGES = ["profiling", "search", "planning", "writing", "finishing"]

// Map pipeline stages to UI stages
const STAGE_MAPPING: Record<string, string> = {
  'start': 'start',
  'initialization': 'initialization',
  'resuming': 'writing',
  'profiling': 'profiling',
  'search': 'search',
  'planning': 'planning',
  'writing': 'writing',
  'finishing': 'finishing',
  'complete': 'complete',
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

/**
 * Hide internal citation markers in streaming UI previews.
 * Keep this UI-only; persisted content remains unchanged.
 */
function sanitizeStreamingCitations(text: string): string {
  if (!text) return text
  // Matches pandoc-style citation blocks like:
  // [@paperId], [@paperId; @paperId], [@paperId#instanceId]
  return text.replace(/\[@[^\]]+\]/g, '[citation]')
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
    message: "Preparing to write your paper…",
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
  if (activeIndex === -1) {
    return stages
  }
  
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
        currentSectionContent: state.currentSectionContent + sanitizeStreamingCitations(chunkText),
        processedEventIds: markEventProcessed(eventId),
      }
    }
    
    case 'STREAMING_UPDATE': {
      // Legacy: full content replacement (kept for backwards compatibility)
      const { sectionTitle, streamingContent } = action.payload
      return {
        ...state,
        currentSection: sectionTitle ?? state.currentSection,
        currentSectionContent: sanitizeStreamingCitations(streamingContent),
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
        completedSections: [
          ...state.completedSections,
          { title: sectionTitle, content: sanitizeStreamingCitations(sectionContent) },
        ],
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
  initialProgress,
  initialStage,
  initialSection,
  startImmediately = false,
}: GenerationProgressProps) {
  // Use reducer for batched state updates - prevents multiple re-renders per SSE event
  const [state, dispatch] = useReducer(generationReducer, null, createInitialState)
  const { progress, currentStage, message, stages, error, papersFound, currentSection, currentSectionContent, completedSections, processedEventIds } = state

  const eventSourceRef = useRef<EventSource | null>(null)
  const hasCompletedRef = useRef(false)
  const completionNotifiedRef = useRef(false)
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
  
  // Limit modal state
  const [limitModalOpen, setLimitModalOpen] = useState(false)
  const [limitType, setLimitType] = useState<LimitType>('papers')

  // Start generation and get runId
  const startGeneration = useCallback(async () => {
    if (isStartingRef.current || hasCompletedRef.current) return
    isStartingRef.current = true

    try {
      
      const response = await fetch('/api/generate/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          paperType,
          projectId,
          length: DEFAULT_LENGTH_BY_PAPER_TYPE[paperType || 'literatureReview'] || 5500,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        
        // Check for limit exceeded error and show modal
        if (errorData.code === 'LIMIT_EXCEEDED') {
          setLimitType('papers')
          setLimitModalOpen(true)
          throw new Error(errorData.error || 'Paper limit reached')
        }
        
        throw new Error(errorData.error || 'Failed to start generation')
      }

      const data = await response.json()
      
      // Handle already complete case
      if (data.status === 'already_complete' && data.content) {
        hasCompletedRef.current = true
        completionNotifiedRef.current = true
        dispatch({ type: 'COMPLETE' })
        onComplete(data.content)
        return
      }

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

    
    // Create EventSource with Last-Event-ID support
    const url = `/api/generate/${runId}/events`
    const eventSource = new EventSource(url)
    eventSourceRef.current = eventSource

    // Note: EventSource doesn't support Last-Event-ID on initial connection via header
    // The server handles this via query params or we reconnect with it
    // For now, the server will send all events and we filter client-side if needed

    eventSource.onmessage = (event) => {
      if (hasCompletedRef.current || completionNotifiedRef.current) return

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
            if (completionNotifiedRef.current) break
            hasCompletedRef.current = true
            completionNotifiedRef.current = true
            eventSource.close()
            eventSourceRef.current = null
            dispatch({ type: 'COMPLETE', payload: { eventId } })
            setTimeout(() => {
              onComplete(data.content)
            }, 0)
            break

          case 'error':
            hasCompletedRef.current = true
            completionNotifiedRef.current = true
            eventSource.close()
            eventSourceRef.current = null
            dispatch({ type: 'ERROR', payload: { error: data.message, eventId } })
            onError(data.message)
            break

          case 'cancelled':
            hasCompletedRef.current = true
            completionNotifiedRef.current = true
            eventSource.close()
            eventSourceRef.current = null
            dispatch({ type: 'ERROR', payload: { error: 'Generation was cancelled', eventId } })
            onError('Generation was cancelled')
            break
        }
      } catch (err) {
        console.error("[Generation] Failed to parse SSE message:", err)
      }
    }

    eventSource.onopen = () => {
      setConnectionState(prev => ({ 
        ...prev, 
        isConnected: true,
        wasDisconnectedWhileHidden: false,
      }))
    }

    eventSource.onerror = () => {
      setConnectionState(prev => ({ ...prev, isConnected: false }))
      
      if (!hasCompletedRef.current) {
        // If page is hidden, mark for reconnect when visible
        if (!isPageVisibleRef.current) {
          setConnectionState(prev => ({ ...prev, wasDisconnectedWhileHidden: true }))
          eventSource.close()
          return
        }
        
        // Auto-reconnect after a short delay
        // The event stream supports Last-Event-ID, so we'll get missed events
        setTimeout(() => {
          if (!hasCompletedRef.current && isPageVisibleRef.current && runId) {
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

  // Check for existing run and restore progress from localStorage
  const checkExistingRunAndStart = useCallback(async () => {
    if (isStartingRef.current || hasCompletedRef.current) return
    
    try {
      
      // Check for existing active generation
      const statusResponse = await fetch(`/api/generate/status/${projectId}`)
      if (!statusResponse.ok) {
        console.warn('[Generation] Failed to check status, starting new generation')
        startGeneration()
        return
      }
      
      const status = await statusResponse.json()
      
      // Case 1: Active run exists - resume watching it
      if (status.hasActiveRun && status.runId) {
        
        // Restore progress from localStorage if available
        const storedProgress = localStorage.getItem(`generation-progress-${status.runId}`)
        if (storedProgress) {
          try {
            const parsed = JSON.parse(storedProgress)
            if (parsed.progress !== undefined) {
              dispatch({
                type: 'PROGRESS_UPDATE',
                payload: {
                  progress: parsed.progress,
                  stage: parsed.stage || status.currentStage || 'writing',
                  message: parsed.message || 'Resuming generation…',
                  papersFound: parsed.papersFound,
                },
              })
            }
            // Restore last event ID for proper replay
            if (parsed.lastEventId) {
              lastEventIdRef.current = parsed.lastEventId
            }
          } catch (e) {
            console.warn('[Generation] Failed to parse stored progress:', e)
          }
        } else {
          // No stored progress - use server status
          dispatch({
            type: 'PROGRESS_UPDATE',
            payload: {
              progress: status.progress || 0,
              stage: status.currentStage || 'writing',
              message: 'Resuming generation…',
            },
          })
        }
        
        setConnectionState(prev => ({
          ...prev,
          runId: status.runId,
        }))
        return
      }
      
      // Case 2: Generation already completed
      if (status.status === 'completed' && status.content) {
        hasCompletedRef.current = true
        completionNotifiedRef.current = true
        dispatch({ type: 'COMPLETE' })
        onComplete(status.content)
        // Clean up localStorage
        localStorage.removeItem(`generation-progress-${status.runId}`)
        return
      }
      
      // Case 3: Previous generation failed
      if (status.status === 'failed') {
        // Clean up localStorage for failed run
        if (status.runId) {
          localStorage.removeItem(`generation-progress-${status.runId}`)
        }
        startGeneration()
        return
      }
      
      // Case 4: Previous generation was cancelled
      if (status.status === 'cancelled') {
        hasCompletedRef.current = true
        completionNotifiedRef.current = true
        dispatch({ type: 'ERROR', payload: { error: 'Generation was cancelled' } })
        if (status.runId) {
          localStorage.removeItem(`generation-progress-${status.runId}`)
        }
        onError('Generation was cancelled')
        return
      }

      // Case 5: No active run - start new generation
      startGeneration()
      
    } catch (err) {
      console.error('[Generation] Error checking existing run:', err)
      // Fall back to starting new generation
      startGeneration()
    }
  }, [projectId, startGeneration, onComplete, onError])

  // Start generation on mount
  useEffect(() => {
    if (initialRunId) {
      dispatch({
        type: 'PROGRESS_UPDATE',
        payload: {
          progress: initialProgress ?? 0,
          stage: initialStage || 'resuming',
          message: initialStage === 'resuming' || !initialStage
            ? 'Resuming generation…'
            : 'Reconnecting to generation…',
        },
      })
      if (initialSection) {
        dispatch({
          type: 'SECTION_STARTED',
          payload: { sectionTitle: initialSection },
        })
      }
      // Already have a runId - just connect to events
      setConnectionState(prev => ({ ...prev, runId: initialRunId }))
    } else if (startImmediately) {
      // Newly created project path: skip status probe and start right away
      startGeneration()
    } else {
      // Check for existing run first, then start if needed
      checkExistingRunAndStart()
    }
  }, [initialRunId, initialProgress, initialSection, initialStage, startImmediately, startGeneration, checkExistingRunAndStart])

  // Connect to events when we have a runId
  useEffect(() => {
    if (connectionState.runId && !hasCompletedRef.current) {
      // Use ref for lastEventId to get current value without causing reconnects
      const cleanup = connectToEvents(connectionState.runId, lastEventIdRef.current)
      return cleanup
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- connectToEvents is stable, only reconnect on runId change
  }, [connectionState.runId])

  // Persist progress to localStorage for page refresh recovery
  useEffect(() => {
    if (connectionState.runId && !hasCompletedRef.current && progress > 0) {
      const progressData = {
        progress,
        stage: currentStage,
        message,
        papersFound,
        lastEventId: lastEventIdRef.current,
        timestamp: Date.now(),
      }
      try {
        localStorage.setItem(
          `generation-progress-${connectionState.runId}`,
          JSON.stringify(progressData)
        )
      } catch (e) {
        // localStorage might be full or disabled
        console.warn('[Generation] Failed to persist progress:', e)
      }
    }
  }, [connectionState.runId, progress, currentStage, message, papersFound])

  // Clean up localStorage when generation completes
  useEffect(() => {
    if (hasCompletedRef.current && connectionState.runId) {
      localStorage.removeItem(`generation-progress-${connectionState.runId}`)
    }
  }, [connectionState.runId])

  // Handle page visibility changes - reconnect when page becomes visible
  useEffect(() => {
    const handleVisibilityChange = async () => {
      const isVisible = !document.hidden
      isPageVisibleRef.current = isVisible
      
      if (isVisible && !hasCompletedRef.current && connectionState.runId) {
        // Page became visible - check status and reconnect
        if (connectionState.wasDisconnectedWhileHidden || !connectionState.isConnected) {
          
          try {
            // Check current run status
            const response = await fetch(`/api/generate/${connectionState.runId}/status`)
            if (response.ok) {
              const status = await response.json()
              
              if (status.status === 'completed' && status.content) {
                // Generation completed while we were away
                hasCompletedRef.current = true
                completionNotifiedRef.current = true
                dispatch({ type: 'COMPLETE' })
                onComplete(status.content)
                return
              } else if (status.status === 'failed') {
                hasCompletedRef.current = true
                completionNotifiedRef.current = true
                dispatch({ type: 'ERROR', payload: { error: status.errorMessage || 'Generation failed' } })
                onError(status.errorMessage || 'Generation failed')
                return
              } else if (status.status === 'cancelled') {
                hasCompletedRef.current = true
                completionNotifiedRef.current = true
                dispatch({ type: 'ERROR', payload: { error: 'Generation was cancelled' } })
                onError('Generation was cancelled')
                return
              } else if (status.status === 'running' || status.status === 'pending') {
                // Still running - reconnect EventSource
                setConnectionState(prev => ({
                  ...prev,
                  wasDisconnectedWhileHidden: false,
                }))
                connectToEvents(connectionState.runId!, lastEventIdRef.current)
              }
            }
          } catch (err) {
            console.warn('[Generation] Failed to check status:', err)
            // Try to reconnect anyway
            if (connectionState.runId) {
              connectToEvents(connectionState.runId, lastEventIdRef.current)
            }
          }
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Use refs for lastEventId, connectToEvents is stable
  }, [connectionState.runId, connectionState.wasDisconnectedWhileHidden, connectionState.isConnected, onComplete, onError])

  const [isCancelling, setIsCancelling] = useState(false)

  const handleCancel = useCallback(async () => {
    if (!connectionState.runId) {
      onCancel?.()
      return
    }

    setIsCancelling(true)

    try {
      const response = await fetch(`/api/generate/${connectionState.runId}/cancel`, {
        method: 'POST',
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || 'Failed to cancel generation')
      }

      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }

      localStorage.removeItem(`generation-progress-${connectionState.runId}`)
      onCancel?.()
    } catch (err) {
      setIsCancelling(false)
      console.warn('[Generation] Failed to cancel on server:', err)
      toast.error(
        err instanceof Error
          ? err.message
          : 'Failed to cancel generation. Please try again.'
      )
    }
  }, [connectionState.runId, onCancel])

  const handleRetry = useCallback(() => {
    window.location.reload()
  }, [])

  const getTimeEstimate = () => {
    if (progress === 0) return "Calculating…"
    if (progress >= 100) return "Complete!"

    const remainingPercent = 100 - progress
    const secondsPerPercent = 1.2
    const remainingSeconds = Math.ceil(remainingPercent * secondsPerPercent)

    if (remainingSeconds < 60) return `~${remainingSeconds}s remaining`
    const minutes = Math.ceil(remainingSeconds / 60)
    return `~${minutes} min remaining`
  }

  return (
    <>
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
        isCancelling={isCancelling}
      />
      
      {/* Limit reached modal */}
      <LimitReachedModal
        open={limitModalOpen}
        onOpenChange={setLimitModalOpen}
        limitType={limitType}
      />
    </>
  )
}
