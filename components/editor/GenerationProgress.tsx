"use client"

import type React from "react"

import { useEffect, useState, useCallback, useRef } from "react"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { Loader2, Search, FileText, BookOpen, Sparkles, CheckCircle2, XCircle, AlertCircle, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface GenerationProgressProps {
  projectId: string
  topic: string
  paperType?: "researchArticle" | "literatureReview" | "capstoneProject" | "mastersThesis" | "phdDissertation"
  onComplete: (content: string) => void
  onError: (error: string) => void
  onCancel?: () => void
}

interface ProgressStage {
  id: string
  label: string
  icon: React.ReactNode
  status: "pending" | "active" | "complete" | "error"
  message?: string
  data?: Record<string, unknown>
}

const STAGE_CONFIG: Record<string, { label: string; icon: React.ReactNode }> = {
  start: { label: "Initializing", icon: <Loader2 className="h-4 w-4" /> },
  initialization: { label: "Initializing", icon: <Loader2 className="h-4 w-4" /> },
  search: { label: "Finding Sources", icon: <Search className="h-4 w-4" /> },
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
  const [_currentStage, setCurrentStage] = useState<string>("start")
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
  // Section tracking - used for parsing progress messages
  const [_sectionsCompleted, setSectionsCompleted] = useState(0)
  const [_totalSections, setTotalSections] = useState(0)

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
            if (data.data?.sectionCount) {
              setTotalSections(data.data.sectionCount)
            }

            const sectionMatch = data.message?.match(/Generating (\w+(?:\s+\w+)*) $$(\d+)\/(\d+)$$/)
            if (sectionMatch) {
              setCurrentSection(sectionMatch[1])
              setSectionsCompleted(Number.parseInt(sectionMatch[2]) - 1)
              setTotalSections(Number.parseInt(sectionMatch[3]))
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
    <div className="absolute inset-0 z-50 bg-background/95 backdrop-blur-sm flex items-center justify-center">
      <div className="w-full max-w-lg mx-4">
        <div className="bg-card border rounded-lg shadow-lg p-6 space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2 flex-1 min-w-0">
              <h2 className="text-xl font-semibold">Generating Your Paper</h2>
              <p className="text-sm text-muted-foreground line-clamp-1">{topic}</p>
            </div>
            {onCancel && !error && progress < 100 && (
              <Button variant="ghost" size="icon" onClick={handleCancel} className="h-8 w-8 -mt-1 shrink-0">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Progress Bar */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground font-medium">{getTimeEstimate()}</span>
              <span className="text-primary font-semibold">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {/* Current Status */}
          <div className="flex items-center gap-3 text-sm p-3 rounded-lg bg-muted/30">
            {error ? (
              <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
            ) : progress < 100 ? (
              <Loader2 className="h-5 w-5 text-primary animate-spin shrink-0" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
            )}
            <span className={cn("flex-1", error && "text-destructive font-medium")}>{error || message}</span>
          </div>

          {/* Stage List */}
          <div className="space-y-1.5">
            {stages.map((stage) => (
              <div
                key={stage.id}
                className={cn(
                  "flex items-center gap-3 text-sm py-2.5 px-3 rounded-lg transition-all",
                  stage.status === "active" && "bg-primary/8 border border-primary/20",
                  stage.status === "complete" && "text-muted-foreground opacity-75",
                  stage.status === "pending" && "text-muted-foreground/50 opacity-50",
                  stage.status === "error" && "text-destructive bg-destructive/5 border border-destructive/20",
                )}
              >
                <div className="flex-shrink-0 w-5 flex items-center justify-center">
                  {stage.status === "complete" ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : stage.status === "error" ? (
                    <XCircle className="h-4 w-4 text-destructive" />
                  ) : stage.status === "active" ? (
                    <Loader2 className="h-4 w-4 text-primary animate-spin" />
                  ) : (
                    <div className="h-2 w-2 rounded-full bg-current opacity-30" />
                  )}
                </div>

                <span className="flex-1 font-medium">{stage.label}</span>

                {/* Contextual info */}
                {stage.id === "search" && stage.status === "complete" && papersFound > 0 && (
                  <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded">
                    {papersFound} papers
                  </span>
                )}
                {stage.id === "generation" && stage.status === "active" && currentSection && (
                  <span className="text-xs text-muted-foreground">{currentSection}</span>
                )}
              </div>
            ))}
          </div>

          {/* Error Actions */}
          {error && (
            <div className="flex gap-2 pt-2 border-t">
              <Button variant="outline" onClick={handleCancel} className="flex-1 bg-transparent">
                Go Back
              </Button>
              <Button onClick={() => window.location.reload()} className="flex-1">
                Retry
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
