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

  // Minimized view
  if (isMinimized) {
    return (
      <div 
        className={cn(
          'sticky top-0 z-20 flex items-center',
          'px-3 py-1.5 bg-background/95 backdrop-blur-sm border-b border-border/40',
          'animate-in slide-in-from-top duration-200'
        )}
      >
        <button
          onClick={onToggleMinimize}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <FileEdit className="h-3.5 w-3.5" />
          <span>{pendingCount} edit{pendingCount !== 1 ? 's' : ''} pending</span>
          <Maximize2 className="h-3 w-3 ml-0.5" />
        </button>
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div 
        className={cn(
          'sticky top-0 z-20 flex items-center justify-between gap-3',
          'px-3 py-1.5 bg-background/95 backdrop-blur-sm border-b border-border/40',
          'animate-in slide-in-from-top duration-200'
        )}
        role="toolbar"
        aria-label="Edit review toolbar"
      >
        {/* Left: Edit counter and navigation */}
        <div className="flex items-center gap-2">
          {/* Badge */}
          <div className="flex items-center gap-1.5">
            <FileEdit className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">
              {pendingCount} edit{pendingCount !== 1 ? 's' : ''} pending
            </span>
          </div>

          {/* Navigation */}
          {pendingCount > 1 && (
            <div className="flex items-center gap-0.5 ml-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground"
                    onClick={() => onNavigate('prev')}
                    aria-label="Previous edit"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Previous (Shift+Tab)</TooltipContent>
              </Tooltip>
              
              <span className="text-xs text-muted-foreground min-w-[40px] text-center">
                {currentIndex} of {pendingCount}
              </span>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground"
                    onClick={() => onNavigate('next')}
                    aria-label="Next edit"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Next (Tab)</TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-3">
          {/* Keyboard hints */}
          <Tooltip open={showKeyboardHints} onOpenChange={setShowKeyboardHints}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                aria-label="Keyboard shortcuts"
              >
                <Keyboard className="h-3.5 w-3.5" />
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
                  className="h-7 w-7 text-muted-foreground"
                  onClick={onToggleMinimize}
                  aria-label="Minimize toolbar"
                >
                  <Minimize2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Minimize</TooltipContent>
            </Tooltip>
          )}

          {/* Batch actions — text links matching diff block style */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onRejectAll}
                className="text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors cursor-pointer"
              >
                <X className="h-3 w-3 inline mr-0.5 -mt-px" />
                Reject All
              </button>
            </TooltipTrigger>
            <TooltipContent>Cmd+Shift+R</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onAcceptAll}
                className="text-xs text-green-600 dark:text-green-400 hover:underline transition-colors cursor-pointer"
              >
                <Check className="h-3 w-3 inline mr-0.5 -mt-px" />
                Accept All
              </button>
            </TooltipTrigger>
            <TooltipContent>Cmd+Shift+A</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  )
}

export default ReviewToolbar
