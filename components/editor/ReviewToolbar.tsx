'use client'

import { useEffect } from 'react'
import { Check, RotateCcw, Minimize2, Maximize2, FileEdit } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ReviewToolbarProps {
  pendingCount: number
  failedCount?: number
  onAcceptAll: () => void
  onRejectAll: () => void
  isMinimized?: boolean
  onToggleMinimize?: () => void
}

export function ReviewToolbar({
  pendingCount,
  failedCount = 0,
  onAcceptAll,
  onRejectAll,
  isMinimized = false,
  onToggleMinimize,
}: ReviewToolbarProps) {
  useEffect(() => {
    if (pendingCount === 0) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTypingTarget = !!target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )
      if (isTypingTarget) return

      if (event.key === 'Enter') {
        event.preventDefault()
        onAcceptAll()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        onRejectAll()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pendingCount, onAcceptAll, onRejectAll])

  if (pendingCount === 0) return null

  if (isMinimized) {
    return (
      <div 
        className={cn(
          'sticky top-3 z-20 mx-3 mt-3 flex items-center',
          'rounded-xl border border-border/60 bg-background/95 px-3 py-2 shadow-sm backdrop-blur',
          'animate-in slide-in-from-top duration-200'
        )}
      >
        <button
          onClick={onToggleMinimize}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <FileEdit className="h-3.5 w-3.5" />
          <span className="font-medium text-foreground">
            {pendingCount} AI change{pendingCount !== 1 ? 's' : ''} pending review
          </span>
          <Maximize2 className="h-3 w-3 ml-0.5" />
        </button>
      </div>
    )
  }

  return (
    <div 
      className={cn(
        'sticky top-3 z-20 mx-3 mt-3 flex items-center justify-between gap-3',
        'rounded-xl border border-border/60 bg-background/95 px-3 py-2.5 shadow-sm backdrop-blur',
        'animate-in slide-in-from-top duration-200'
      )}
      role="toolbar"
      aria-label="Change review toolbar"
    >
      <div className="min-w-0 flex items-start gap-2">
        <div className="mt-0.5 rounded-lg border border-border/50 bg-muted/40 p-1.5">
          <FileEdit className="h-3.5 w-3.5 text-foreground/80" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground">
            {pendingCount} AI change{pendingCount !== 1 ? 's' : ''} ready to review
            {failedCount > 0 && (
              <span className="text-destructive/80 ml-1">({failedCount} failed)</span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Review the inline change{pendingCount !== 1 ? 's' : ''} in the document. Press Enter to accept or Esc to undo.
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {onToggleMinimize && (
          <button
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
            onClick={onToggleMinimize}
            aria-label="Minimize toolbar"
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </button>
        )}

        <button
          onClick={onRejectAll}
          className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:border-border hover:text-foreground transition-colors cursor-pointer"
        >
          <RotateCcw className="h-3 w-3" />
          Undo
        </button>

        <button
          onClick={onAcceptAll}
          className="inline-flex items-center gap-1 rounded-lg bg-foreground px-2.5 py-1.5 text-xs font-medium text-background hover:opacity-90 transition-opacity cursor-pointer"
        >
          <Check className="h-3 w-3" />
          Accept changes
        </button>
      </div>
    </div>
  )
}

export default ReviewToolbar
