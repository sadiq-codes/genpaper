"use client"

import { useEffect, useState } from "react"
import { Sparkles, Search, FileText, CheckCircle, Brain, Quote } from "lucide-react"
import { Progress } from "@/components/ui/progress"
import type { GenerationProgress } from "@/types/simplified"

interface Step {
  stage: string;
  message: string;
  icon: React.ElementType;
  fallbackMessage: string;
}

interface ProcessingScreenProps {
  topic: string
  progress?: GenerationProgress | null
  isConnected?: boolean
  error?: string | null
}

export function ProcessingScreen({ 
  topic, 
  progress, 
  isConnected = false, 
  error 
}: ProcessingScreenProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [displayProgress, setDisplayProgress] = useState(0)
  const [displayMessage, setDisplayMessage] = useState("Initializing...")

  // Map backend stages to UI steps, including a UI-specific initial step
  const steps: Step[] = [
    { 
      stage: 'ui_analyzing', // Pseudo-stage for the initial UI analyzing phase
      message: "Analyzing your research topic...", // Main message for this phase
      icon: Brain,
      fallbackMessage: "Analyzing your research topic..." // Text for the step list item
    },
    { 
      stage: 'searching', // Backend stage name
      message: "Analyzing your research topic and searching for papers...", // Overall process message for this stage
      icon: Search, // Icon for searching
      fallbackMessage: "Searching academic databases for relevant papers..." // Text for the step list item
    },
    { 
      stage: 'evaluating', // Backend stage name
      message: "Evaluating and selecting the best academic sources...", 
      icon: FileText, // Icon for evaluating
      fallbackMessage: "Evaluating and selecting the best academic sources..." // Text for the step list item
    },
    { 
      stage: 'writing', // Backend stage name
      message: "Generating your research paper with AI assistance...", 
      icon: Quote,
      fallbackMessage: "Generating your research paper with proper citations..." // Text for the step list item
    },
    { 
      stage: 'citations', // Backend stage name
      message: "Adding citations and formatting references...", 
      icon: CheckCircle,
      fallbackMessage: "Adding citations and formatting references..." // Text for the step list item
    },
    { 
      stage: 'complete', // Backend stage name
      message: "Finalizing document structure and formatting...", 
      icon: Sparkles, // Icon for completion
      fallbackMessage: "Finalizing document structure and formatting..." // Text for the step list item
    },
  ]

  // Update step and progress based on backend progress or connection state
  useEffect(() => {
    if (error) {
      // Error state is handled by the error display block, no further action here for progress/steps.
      return;
    }

    if (!isConnected) {
      setCurrentStep(0); // Default to the first step (Analyzing)
      setDisplayProgress(0);
      setDisplayMessage("Connecting to generation service...");
      return;
    }

    // At this point, isConnected is true and no error.
    if (progress) {
      const { stage: backendStageName, progress: progressValue, message: backendStageMessage } = progress;
      
      let targetStepIndex = -1;
      // Find index in our `steps` array that matches the backend stage.
      // The first step (ui_analyzing) is not a backend stage.
      const matchedStep = steps.find(step => step.stage === backendStageName);

      if (matchedStep) {
        targetStepIndex = steps.indexOf(matchedStep);
      }

      if (targetStepIndex !== -1) {
        setCurrentStep(targetStepIndex);
        const currentStepObject = steps[targetStepIndex];
        setDisplayMessage(backendStageMessage || (currentStepObject ? currentStepObject.message : "") || "Processing...");
      } else {
        // If backend stage is unknown or doesn't map, update message but don't change step
        // However, if it's 'complete' and somehow missed, ensure we go to the complete step.
        if (backendStageName === 'complete') {
          const completeStepIdx = steps.findIndex(s => s.stage === 'complete');
          if (completeStepIdx !== -1) setCurrentStep(completeStepIdx);
        }
        setDisplayMessage(backendStageMessage || "Processing...");
      }
      
      setDisplayProgress(Math.min(progressValue || 0, 100));
    } else { 
      // isConnected is true, but no progress object yet (initial "analyzing" phase)
      setCurrentStep(0); // Activate the first step ("Analyzing your research topic...")
      setDisplayProgress(0); 
      const firstStep = steps[0];
      setDisplayMessage(firstStep ? firstStep.message : "Analyzing your research topic..."); 
    }
  }, [progress, isConnected, error]); 

  // Fallback simulation for progress bar and step advancement if backend is silent
  useEffect(() => {
    if (!progress && !error && isConnected) {
      // This simulation runs when connected, no error, and no backend progress signal.
      // `currentStep` should be 0 initially (set by the other useEffect).
      const interval = setInterval(() => {
        setDisplayProgress((prevDisplayProgress) => {
          if (prevDisplayProgress >= 95 && (!progress || (progress && progress.stage !== 'complete'))) {
            return prevDisplayProgress; 
          }
          if (prevDisplayProgress >= 100 && progress && progress.stage === 'complete') {
            return 100;
          }
          
          const newDisplayProgress = prevDisplayProgress + 2;
          
          // Visually advance step if backend is silent.
          // currentStep indices: 0:Analyzing, 1:Searching, 2:Evaluating, 3:Writing, 4:Citations
          // This should not advance to step 5 (Complete) via simulation.
          // The check `currentStep < X` ensures we only advance if not already past that simulated threshold.
          if (newDisplayProgress >= 15 && currentStep < 1) setCurrentStep(1);
          else if (newDisplayProgress >= 35 && currentStep < 2) setCurrentStep(2);
          else if (newDisplayProgress >= 65 && currentStep < 3) setCurrentStep(3);
          else if (newDisplayProgress >= 85 && currentStep < 4) setCurrentStep(4);
          
          return Math.min(newDisplayProgress, 100);
        });
      }, 500);

      return () => clearInterval(interval);
    }
  }, [progress, error, isConnected, currentStep]); // currentStep is a dependency

  // Handle error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4 sm:p-6 lg:p-8">
        <div className="w-full max-w-sm sm:max-w-md md:max-w-lg lg:max-w-xl space-y-6 sm:space-y-8 text-center">
          <div className="flex items-center justify-center gap-2 text-lg sm:text-xl lg:text-2xl font-bold">
            <Sparkles className="h-5 w-5 sm:h-6 sm:w-6 lg:h-7 lg:w-7 text-primary" />
            <span>GenPaper</span>
          </div>
          
          <div className="space-y-2 sm:space-y-3">
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-semibold leading-tight text-red-600">
              Generation Error
            </h1>
            <p className="text-base sm:text-lg lg:text-xl text-muted-foreground px-2 sm:px-4">
              {error}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-sm sm:max-w-md md:max-w-lg lg:max-w-xl space-y-6 sm:space-y-8 text-center">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 text-lg sm:text-xl lg:text-2xl font-bold">
          <Sparkles className="h-5 w-5 sm:h-6 sm:w-6 lg:h-7 lg:w-7 text-primary" />
          <span>GenPaper</span>
        </div>

        {/* Topic */}
        <div className="space-y-2 sm:space-y-3">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-semibold leading-tight">
            Generating Your Paper
          </h1>
          <p className="text-base sm:text-lg lg:text-xl text-muted-foreground px-2 sm:px-4">
            {topic}
          </p>
        </div>

        {/* Connection Status */}
        {!isConnected && !error && (
          <div className="text-sm text-blue-600">
            Connecting to generation service...
          </div>
        )}

        {/* Progress */}
        <div className="space-y-4 sm:space-y-6">
          <Progress value={displayProgress} className="h-2 sm:h-3" />

          {/* Current Status */}
          <div className="text-sm sm:text-base text-muted-foreground">
            {displayMessage}
          </div>

          <div className="space-y-3 sm:space-y-4">
            {steps.map((stepItem: Step, index: number) => {
              const StepIcon = stepItem.icon
              const isActive = index === currentStep
              const isComplete = index < currentStep || 
                               (progress && progress.stage === 'complete' && 
                                displayProgress === 100 && 
                                stepItem.stage === 'complete')

              return (
                <div
                  key={index}
                  className={`flex items-start sm:items-center gap-3 sm:gap-4 transition-all duration-500 ${
                    isActive ? "opacity-100 scale-105" : isComplete ? "opacity-70" : "opacity-30"
                  }`}
                >
                  <div className={`p-2 sm:p-2.5 lg:p-3 rounded-full transition-colors flex-shrink-0 ${
                    isActive ? "bg-primary/20" : isComplete ? "bg-green-100" : "bg-muted"
                  }`}>
                    <StepIcon className={`h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 ${
                      isActive ? "text-primary" : isComplete ? "text-green-600" : "text-muted-foreground"
                    }`} />
                  </div>
                  <span className={`text-left text-sm sm:text-base lg:text-lg transition-all leading-relaxed ${
                    isActive ? "font-medium text-foreground" : isComplete ? "text-muted-foreground" : "text-muted-foreground"
                  }`}>
                    {stepItem.fallbackMessage}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="space-y-2 sm:space-y-3 px-2 sm:px-4">
          <p className="text-sm sm:text-base text-muted-foreground">
            This usually takes 2-4 minutes depending on your topic complexity.
          </p>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Please don&apos;t close this window while your paper is being generated.
          </p>
          
          {/* Real-time connection status */}
          <div className="text-xs text-muted-foreground">
            {isConnected ? (
              <span className="text-green-600">● Connected</span>
            ) : (
              <span className="text-orange-600">● Connecting...</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
