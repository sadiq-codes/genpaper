"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { Loader2, Search, FileText, BookOpen, Sparkles, CheckCircle2, FileStack } from "lucide-react"
import { GenerationLoadingUI, type ProgressStage, type CompletedSection } from "./GenerationLoadingUI"

interface GenerationProgressProps {
  projectId: string
  topic: string
  paperType?: "researchArticle" | "literatureReview" | "capstoneProject" | "mastersThesis" | "phdDissertation"
  onComplete: (content: string) => void
  onError: (error: string) => void
  onCancel?: () => void
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

export function GenerationProgress({
  projectId,
  topic,
  paperType = "literatureReview",
  onComplete,
  onError,
  onCancel,
}: GenerationProgressProps) {
  const [progress, setProgress] = useState(0)
  const [currentStage, setCurrentStage] = useState<string>("start")
  const [message, setMessage] = useState("Starting paper generation...")
  const [stages, setStages] = useState<ProgressStage[]>(
    ORDERED_STAGES.map((id) => ({
      id,
      label: STAGE_CONFIG[id]?.label || id,
      icon: STAGE_CONFIG[id]?.icon || <Loader2 className="h-4 w-4" />,
      status: "pending",
    })),
  )
  const [error, setError] = useState<string | null>(null)
  const [papersFound, setPapersFound] = useState<number>(0)
  const [currentSection, setCurrentSection] = useState<string | null>(null)
  const [currentSectionContent, setCurrentSectionContent] = useState<string>("")
  const [completedSections, setCompletedSections] = useState<CompletedSection[]>([])

  const eventSourceRef = useRef<EventSource | null>(null)
  const hasCompletedRef = useRef(false)
  const connectionIdRef = useRef<string | null>(null)

  const updateStageStatuses = useCallback((pipelineStage: string) => {
    // Map pipeline stage to UI stage
    const uiStage = STAGE_MAPPING[pipelineStage] || pipelineStage
    
    setStages((prevStages) => {
      const activeIndex = ORDERED_STAGES.indexOf(uiStage)
      return prevStages.map((stage, index) => {
        if (index < activeIndex) {
          return { ...stage, status: "complete" as const }
        } else if (index === activeIndex) {
          return { ...stage, status: "active" as const }
        }
        return { ...stage, status: "pending" as const }
      })
    })
  }, [])

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
            // Don't update progress for streaming events (progress = -1)
            if (data.progress >= 0) {
              setProgress(data.progress || 0)
            }
            
            // Map pipeline stage to UI stage for display
            const uiStage = STAGE_MAPPING[data.stage] || data.stage
            setCurrentStage(uiStage)
            setMessage(data.message || "")
            updateStageStatuses(data.stage)

            if (data.data?.papersFound) {
              setPapersFound(data.data.papersFound)
            }

            // Handle streaming chunks (live character-by-character content)
            if (data.data?.streaming && data.data?.streamingContent) {
              // Update current section title and streaming content
              if (data.data.sectionTitle) {
                setCurrentSection(data.data.sectionTitle)
              }
              setCurrentSectionContent(data.data.streamingContent)
              break
            }
            
            // Handle section completion with content
            if (data.data?.sectionComplete && data.data?.sectionContent) {
              // Add completed section to list
              setCompletedSections(prev => [...prev, {
                title: data.data.sectionTitle || currentSection || 'Section',
                content: data.data.sectionContent
              }])
              // Clear current section content since it's now complete
              setCurrentSection(null)
              setCurrentSectionContent("")
            } else {
              // Parse section info from message for "in progress" state
              const sectionMatch = data.message?.match(/Writing\s+(.+?)\s+\((\d+)\/(\d+)\)/)
              if (sectionMatch) {
                setCurrentSection(sectionMatch[1])
              } else if ((data.stage === 'writing' || data.stage === 'generation') && data.message) {
                // Try to extract section name from various message formats
                const altMatch = data.message.match(/Writing\s+(.+?)(?:\s+\(|\.\.\.|$)/) ||
                               data.message.match(/Completed\s+(.+?)(?:\s+\(|$)/)
                if (altMatch) {
                  // If message says "Completed", don't set as current
                  if (!data.message.includes('Completed')) {
                    setCurrentSection(altMatch[1])
                  }
                }
              }
            }
            break

          case "complete":
            hasCompletedRef.current = true
            setProgress(100)
            setCurrentStage("complete")
            setMessage("Paper generated successfully!")
            setStages((prev) => prev.map((s) => ({ ...s, status: "complete" as const })))

            setTimeout(() => {
              onComplete(data.content)
            }, 500)
            break

          case "error":
            hasCompletedRef.current = true
            setError(data.error)
            setStages((prev) => prev.map((s) => (s.status === "active" ? { ...s, status: "error" as const } : s)))
            onError(data.error)
            break
        }
      } catch (err) {
        console.error("Failed to parse SSE message:", err)
      }
    }

    eventSource.onerror = (err) => {
      console.error("EventSource error:", err)
      if (!hasCompletedRef.current) {
        setError("Connection lost. Please refresh and try again.")
        onError("Connection lost")
      }
      eventSource.close()
    }

    return () => {
      eventSource.close()
      eventSourceRef.current = null
      connectionIdRef.current = null
    }
  }, [projectId, topic, paperType, onComplete, onError, updateStageStatuses])

  const handleCancel = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
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
