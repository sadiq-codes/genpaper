"use client"

import { useEffect, useState } from "react"
import { Sparkles, Search, FileText, CheckCircle, Brain, Quote } from "lucide-react"
import { Progress } from "@/components/ui/progress"

interface ProcessingScreenProps {
  topic: string
}

export function ProcessingScreen({ topic }: ProcessingScreenProps) {
  const [progress, setProgress] = useState(0)
  const [currentStep, setCurrentStep] = useState(0)

  const steps = [
    { message: "Analyzing your research topic...", icon: Brain },
    { message: "Searching academic databases for relevant papers...", icon: Search },
    { message: "Evaluating and selecting the best sources...", icon: CheckCircle },
    { message: "Generating your research paper with proper citations...", icon: Quote },
    { message: "Finalizing document structure and formatting...", icon: FileText },
  ]

  useEffect(() => {
    // Simulate progress through the steps
    const interval = setInterval(() => {
      setProgress((prev) => {
        const newProgress = prev + 3

        // Update current step based on progress
        if (newProgress >= 20 && currentStep < 1) setCurrentStep(1)
        if (newProgress >= 40 && currentStep < 2) setCurrentStep(2)
        if (newProgress >= 60 && currentStep < 3) setCurrentStep(3)
        if (newProgress >= 80 && currentStep < 4) setCurrentStep(4)

        return newProgress > 100 ? 100 : newProgress
      })
    }, 200)

    return () => clearInterval(interval)
  }, [currentStep])

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4">
      <div className="w-full max-w-md space-y-8 text-center">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 text-xl font-bold">
          <Sparkles className="h-6 w-6 text-primary" />
          <span>GenPaper</span>
        </div>

        {/* Topic */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Generating Your Paper</h1>
          <p className="text-lg text-muted-foreground">{topic}</p>
        </div>

        {/* Progress */}
        <div className="space-y-6">
          <Progress value={progress} className="h-3" />

          <div className="space-y-4">
            {steps.map((step, index) => {
              const StepIcon = step.icon
              const isActive = index === currentStep
              const isComplete = index < currentStep

              return (
                <div
                  key={index}
                  className={`flex items-center gap-3 transition-all duration-500 ${
                    isActive ? "opacity-100 scale-105" : isComplete ? "opacity-70" : "opacity-30"
                  }`}
                >
                  <div className={`p-2 rounded-full transition-colors ${
                    isActive ? "bg-primary/20" : isComplete ? "bg-green-100" : "bg-muted"
                  }`}>
                    <StepIcon className={`h-5 w-5 ${
                      isActive ? "text-primary" : isComplete ? "text-green-600" : "text-muted-foreground"
                    }`} />
                  </div>
                  <span className={`transition-all ${
                    isActive ? "font-medium text-foreground" : isComplete ? "text-muted-foreground" : "text-muted-foreground"
                  }`}>
                    {step.message}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            This usually takes 2-4 minutes depending on your topic complexity.
          </p>
          <p className="text-xs text-muted-foreground">
            Please don&apos;t close this window while your paper is being generated.
          </p>
        </div>
      </div>
    </div>
  )
}
