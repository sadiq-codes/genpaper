"use client"

import type React from "react"

import { useEffect, useState, useMemo } from "react"
import { Sparkles, Search, FileText, CheckCircle, Brain, Quote, Clock, BookOpen, Zap } from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import type { GenerationProgress } from "@/types/simplified"

interface Step {
  stage: string
  message: string
  icon: React.ElementType
  fallbackMessage: string
  description: string
  estimatedTime: string
}

interface ProcessingScreenProps {
  topic: string
  progress?: GenerationProgress | null
  isConnected?: boolean
  error?: string | null
  paperType?: string
  selectedPapers?: number
}

export function ProcessingScreen({
  topic,
  progress,
  isConnected = false,
  error,
  paperType = "Research Article",
  selectedPapers = 0,
}: ProcessingScreenProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [displayProgress, setDisplayProgress] = useState(0)
  const [displayMessage, setDisplayMessage] = useState("Initializing...")
  const [startTime] = useState(Date.now())
  const [elapsedTime, setElapsedTime] = useState(0)
  const [showDetails, setShowDetails] = useState(false)

  // Enhanced steps with more detailed information
  const steps: Step[] = useMemo(
    () => [
      {
        stage: "ui_analyzing",
        message: "Analyzing your research topic...",
        icon: Brain,
        fallbackMessage: "Analyzing research topic",
        description: "Understanding scope, keywords, and research objectives",
        estimatedTime: "10-15s",
      },
      {
        stage: "searching",
        message: "Searching academic databases...",
        icon: Search,
        fallbackMessage: "Finding relevant papers",
        description: "Querying multiple academic databases and repositories",
        estimatedTime: "30-45s",
      },
      {
        stage: "evaluating",
        message: "Evaluating and ranking sources...",
        icon: FileText,
        fallbackMessage: "Selecting best sources",
        description: "Analyzing relevance, quality, and citation impact",
        estimatedTime: "20-30s",
      },
      {
        stage: "writing",
        message: "Generating content with AI...",
        icon: Quote,
        fallbackMessage: "Writing your paper",
        description: "Creating structured content with proper academic flow",
        estimatedTime: "60-90s",
      },
      {
        stage: "citations",
        message: "Adding citations and references...",
        icon: CheckCircle,
        fallbackMessage: "Formatting citations",
        description: "Generating proper citations and bibliography",
        estimatedTime: "15-20s",
      },
      {
        stage: "complete",
        message: "Finalizing your paper...",
        icon: Sparkles,
        fallbackMessage: "Completing generation",
        description: "Final formatting and quality checks",
        estimatedTime: "5-10s",
      },
    ],
    [],
  )

  // Timer for elapsed time
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [startTime])

  // Progress and step management (simplified from original)
  useEffect(() => {
    if (error) return

    if (!isConnected) {
      setCurrentStep(0)
      setDisplayProgress(0)
      setDisplayMessage("Connecting to generation service...")
      return
    }

    if (progress) {
      const { stage: backendStageName, progress: progressValue, message: backendStageMessage } = progress
      const matchedStep = steps.find((step) => step.stage === backendStageName)

      if (matchedStep) {
        const targetStepIndex = steps.indexOf(matchedStep)
        setCurrentStep(targetStepIndex)
        setDisplayMessage(backendStageMessage || matchedStep.message)
      }

      setDisplayProgress(Math.min(progressValue || 0, 100))
    } else {
      setCurrentStep(0)
      setDisplayProgress(0)
      setDisplayMessage(steps[0]?.message || "Analyzing your research topic...")
    }
  }, [steps, progress, isConnected, error])

  // Fallback simulation (simplified)
  useEffect(() => {
    if (!progress && !error && isConnected) {
      const interval = setInterval(() => {
        setDisplayProgress((prev) => {
          if (prev >= 95) return prev
          const increment = Math.random() * 3 + 1
          const newProgress = Math.min(prev + increment, 95)

          // Update step based on progress
          if (newProgress >= 15 && currentStep < 1) setCurrentStep(1)
          else if (newProgress >= 35 && currentStep < 2) setCurrentStep(2)
          else if (newProgress >= 65 && currentStep < 3) setCurrentStep(3)
          else if (newProgress >= 85 && currentStep < 4) setCurrentStep(4)

          return newProgress
        })
      }, 800)

      return () => clearInterval(interval)
    }
  }, [progress, error, isConnected, currentStep])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const estimatedTotal = useMemo(() => {
    const baseTime = selectedPapers > 0 ? 120 : 180 // 2-3 minutes
    const topicComplexity = topic.length > 100 ? 1.2 : 1
    return Math.round(baseTime * topicComplexity)
  }, [topic, selectedPapers])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4">
        <Card className="w-full max-w-md border-red-200">
          <CardContent className="pt-6 text-center space-y-4">
            <div className="p-3 rounded-full bg-red-100 w-fit mx-auto">
              <Sparkles className="h-6 w-6 text-red-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-red-600 mb-2">Generation Failed</h2>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4">
      <div className="w-full max-w-2xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-2 text-xl font-bold">
            <div className="p-2 rounded-full bg-primary/10">
              <Sparkles className="h-6 w-6 text-primary animate-pulse" />
            </div>
            <span>GenPaper</span>
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">Generating Your Paper</h1>
            <p className="text-muted-foreground text-sm max-w-md mx-auto line-clamp-2">{topic}</p>
          </div>
        </div>

        {/* Main Progress Card */}
        <Card>
          <CardContent className="pt-6 space-y-6">
            {/* Progress Bar with Percentage */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{displayMessage}</span>
                <span className="text-muted-foreground">{Math.round(displayProgress)}%</span>
              </div>
              <Progress value={displayProgress} className="h-2" />
            </div>

            {/* Time and Status Info */}
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span>{formatTime(elapsedTime)} elapsed</span>
                </div>
                <div className="flex items-center gap-1">
                  <Zap className="h-4 w-4 text-muted-foreground" />
                  <span>~{formatTime(estimatedTotal)} total</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500" : "bg-orange-500"}`} />
                <span className="text-xs text-muted-foreground">{isConnected ? "Connected" : "Connecting..."}</span>
              </div>
            </div>

            <Separator />

            {/* Steps */}
            <div className="space-y-3">
              {steps.map((step, index) => {
                const StepIcon = step.icon
                const isActive = index === currentStep
                const isComplete = index < currentStep
                const isCurrent = index === currentStep

                return (
                  <div
                    key={index}
                    className={`flex items-center gap-3 p-2 rounded-lg transition-all duration-300 ${
                      isActive ? "bg-primary/5 border border-primary/20" : ""
                    }`}
                  >
                    <div
                      className={`p-2 rounded-full transition-all ${
                        isComplete ? "bg-green-100" : isActive ? "bg-primary/20 animate-pulse" : "bg-muted"
                      }`}
                    >
                      <StepIcon
                        className={`h-4 w-4 ${
                          isComplete ? "text-green-600" : isActive ? "text-primary" : "text-muted-foreground"
                        }`}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-sm font-medium ${
                            isActive
                              ? "text-foreground"
                              : isComplete
                                ? "text-muted-foreground"
                                : "text-muted-foreground/70"
                          }`}
                        >
                          {step.fallbackMessage}
                        </span>

                        <div className="flex items-center gap-2">
                          {isComplete && <CheckCircle className="h-4 w-4 text-green-600" />}
                          {isCurrent && (
                            <Badge variant="secondary" className="text-xs">
                              {step.estimatedTime}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {showDetails && <p className="text-xs text-muted-foreground mt-1">{step.description}</p>}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Toggle Details */}
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="text-xs text-primary hover:underline mx-auto block"
            >
              {showDetails ? "Hide details" : "Show details"}
            </button>
          </CardContent>
        </Card>

        {/* Paper Info */}
        <Card className="bg-muted/50">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span>{paperType}</span>
                </div>
                {selectedPapers > 0 && (
                  <div className="flex items-center gap-1">
                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                    <span>{selectedPapers} library papers</span>
                  </div>
                )}
              </div>

              <div className="text-xs text-muted-foreground">
                Step {currentStep + 1} of {steps.length}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center space-y-2 text-xs text-muted-foreground">
          <p>Please keep this window open while your paper is being generated.</p>
          <p>Generation time varies based on topic complexity and source availability.</p>
        </div>
      </div>
    </div>
  )
}
