"use client"

import type React from "react"
import { useEffect, useRef, useMemo, memo, useState } from "react"
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
  search: <Search className="h-3.5 w-3.5" />,
  outline: <FileText className="h-3.5 w-3.5" />,
  context: <BookOpen className="h-3.5 w-3.5" />,
  generation: <Sparkles className="h-3.5 w-3.5" />,
  quality: <CheckCircle2 className="h-3.5 w-3.5" />,
  saving: <Loader2 className="h-3.5 w-3.5" />,
}

// =============================================================================
// SKELETON COMPONENTS
// =============================================================================

function ShimmerBar({ className, delay = 0 }: { className?: string; delay?: number }) {
  return (
    <div 
      className={cn(
        "rounded-md bg-linear-to-r from-muted via-muted/60 to-muted bg-size-[200%_100%] animate-shimmer",
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

      <div className="h-px bg-border/30" />

      {/* Section skeletons */}
      {sections.map((section, sectionIndex) => {
        const isActive = sectionIndex === activeIndex
        const isComplete = activeIndex > -1 && sectionIndex < activeIndex
        
        return (
          <div 
            key={section.name} 
            className={cn(
              "space-y-3 p-4 rounded-xl transition-all duration-500",
              isActive && "bg-foreground/3 ring-1 ring-foreground/10",
              isComplete && "opacity-60"
            )}
          >
            {/* Section heading */}
            <div className="flex items-center gap-2">
              {isComplete ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              ) : isActive ? (
                <Loader2 className="h-3.5 w-3.5 text-foreground/60 animate-spin shrink-0" />
              ) : (
                <div className="h-3.5 w-3.5 rounded-full border-2 border-border/40 shrink-0" />
              )}
              <ShimmerBar 
                className={cn(
                  "h-5 w-32",
                  isActive && "bg-linear-to-r from-foreground/10 via-foreground/5 to-foreground/10"
                )} 
                delay={sectionIndex * 50} 
              />
              {isActive && (
                <span className="text-[10px] text-muted-foreground font-medium ml-auto uppercase tracking-wide">
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
        <h1 key={i} className="font-instrument text-xl tracking-tight mt-4 mb-2 first:mt-0 text-foreground">
          {trimmed.slice(2)}
        </h1>
      )
    }
    
    // H2
    if (trimmed.startsWith('## ')) {
      return (
        <h2 key={i} className="font-instrument text-lg tracking-tight mt-3 mb-2 text-foreground">
          {trimmed.slice(3)}
        </h2>
      )
    }
    
    // H3
    if (trimmed.startsWith('### ')) {
      return (
        <h3 key={i} className="font-instrument text-base tracking-tight mt-2 mb-1 text-foreground">
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
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
        <h2 className="font-instrument text-base tracking-tight text-foreground">{section.title}</h2>
      </div>
      <div className="pl-6 border-l-2 border-emerald-500/20">
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
  useEffect(() => {
    const currentTrigger = { 
      sectionsCount: completedSections.length, 
      hasContent: currentSectionContent.length > 0 
    }
    
    const shouldScroll = 
      currentTrigger.sectionsCount !== lastScrollTriggerRef.current.sectionsCount ||
      (currentTrigger.hasContent && !lastScrollTriggerRef.current.hasContent)
    
    lastScrollTriggerRef.current = currentTrigger
    
    if (!shouldScroll) return
    
    if (scrollRafRef.current) {
      cancelAnimationFrame(scrollRafRef.current)
    }
    
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
          <div className="flex items-center gap-2 text-foreground/70">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            <h2 className="font-instrument text-base tracking-tight">Writing: {currentSection}</h2>
          </div>
          <div className="pl-6 border-l-2 border-foreground/15">
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
  return (
    <div className="flex flex-col h-full p-4 md:p-6 space-y-3 md:space-y-5">
      {/* Header */}
      <div className="space-y-1">
        <h2 className="font-instrument text-lg tracking-tight">Generating Paper</h2>
        <p className="text-xs text-muted-foreground line-clamp-2">{topic}</p>
      </div>

      {/* Current status */}
      <div className={cn(
        "flex items-start gap-3 p-3.5 rounded-xl border",
        error ? "bg-destructive/5 border-destructive/20" : "bg-muted/30 border-border/30"
      )}>
        {error ? (
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
        ) : progress >= 100 ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
        ) : (
          <Loader2 className="h-4 w-4 text-muted-foreground animate-spin shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <p className={cn(
            "text-sm",
            error ? "text-destructive" : "text-foreground"
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
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileStack className="h-3.5 w-3.5" />
          <span>
            {papersFound} source{papersFound !== 1 ? 's' : ''} found
          </span>
        </div>
      )}

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{timeEstimate}</span>
          <span className="font-medium text-foreground tabular-nums">{Math.round(progress)}%</span>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>

      {/* Stage list */}
      <div className="space-y-0.5 overflow-y-auto">
        {stages.map((stage) => (
          <div
            key={stage.id}
            className={cn(
              "flex items-center gap-3 py-2 px-3 rounded-lg text-xs transition-all",
              stage.status === "active" && "bg-foreground/5 text-foreground",
              stage.status === "complete" && "text-muted-foreground",
              stage.status === "pending" && "text-muted-foreground/50",
              stage.status === "error" && "text-destructive bg-destructive/5"
            )}
          >
            <div className="shrink-0 w-4 flex items-center justify-center">
              {stage.status === "complete" ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : stage.status === "error" ? (
                <XCircle className="h-3.5 w-3.5" />
              ) : stage.status === "active" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
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
      <div className="flex gap-2 pt-2 md:pt-3 border-t border-border/30 mt-auto">
        {error ? (
          <>
            <button
              onClick={onCancel}
              className="flex-1 h-9 rounded-full border border-border/40 text-xs text-muted-foreground hover:text-foreground hover:border-border/60 transition-colors"
            >
              Go Back
            </button>
            <button
              onClick={onRetry}
              className="flex-1 h-9 rounded-full bg-foreground/80 text-background text-xs font-medium hover:bg-foreground transition-colors"
            >
              Retry
            </button>
          </>
        ) : (
          onCancel && progress < 100 && (
            <button 
              onClick={onCancel} 
              className="w-full h-9 rounded-full text-xs text-muted-foreground hover:text-foreground transition-colors inline-flex items-center justify-center gap-1.5"
            >
              <X className="h-3 w-3" />
              Cancel
            </button>
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
    <div className="absolute inset-0 z-50 bg-background/98 backdrop-blur-sm flex items-center justify-center p-2 md:p-4">
      <div className="w-full max-w-5xl h-[min(70vh,550px)] md:h-[min(85vh,700px)] bg-card border border-border/40 rounded-2xl shadow-2xl overflow-hidden">
        <div className="h-full flex flex-col md:flex-row">
          {/* Left: Paper Preview or Skeleton */}
          <div className="flex-1 border-b md:border-b-0 md:border-r border-border/30 overflow-hidden bg-muted/20">
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
          <div className="w-full md:w-80 lg:w-96 shrink-0 bg-background overflow-y-auto">
            <StatusPanel {...props} />
          </div>
        </div>
      </div>
    </div>
  )
}
