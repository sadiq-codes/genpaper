'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { 
  Check, 
  X, 
  ChevronLeft, 
  ChevronRight,
  Keyboard,
  Minimize2,
  Maximize2,
  FileEdit
} from 'lucide-react'
import { cn } from '@/lib/utils'

// =============================================================================
// TYPES
// =============================================================================

export interface ReviewToolbarProps {
  /** Total number of pending edits */
  pendingCount: number
  /** Current active edit index (1-based) */
  currentIndex: number
  /** Navigate to prev/next edit */
  onNavigate: (direction: 'next' | 'prev') => void
  /** Accept all pending edits */
  onAcceptAll: () => void
  /** Reject all pending edits */
  onRejectAll: () => void
  /** Whether toolbar is minimized */
  isMinimized?: boolean
  /** Toggle minimized state */
  onToggleMinimize?: () => void
}

// =============================================================================
// KEYBOARD HINTS
// =============================================================================

function KeyboardHints() {
  return (
    <div className="text-xs space-y-1.5 p-1">
      <div className="font-medium text-foreground mb-2">Keyboard Shortcuts</div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <kbd className="px-1.5 py-0.5 bg-muted rounded font-mono text-[10px]">Tab</kbd>
        <span>Next edit</span>
      </div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <kbd className="px-1.5 py-0.5 bg-muted rounded font-mono text-[10px]">Shift+Tab</kbd>
        <span>Previous edit</span>
      </div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <kbd className="px-1.5 py-0.5 bg-muted rounded font-mono text-[10px]">Enter</kbd>
        <span>Accept current</span>
      </div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <kbd className="px-1.5 py-0.5 bg-muted rounded font-mono text-[10px]">Esc</kbd>
        <span>Reject current</span>
      </div>
      <div className="border-t border-border mt-2 pt-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          <kbd className="px-1.5 py-0.5 bg-muted rounded font-mono text-[10px]">Cmd+Shift+A</kbd>
          <span>Accept all</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground mt-1">
          <kbd className="px-1.5 py-0.5 bg-muted rounded font-mono text-[10px]">Cmd+Shift+R</kbd>
          <span>Reject all</span>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ReviewToolbar({
  pendingCount,
  currentIndex,
  onNavigate,
  onAcceptAll,
  onRejectAll,
  isMinimized = false,
  onToggleMinimize,
}: ReviewToolbarProps) {
  const [showKeyboardHints, setShowKeyboardHints] = useState(false)

  if (pendingCount === 0) return null

  // Minimized view - just a badge
  if (isMinimized) {
    return (
      <div 
        className={cn(
          'sticky top-0 z-20 flex items-center justify-between',
          'px-4 py-2 bg-background/95 backdrop-blur-sm border-b',
          'animate-in slide-in-from-top duration-200'
        )}
      >
        <button
          onClick={onToggleMinimize}
          className="flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
        >
          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10">
            <FileEdit className="h-3.5 w-3.5 text-primary" />
          </div>
          <span>{pendingCount} edit{pendingCount !== 1 ? 's' : ''} pending</span>
          <Maximize2 className="h-3.5 w-3.5 ml-1" />
        </button>
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div 
        className={cn(
          'sticky top-0 z-20 flex items-center justify-between gap-4',
          'px-4 py-2.5 bg-background/95 backdrop-blur-sm border-b shadow-sm',
          'animate-in slide-in-from-top duration-300'
        )}
        role="toolbar"
        aria-label="Edit review toolbar"
      >
        {/* Left: Edit counter and navigation */}
        <div className="flex items-center gap-3">
          {/* Badge */}
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/10">
              <FileEdit className="h-4 w-4 text-primary" />
            </div>
            <span className="text-sm font-semibold text-foreground">
              {pendingCount} edit{pendingCount !== 1 ? 's' : ''} pending
            </span>
          </div>

          {/* Navigation */}
          {pendingCount > 1 && (
            <div className="flex items-center gap-1 ml-2 pl-3 border-l border-border">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onNavigate('prev')}
                    aria-label="Previous edit"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Previous (Shift+Tab)</TooltipContent>
              </Tooltip>
              
              <span className="text-sm text-muted-foreground font-medium min-w-[50px] text-center">
                {currentIndex} of {pendingCount}
              </span>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onNavigate('next')}
                    aria-label="Next edit"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Next (Tab)</TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {/* Keyboard hints */}
          <Tooltip open={showKeyboardHints} onOpenChange={setShowKeyboardHints}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Keyboard shortcuts"
              >
                <Keyboard className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end" className="w-56">
              <KeyboardHints />
            </TooltipContent>
          </Tooltip>

          {/* Minimize button */}
          {onToggleMinimize && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={onToggleMinimize}
                  aria-label="Minimize toolbar"
                >
                  <Minimize2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Minimize</TooltipContent>
            </Tooltip>
          )}

          {/* Batch actions */}
          <div className="flex items-center gap-2 ml-2 pl-3 border-l border-border">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRejectAll}
                  className={cn(
                    'h-9 font-medium',
                    'border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700',
                    'dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/50'
                  )}
                >
                  <X className="h-4 w-4 mr-1.5" />
                  Reject All
                </Button>
              </TooltipTrigger>
              <TooltipContent>Cmd+Shift+R</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  onClick={onAcceptAll}
                  className={cn(
                    'h-9 font-medium',
                    'bg-green-600 text-white hover:bg-green-700',
                    'dark:bg-green-700 dark:hover:bg-green-600'
                  )}
                >
                  <Check className="h-4 w-4 mr-1.5" />
                  Accept All
                </Button>
              </TooltipTrigger>
              <TooltipContent>Cmd+Shift+A</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}

export default ReviewToolbar
