"use client"

import type React from "react"
import { useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { 
  Loader2, 
  Search, 
  FileText, 
  BookOpen, 
  Sparkles, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  X,
  FileStack
} from "lucide-react"
import { cn } from "@/lib/utils"

// =============================================================================
// TYPES
// =============================================================================

export interface ProgressStage {
  id: string
  label: string
  icon: React.ReactNode
  status: "pending" | "active" | "complete" | "error"
  message?: string
}

interface CompletedSection {
  title: string
  content: string
}

interface GenerationLoadingUIProps {
  topic: string
  progress: number
  currentStage: string
  message: string
  stages: ProgressStage[]
  papersFound: number
  currentSection: string | null
  error: string | null
  timeEstimate: string
  generatedContent?: string
  completedSections?: CompletedSection[]
  onCancel?: () => void
  onRetry?: () => void
}

// =============================================================================
// STAGE ICONS
// =============================================================================

const STAGE_ICONS: Record<string, React.ReactNode> = {
  search: <Search className="h-4 w-4" />,
  outline: <FileText className="h-4 w-4" />,
  context: <BookOpen className="h-4 w-4" />,
  generation: <Sparkles className="h-4 w-4" />,
  quality: <CheckCircle2 className="h-4 w-4" />,
  saving: <Loader2 className="h-4 w-4" />,
}

// =============================================================================
// SKELETON COMPONENTS
// =============================================================================

function ShimmerBar({ className, delay = 0 }: { className?: string; delay?: number }) {
  return (
    <div 
      className={cn(
        "rounded-md bg-gradient-to-r from-muted via-muted/60 to-muted bg-[length:200%_100%] animate-shimmer",
        className
      )}
      style={{ animationDelay: `${delay}ms` }}
    />
  )
}

function PaperSkeleton({ currentSection }: { currentSection: string | null }) {
  const sections = [
    { name: "Introduction", lines: 4 },
    { name: "Literature Review", lines: 5 },
    { name: "Methodology", lines: 4 },
    { name: "Results", lines: 3 },
    { name: "Discussion", lines: 4 },
  ]

  const activeIndex = currentSection 
    ? sections.findIndex(s => 
        currentSection.toLowerCase().includes(s.name.toLowerCase()) ||
        s.name.toLowerCase().includes(currentSection.toLowerCase())
      )
    : -1

  return (
    <div className="space-y-6 p-6">
      {/* Title skeleton */}
      <div className="space-y-3">
        <ShimmerBar className="h-7 w-3/4" />
        <ShimmerBar className="h-4 w-1/2" delay={100} />
      </div>

      <div className="h-px bg-border" />

      {/* Section skeletons */}
      {sections.map((section, sectionIndex) => {
        const isActive = sectionIndex === activeIndex
        const isComplete = activeIndex > -1 && sectionIndex < activeIndex
        
        return (
          <div 
            key={section.name} 
            className={cn(
              "space-y-3 p-4 rounded-lg transition-all duration-500",
              isActive && "bg-primary/5 ring-1 ring-primary/20",
              isComplete && "opacity-60"
            )}
          >
            {/* Section heading */}
            <div className="flex items-center gap-2">
              {isComplete ? (
                <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
              ) : isActive ? (
                <Loader2 className="h-4 w-4 text-primary animate-spin flex-shrink-0" />
              ) : (
                <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/20 flex-shrink-0" />
              )}
              <ShimmerBar 
                className={cn(
                  "h-5 w-32",
                  isActive && "bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20"
                )} 
                delay={sectionIndex * 50} 
              />
              {isActive && (
                <span className="text-xs text-primary font-medium ml-auto">
                  Writing...
                </span>
              )}
            </div>
            
            {/* Paragraph lines */}
            <div className="space-y-2 pl-6">
              {Array.from({ length: section.lines }).map((_, lineIndex) => (
                <ShimmerBar
                  key={lineIndex}
                  className={cn(
                    "h-3",
                    lineIndex === section.lines - 1 ? "w-2/3" : 
                    lineIndex % 2 === 0 ? "w-full" : "w-5/6"
                  )}
                  delay={sectionIndex * 50 + lineIndex * 30}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// =============================================================================
// LIVE CONTENT PREVIEW
// =============================================================================

function LiveContentPreview({ 
  content, 
  currentSection,
  completedSections = []
}: { 
  content: string
  currentSection: string | null
  completedSections: CompletedSection[]
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    if (contentEndRef.current) {
      contentEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [content, completedSections.length])

  // Simple markdown rendering for headings and paragraphs
  const renderContent = (text: string) => {
    const lines = text.split('\n')
    return lines.map((line, i) => {
      const trimmed = line.trim()
      
      // Skip empty lines but preserve spacing
      if (!trimmed) {
        return <div key={i} className="h-3" />
      }
      
      // H1
      if (trimmed.startsWith('# ')) {
        return (
          <h1 key={i} className="text-2xl font-bold mt-6 mb-3 first:mt-0 text-foreground">
            {trimmed.slice(2)}
          </h1>
        )
      }
      
      // H2
      if (trimmed.startsWith('## ')) {
        return (
          <h2 key={i} className="text-xl font-semibold mt-5 mb-2 text-foreground flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
            {trimmed.slice(3)}
          </h2>
        )
      }
      
      // H3
      if (trimmed.startsWith('### ')) {
        return (
          <h3 key={i} className="text-lg font-medium mt-4 mb-2 text-foreground">
            {trimmed.slice(4)}
          </h3>
        )
      }
      
      // Regular paragraph
      return (
        <p key={i} className="text-sm text-muted-foreground leading-relaxed mb-2">
          {trimmed}
        </p>
      )
    })
  }

  return (
    <div ref={scrollRef} className="p-6 space-y-2">
      {/* Render completed content */}
      {content && renderContent(content)}
      
      {/* Show current section being written */}
      {currentSection && (
        <div className="mt-4 p-4 rounded-lg bg-primary/5 border border-primary/20">
          <div className="flex items-center gap-2 text-primary">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm font-medium">Writing: {currentSection}...</span>
          </div>
          <div className="mt-3 space-y-2">
            <ShimmerBar className="h-3 w-full" />
            <ShimmerBar className="h-3 w-5/6" delay={50} />
            <ShimmerBar className="h-3 w-4/5" delay={100} />
          </div>
        </div>
      )}
      
      {/* Auto-scroll anchor */}
      <div ref={contentEndRef} />
    </div>
  )
}

// =============================================================================
// STATUS PANEL
// =============================================================================

function StatusPanel({
  topic,
  progress,
  message,
  stages,
  papersFound,
  currentSection,
  error,
  timeEstimate,
  onCancel,
  onRetry,
}: Omit<GenerationLoadingUIProps, 'currentStage' | 'generatedContent' | 'completedSections'>) {
  return (
    <div className="flex flex-col h-full p-6 space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Generating Paper</h2>
        <p className="text-sm text-muted-foreground line-clamp-2">{topic}</p>
      </div>

      {/* Current status with icon */}
      <div className={cn(
        "flex items-start gap-3 p-4 rounded-lg",
        error ? "bg-destructive/10" : "bg-muted/50"
      )}>
        {error ? (
          <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
        ) : progress >= 100 ? (
          <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
        ) : (
          <Loader2 className="h-5 w-5 text-primary animate-spin flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <p className={cn(
            "text-sm font-medium",
            error && "text-destructive"
          )}>
            {error || message}
          </p>
          {currentSection && !error && (
            <p className="text-xs text-muted-foreground mt-1">
              Section: {currentSection}
            </p>
          )}
        </div>
      </div>

      {/* Papers found badge */}
      {papersFound > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <FileStack className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">
            {papersFound} source{papersFound !== 1 ? 's' : ''} found
          </span>
        </div>
      )}

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{timeEstimate}</span>
          <span className="font-semibold text-primary">{Math.round(progress)}%</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      {/* Stage list */}
      <div className="flex-1 space-y-1 overflow-y-auto">
        {stages.map((stage) => (
          <div
            key={stage.id}
            className={cn(
              "flex items-center gap-3 py-2 px-3 rounded-md text-sm transition-all",
              stage.status === "active" && "bg-primary/10 text-primary",
              stage.status === "complete" && "text-muted-foreground",
              stage.status === "pending" && "text-muted-foreground/50",
              stage.status === "error" && "text-destructive bg-destructive/10"
            )}
          >
            <div className="flex-shrink-0 w-5 flex items-center justify-center">
              {stage.status === "complete" ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : stage.status === "error" ? (
                <XCircle className="h-4 w-4" />
              ) : stage.status === "active" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <div className="h-1.5 w-1.5 rounded-full bg-current opacity-40" />
              )}
            </div>
            <span className={cn(
              "flex-1",
              stage.status === "active" && "font-medium"
            )}>
              {stage.label}
            </span>
            {stage.status === "active" && STAGE_ICONS[stage.id]}
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2 border-t">
        {error ? (
          <>
            <Button variant="outline" onClick={onCancel} className="flex-1">
              Go Back
            </Button>
            <Button onClick={onRetry} className="flex-1">
              Retry
            </Button>
          </>
        ) : (
          onCancel && progress < 100 && (
            <Button 
              variant="ghost" 
              onClick={onCancel} 
              className="w-full text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
          )
        )}
      </div>
    </div>
  )
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function GenerationLoadingUI(props: GenerationLoadingUIProps) {
  const { 
    currentStage, 
    currentSection, 
    generatedContent = "", 
    completedSections = [] 
  } = props

  // Show live content when we're in generation stage and have content
  const showLiveContent = currentStage === 'generation' || currentStage === 'quality' || currentStage === 'saving' || currentStage === 'complete'
  const hasContent = generatedContent.length > 0 || completedSections.length > 0

  return (
    <div className="absolute inset-0 z-50 bg-background/98 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-5xl h-[min(85vh,700px)] bg-card border rounded-2xl shadow-2xl overflow-hidden">
        <div className="h-full flex flex-col md:flex-row">
          {/* Left: Paper Preview or Skeleton */}
          <div className="flex-1 border-b md:border-b-0 md:border-r overflow-hidden bg-muted/30">
            <ScrollArea className="h-full">
              {showLiveContent && hasContent ? (
                <LiveContentPreview 
                  content={generatedContent} 
                  currentSection={currentSection}
                  completedSections={completedSections}
                />
              ) : (
                <PaperSkeleton currentSection={currentSection} />
              )}
            </ScrollArea>
          </div>

          {/* Right: Status Panel */}
          <div className="w-full md:w-80 lg:w-96 flex-shrink-0 bg-background overflow-y-auto">
            <StatusPanel {...props} />
          </div>
        </div>
      </div>
    </div>
  )
}
