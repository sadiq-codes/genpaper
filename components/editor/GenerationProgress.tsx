"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { Loader2, Search, FileText, BookOpen, Sparkles, CheckCircle2 } from "lucide-react"
import { GenerationLoadingUI, type ProgressStage } from "./GenerationLoadingUI"

interface GenerationProgressProps {
  projectId: string
  topic: string
  paperType?: "researchArticle" | "literatureReview" | "capstoneProject" | "mastersThesis" | "phdDissertation"
  onComplete: (content: string) => void
  onError: (error: string) => void
  onCancel?: () => void
}

const STAGE_CONFIG: Record<string, { label: string; icon: React.ReactNode }> = {
  start: { label: "Initializing", icon: <Loader2 className="h-4 w-4" /> },
  initialization: { label: "Initializing", icon: <Loader2 className="h-4 w-4" /> },
  profiling: { label: "Analyzing Topic", icon: <Search className="h-4 w-4" /> },
  search: { label: "Finding Sources", icon: <Search className="h-4 w-4" /> },
  themes: { label: "Analyzing Themes", icon: <BookOpen className="h-4 w-4" /> },
  outline: { label: "Creating Outline", icon: <FileText className="h-4 w-4" /> },
  context: { label: "Building Context", icon: <BookOpen className="h-4 w-4" /> },
  generation: { label: "Writing Sections", icon: <Sparkles className="h-4 w-4" /> },
  quality: { label: "Quality Review", icon: <CheckCircle2 className="h-4 w-4" /> },
  saving: { label: "Saving", icon: <Loader2 className="h-4 w-4" /> },
  complete: { label: "Complete", icon: <CheckCircle2 className="h-4 w-4" /> },
}

const ORDERED_STAGES = ["search", "outline", "context", "generation", "quality", "saving"]

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

  const eventSourceRef = useRef<EventSource | null>(null)
  const hasCompletedRef = useRef(false)
  const connectionIdRef = useRef<string | null>(null)

  const updateStageStatuses = useCallback((activeStage: string) => {
    setStages((prevStages) => {
      const activeIndex = ORDERED_STAGES.indexOf(activeStage)
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
            setProgress(data.progress || 0)
            setCurrentStage(data.stage)
            setMessage(data.message || "")
            updateStageStatuses(data.stage)

            if (data.data?.papersFound) {
              setPapersFound(data.data.papersFound)
            }

            // Handle section completion with content
            if (data.data?.sectionComplete && data.data?.sectionContent) {
              setCurrentSection(null) // Clear current since it's now complete
            } else {
              // Parse section info from message for "in progress" state
              const sectionMatch = data.message?.match(/Generating (\w+(?:\s+\w+)*) \((\d+)\/(\d+)\)/)
              if (sectionMatch) {
                setCurrentSection(sectionMatch[1])
              } else if (data.stage === 'generation' && data.message) {
                // Try to extract section name from various message formats
                const altMatch = data.message.match(/Writing\s+(.+?)(?:\s+\(|$)/) ||
                               data.message.match(/Generating\s+(.+?)(?:\s+\(|$)/) ||
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
      error={error}
      timeEstimate={getTimeEstimate()}
      onCancel={handleCancel}
      onRetry={handleRetry}
    />
  )
}
