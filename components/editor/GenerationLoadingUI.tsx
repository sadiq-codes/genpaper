"use client"

import type React from "react"
import { useEffect, useRef, useMemo, memo, useState } from "react"
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
  FileStack,
  Smartphone
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

export interface CompletedSection {
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
  /** Content of the section currently being written (for live preview) */
  currentSectionContent?: string
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
                <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
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

// Simple markdown rendering for headings and paragraphs - extracted as pure function
function renderMarkdownContent(text: string, isStreaming = false) {
  const lines = text.split('\n')
  return lines.map((line, i) => {
    const trimmed = line.trim()
    
    // Skip empty lines but preserve spacing
    if (!trimmed) {
      return <div key={i} className="h-2" />
    }
    
    // H1
    if (trimmed.startsWith('# ')) {
      return (
        <h1 key={i} className="text-xl font-bold mt-4 mb-2 first:mt-0 text-foreground">
          {trimmed.slice(2)}
        </h1>
      )
    }
    
    // H2
    if (trimmed.startsWith('## ')) {
      return (
        <h2 key={i} className="text-lg font-semibold mt-3 mb-2 text-foreground">
          {trimmed.slice(3)}
        </h2>
      )
    }
    
    // H3
    if (trimmed.startsWith('### ')) {
      return (
        <h3 key={i} className="text-base font-medium mt-2 mb-1 text-foreground">
          {trimmed.slice(4)}
        </h3>
      )
    }
    
    // Regular paragraph
    return (
      <p key={i} className={cn(
        "text-sm leading-relaxed mb-1.5",
        isStreaming ? "text-foreground" : "text-muted-foreground"
      )}>
        {trimmed}
      </p>
    )
  })
}

// Memoized section content renderer - prevents re-rendering completed sections
const MemoizedSectionContent = memo(function MemoizedSectionContent({ 
  content, 
  isStreaming = false 
}: { 
  content: string
  isStreaming?: boolean 
}) {
  return <>{renderMarkdownContent(content, isStreaming)}</>
})

// Memoized completed section - prevents re-render when streaming content changes
const CompletedSectionItem = memo(function CompletedSectionItem({ 
  section 
}: { 
  section: CompletedSection 
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
        <h2 className="text-lg font-semibold text-foreground">{section.title}</h2>
      </div>
      <div className="pl-6 border-l-2 border-success/20">
        <MemoizedSectionContent content={section.content} />
      </div>
    </div>
  )
})

function LiveContentPreview({ 
  currentSection,
  currentSectionContent = "",
  completedSections = []
}: { 
  currentSection: string | null
  currentSectionContent: string
  completedSections: CompletedSection[]
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentEndRef = useRef<HTMLDivElement>(null)
  const scrollRafRef = useRef<number | null>(null)
  const lastScrollTriggerRef = useRef({ sectionsCount: 0, hasContent: false })

  // Throttled auto-scroll using requestAnimationFrame
  // Only scrolls when sections change or content appears (not every character)
  useEffect(() => {
    const currentTrigger = { 
      sectionsCount: completedSections.length, 
      hasContent: currentSectionContent.length > 0 
    }
    
    // Only scroll when section count changes or content first appears
    const shouldScroll = 
      currentTrigger.sectionsCount !== lastScrollTriggerRef.current.sectionsCount ||
      (currentTrigger.hasContent && !lastScrollTriggerRef.current.hasContent)
    
    lastScrollTriggerRef.current = currentTrigger
    
    if (!shouldScroll) return
    
    // Cancel pending scroll
    if (scrollRafRef.current) {
      cancelAnimationFrame(scrollRafRef.current)
    }
    
    // Schedule scroll on next frame
    scrollRafRef.current = requestAnimationFrame(() => {
      if (contentEndRef.current) {
        contentEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
      }
    })
    
    return () => {
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current)
      }
    }
  }, [currentSectionContent.length, completedSections.length])

  // Memoize streaming content render to reduce re-renders
  const streamingContent = useMemo(() => {
    if (!currentSectionContent) return null
    return <MemoizedSectionContent content={currentSectionContent} isStreaming />
  }, [currentSectionContent])

  return (
    <div ref={scrollRef} className="p-6 space-y-4">
      {/* Render completed sections - each is memoized */}
      {completedSections.map((section, idx) => (
        <CompletedSectionItem key={idx} section={section} />
      ))}
      
      {/* Show current section being written */}
      {currentSection && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-primary">
            <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
            <h2 className="text-lg font-semibold">Writing: {currentSection}</h2>
          </div>
          <div className="pl-6 border-l-2 border-primary/30">
            {streamingContent ?? (
              <div className="space-y-2 py-2">
                <ShimmerBar className="h-3 w-full" />
                <ShimmerBar className="h-3 w-5/6" delay={50} />
                <ShimmerBar className="h-3 w-4/5" delay={100} />
                <ShimmerBar className="h-3 w-11/12" delay={150} />
              </div>
            )}
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

// Mobile detection hook
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)
  
  useEffect(() => {
    // Check for mobile via user agent and touch capability
    const checkMobile = () => {
      const userAgent = navigator.userAgent || navigator.vendor
      const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase())
      const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
      const isSmallScreen = window.innerWidth < 768
      
      setIsMobile(isMobileUA || (isTouchDevice && isSmallScreen))
    }
    
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])
  
  return isMobile
}

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
}: Omit<GenerationLoadingUIProps, 'currentStage' | 'currentSectionContent' | 'generatedContent' | 'completedSections'>) {
  const isMobile = useIsMobile()
  const [dismissedWarning, setDismissedWarning] = useState(false)
  
  return (
    <div className="flex flex-col h-full p-6 space-y-6">
      {/* Mobile Warning Banner */}
      {isMobile && !dismissedWarning && !error && progress < 100 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400">
          <Smartphone className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div className="flex-1 text-xs">
            <p className="font-medium">Keep this tab open</p>
            <p className="text-amber-600 dark:text-amber-500 mt-0.5">
              Switching apps may interrupt generation
            </p>
          </div>
          <button 
            onClick={() => setDismissedWarning(true)}
            className="text-amber-600 hover:text-amber-700 dark:text-amber-500"
            aria-label="Dismiss warning"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

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
          <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0 mt-0.5" />
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
                <CheckCircle2 className="h-4 w-4 text-success" />
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
    currentSectionContent = "",
    completedSections = [] 
  } = props

  // Show live content when we're in writing/generation stage and have content or are actively writing
  const isGenerating = currentStage === 'writing' || currentStage === 'generation' || currentStage === 'quality' || currentStage === 'saving' || currentStage === 'complete'
  const hasContent = completedSections.length > 0 || (currentSection && currentSectionContent.length > 0)
  const showLiveContent = isGenerating && (hasContent || currentSection)

  return (
    <div className="absolute inset-0 z-50 bg-background/98 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-5xl h-[min(85vh,700px)] bg-card border rounded-2xl shadow-2xl overflow-hidden">
        <div className="h-full flex flex-col md:flex-row">
          {/* Left: Paper Preview or Skeleton */}
          <div className="flex-1 border-b md:border-b-0 md:border-r overflow-hidden bg-muted/30">
            <ScrollArea className="h-full">
              {showLiveContent ? (
                <LiveContentPreview 
                  currentSection={currentSection}
                  currentSectionContent={currentSectionContent}
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
