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
  pendingCount: number
  currentIndex: number
  onNavigate: (direction: 'next' | 'prev') => void
  onAcceptAll: () => void
  onRejectAll: () => void
  isMinimized?: boolean
  onToggleMinimize?: () => void
}

// =============================================================================
// KEYBOARD HINTS
// =============================================================================

function KeyboardHints() {
  return (
    <div className="text-xs space-y-1.5 p-1">
      <div className="font-instrument text-sm tracking-tight text-foreground mb-2">Keyboard Shortcuts</div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <kbd className="px-1.5 py-0.5 bg-foreground/5 rounded-md font-mono text-[10px] border border-border/50">Tab</kbd>
        <span>Next edit</span>
      </div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <kbd className="px-1.5 py-0.5 bg-foreground/5 rounded-md font-mono text-[10px] border border-border/50">Shift+Tab</kbd>
        <span>Previous edit</span>
      </div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <kbd className="px-1.5 py-0.5 bg-foreground/5 rounded-md font-mono text-[10px] border border-border/50">Enter</kbd>
        <span>Accept current</span>
      </div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <kbd className="px-1.5 py-0.5 bg-foreground/5 rounded-md font-mono text-[10px] border border-border/50">Esc</kbd>
        <span>Reject current</span>
      </div>
      <div className="border-t border-border/40 mt-2 pt-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          <kbd className="px-1.5 py-0.5 bg-foreground/5 rounded-md font-mono text-[10px] border border-border/50">Cmd+Shift+A</kbd>
          <span>Accept all</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground mt-1">
          <kbd className="px-1.5 py-0.5 bg-foreground/5 rounded-md font-mono text-[10px] border border-border/50">Cmd+Shift+R</kbd>
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
          'px-3 py-1.5 bg-background border-b border-border/30',
          'animate-in slide-in-from-top duration-200'
        )}
      >
        <button
          onClick={onToggleMinimize}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <FileEdit className="h-3 w-3" />
          <span>{pendingCount} edit{pendingCount !== 1 ? 's' : ''} pending</span>
          <Maximize2 className="h-2.5 w-2.5 ml-0.5" />
        </button>
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div 
        className={cn(
          'sticky top-0 z-20 flex items-center justify-between gap-3',
          'px-3 py-1.5 bg-background border-b border-border/30',
          'animate-in slide-in-from-top duration-200'
        )}
        role="toolbar"
        aria-label="Edit review toolbar"
      >
        {/* Left: Counter and navigation */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <FileEdit className="h-3 w-3 text-muted-foreground" />
            <span className="text-[11px] font-medium text-muted-foreground">
              {pendingCount} edit{pendingCount !== 1 ? 's' : ''}
            </span>
          </div>

          {pendingCount > 1 && (
            <div className="flex items-center gap-0.5 ml-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 rounded-full text-muted-foreground"
                    onClick={() => onNavigate('prev')}
                    aria-label="Previous edit"
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Previous (Shift+Tab)</TooltipContent>
              </Tooltip>
              
              <span className="text-[11px] text-muted-foreground min-w-[36px] text-center tabular-nums">
                {currentIndex}/{pendingCount}
              </span>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 rounded-full text-muted-foreground"
                    onClick={() => onNavigate('next')}
                    aria-label="Next edit"
                  >
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Next (Tab)</TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          <Tooltip open={showKeyboardHints} onOpenChange={setShowKeyboardHints}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-full text-muted-foreground"
                aria-label="Keyboard shortcuts"
              >
                <Keyboard className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end" className="w-56">
              <KeyboardHints />
            </TooltipContent>
          </Tooltip>

          {onToggleMinimize && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-full text-muted-foreground"
                  onClick={onToggleMinimize}
                  aria-label="Minimize toolbar"
                >
                  <Minimize2 className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Minimize</TooltipContent>
            </Tooltip>
          )}

          <button
            onClick={onRejectAll}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-0.5"
          >
            <X className="h-2.5 w-2.5" />
            Reject All
          </button>

          <button
            onClick={onAcceptAll}
            className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline transition-colors cursor-pointer flex items-center gap-0.5"
          >
            <Check className="h-2.5 w-2.5" />
            Accept All
          </button>
        </div>
      </div>
    </TooltipProvider>
  )
}

export default ReviewToolbar
