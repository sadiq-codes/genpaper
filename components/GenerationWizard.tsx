'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { 
  ArrowLeft, 
  ArrowRight, 
  FileText, 
  BookOpen, 
  Settings,
  Zap,
  Edit3,
  Check
} from 'lucide-react'
import TopicInputStep from './wizard/TopicInputStep'
import PaperTypeStep from './wizard/PaperTypeStep'
import LibrarySelectionStep from './wizard/LibrarySelectionStep'
import GenerationOptionsStep from './wizard/GenerationOptionsStep'
import { LoadingSpinner } from '@/components/ui/loading-spinner'

export interface WizardState {
  topic: string
  paperType: 'researchArticle' | 'literatureReview' | 'capstoneProject' | 'mastersThesis' | 'phdDissertation'
  selectedPapers: string[]
  useLibraryOnly: boolean
  generationMode: 'quick' | 'editor'
}

const initialState: WizardState = {
  topic: '',
  paperType: 'researchArticle',
  selectedPapers: [],
  useLibraryOnly: false,
  generationMode: 'quick'
}

interface Step {
  id: string
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  component: React.ComponentType<{ state: WizardState; onUpdate: (updates: Partial<WizardState>) => void }>
  isValid: (state: WizardState) => boolean
}

interface GenerationWizardProps {
  className?: string
  onComplete?: (state: WizardState) => void
  initialStep?: number
}

export default function GenerationWizard({ 
  className, 
  onComplete,
  initialStep = 0 
}: GenerationWizardProps) {
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState(initialStep)
  const [wizardState, setWizardState] = useState<WizardState>(initialState)
  const [isGenerating, setIsGenerating] = useState(false)

  const steps: Step[] = [
    {
      id: 'topic',
      title: 'Research Topic',
      description: 'What do you want to research?',
      icon: FileText,
      component: TopicInputStep,
      isValid: (state) => state.topic.trim().length > 10
    },
    {
      id: 'type',
      title: 'Paper Type',
      description: 'Choose your paper format',
      icon: Settings,
      component: PaperTypeStep,
      isValid: (state) => Boolean(state.paperType)
    },
    {
      id: 'library',
      title: 'Source Selection',
      description: 'Select papers from your library',
      icon: BookOpen,
      component: LibrarySelectionStep,
      isValid: () => true // Optional step
    },
    {
      id: 'options',
      title: 'Generation Options',
      description: 'Choose how to generate your paper',
      icon: Zap,
      component: GenerationOptionsStep,
      isValid: (state) => Boolean(state.generationMode)
    }
  ]

  const currentStepData = steps[currentStep]
  const isLastStep = currentStep === steps.length - 1
  const canProceed = currentStepData?.isValid(wizardState) ?? false
  const completedSteps = steps.slice(0, currentStep).filter(step => step.isValid(wizardState)).length
  const progressPercentage = ((completedSteps + (canProceed ? 1 : 0)) / steps.length) * 100

  const updateWizardState = useCallback((updates: Partial<WizardState>) => {
    setWizardState(prev => ({ ...prev, ...updates }))
  }, [])

  // Determine paper length based on paper type
  const getPaperLength = (paperType: WizardState['paperType']): 'short' | 'medium' | 'long' => {
    switch (paperType) {
      case 'capstoneProject':
        return 'short'
      case 'researchArticle':
        return 'medium'
      case 'literatureReview':
      case 'mastersThesis':
      case 'phdDissertation':
        return 'long'
      default:
        return 'medium'
    }
  }

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true)
    
    try {
      if (wizardState.generationMode === 'quick') {
        // Quick generation flow - go directly to processing (skip outline review)
        const params = new URLSearchParams({
          topic: wizardState.topic.trim(),
          length: getPaperLength(wizardState.paperType),
          paperType: wizardState.paperType,
          useLibraryOnly: wizardState.useLibraryOnly.toString(),
          selectedPapers: wizardState.selectedPapers.join(',')
        })
        
        router.push(`/generate/processing?${params.toString()}`)
      } else {
        // Editor flow - go directly to editor
        const params = new URLSearchParams({
          topic: wizardState.topic.trim(),
          paperType: wizardState.paperType,
          selectedPapers: wizardState.selectedPapers.join(','),
          mode: 'guided'
        })
        
        router.push(`/generate/editor?${params.toString()}`)
      }
      
      onComplete?.(wizardState)
    } catch (error) {
      console.error('Generation failed:', error)
    } finally {
      setIsGenerating(false)
    }
  }, [wizardState, router, onComplete, getPaperLength])

  const handleNext = useCallback(() => {
    if (canProceed && currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1)
    } else if (isLastStep && canProceed) {
      handleGenerate()
    }
  }, [canProceed, currentStep, steps.length, isLastStep, handleGenerate])

  const handlePrevious = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1)
    }
  }, [currentStep])

  const handleStepClick = useCallback((stepIndex: number) => {
    // Only allow clicking on previous steps or the next valid step
    if (stepIndex <= currentStep || stepIndex === currentStep + 1) {
      setCurrentStep(stepIndex)
    }
  }, [currentStep])

  const CurrentStepComponent = currentStepData?.component

  if (isGenerating) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <LoadingSpinner size="lg" text="Starting your paper generation..." />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className={`max-w-5xl mx-auto p-4 ${className}`}>
      {/* Compact Header with Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Generate Research Paper</h1>
            <p className="text-sm text-muted-foreground">
              Step {currentStep + 1} of {steps.length} - {currentStepData?.title}
            </p>
          </div>
          <div className="text-right">
            <div className="text-sm font-medium text-muted-foreground">
              {Math.round(progressPercentage)}% Complete
            </div>
            <Progress value={progressPercentage} className="w-32 h-1.5 mt-1" />
          </div>
        </div>

        {/* Horizontal Step Navigation */}
        <div className="flex items-center justify-center space-x-2 p-1 bg-muted rounded-lg">
          {steps.map((step, index) => {
            const Icon = step.icon
            const isActive = index === currentStep
            const isCompleted = index < currentStep || (index === currentStep && canProceed)
            const isClickable = index <= currentStep || index === currentStep + 1
            
            return (
              <button
                key={step.id}
                onClick={() => handleStepClick(index)}
                disabled={!isClickable}
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                  isActive 
                    ? 'bg-primary text-primary-foreground shadow-sm' 
                    : isCompleted 
                    ? 'bg-green-100 text-green-700 hover:bg-green-200' 
                    : isClickable
                    ? 'hover:bg-background text-muted-foreground'
                    : 'text-muted-foreground/50 cursor-not-allowed'
                }`}
              >
                <div className={`p-1 rounded ${
                  isActive 
                    ? 'bg-primary-foreground/20' 
                    : isCompleted 
                    ? 'bg-green-200'
                    : 'bg-muted'
                }`}>
                  {isCompleted && index !== currentStep ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Icon className="h-3 w-3" />
                  )}
                </div>
                <span className="hidden sm:inline">{step.title}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Main Content Container */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Sidebar with Quick Info */}
        <div className="lg:col-span-1 space-y-3">
          {/* Current Progress Summary */}
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="p-4">
              <h3 className="font-medium text-sm mb-2">Current Progress</h3>
              <div className="space-y-2 text-sm">
                {wizardState.topic && (
                  <div>
                    <span className="text-muted-foreground">Topic:</span>
                    <p className="text-xs font-medium line-clamp-2 mt-1">{wizardState.topic}</p>
                  </div>
                )}
                {wizardState.paperType && (
                  <div>
                    <span className="text-muted-foreground">Type:</span>
                    <Badge variant="outline" className="ml-2 text-xs">
                      {wizardState.paperType.replace(/([A-Z])/g, ' $1').toLowerCase()}
                    </Badge>
                  </div>
                )}
                {wizardState.selectedPapers.length > 0 && (
                  <div>
                    <span className="text-muted-foreground">Papers:</span>
                    <Badge variant="outline" className="ml-2 text-xs">
                      {wizardState.selectedPapers.length} selected
                    </Badge>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Quick Help */}
          <Card>
            <CardContent className="p-4">
              <h3 className="font-medium text-sm mb-2">Tips</h3>
              <div className="text-xs text-muted-foreground space-y-1">
                {currentStep === 0 && (
                  <p>• Be specific about your research topic<br/>• Include relevant keywords</p>
                )}
                {currentStep === 1 && (
                  <p>• Choose the format that matches your needs<br/>• Consider your audience</p>
                )}
                {currentStep === 2 && (
                  <p>• Select papers relevant to your topic<br/>• Use library-only mode for focused research</p>
                )}
                {currentStep === 3 && (
                  <p>• Quick mode: Automated generation<br/>• Editor mode: Manual control</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Step Content */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-1.5 rounded-lg bg-primary/10">
                    {currentStepData && <currentStepData.icon className="h-4 w-4 text-primary" />}
                  </div>
                  <div>
                    <CardTitle className="text-lg">{currentStepData?.title}</CardTitle>
                    <CardDescription className="text-sm">{currentStepData?.description}</CardDescription>
                  </div>
                </div>
                <Badge variant="outline" className="text-xs">
                  Step {currentStep + 1}/{steps.length}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {CurrentStepComponent && (
                <CurrentStepComponent
                  state={wizardState}
                  onUpdate={updateWizardState}
                />
              )}
            </CardContent>
          </Card>

          {/* Fixed Bottom Actions */}
          <div className="flex items-center justify-between mt-4 p-3 bg-background border rounded-lg sticky bottom-4 shadow-sm">
            <Button
              variant="outline"
              onClick={handlePrevious}
              disabled={currentStep === 0}
              className="flex items-center gap-2"
              size="sm"
            >
              <ArrowLeft className="h-4 w-4" />
              Previous
            </Button>
            
            <div className="flex items-center gap-2">
              {wizardState.generationMode === 'editor' && isLastStep && (
                <Badge variant="secondary" className="flex items-center gap-1 text-xs">
                  <Edit3 className="h-3 w-3" />
                  Editor Mode
                </Badge>
              )}
              
              <Button
                onClick={handleNext}
                disabled={!canProceed}
                className="flex items-center gap-2"
                size="sm"
              >
                {isLastStep ? (
                  wizardState.generationMode === 'quick' ? (
                    <>
                      Generate Paper
                      <Zap className="h-4 w-4" />
                    </>
                  ) : (
                    <>
                      Open Editor
                      <Edit3 className="h-4 w-4" />
                    </>
                  )
                ) : (
                  <>
                    Next
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
} 