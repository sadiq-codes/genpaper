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
          <span>{pendingCount} change{pendingCount !== 1 ? 's' : ''} pending review</span>
          <Maximize2 className="h-2.5 w-2.5 ml-0.5" />
        </button>
      </div>
    )
  }

  return (
    <div 
      className={cn(
        'sticky top-0 z-20 flex items-center justify-between gap-3',
        'px-3 py-1.5 bg-background border-b border-border/30',
        'animate-in slide-in-from-top duration-200'
      )}
      role="toolbar"
      aria-label="Change review toolbar"
    >
      <div className="flex items-center gap-1.5">
        <FileEdit className="h-3 w-3 text-muted-foreground" />
        <span className="text-[11px] font-medium text-muted-foreground">
          {pendingCount} edit{pendingCount !== 1 ? 's' : ''} applied
          {failedCount > 0 && (
            <span className="text-destructive/70 ml-1">({failedCount} failed)</span>
          )}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {onToggleMinimize && (
          <button
            className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            onClick={onToggleMinimize}
            aria-label="Minimize toolbar"
          >
            <Minimize2 className="h-3 w-3" />
          </button>
        )}

        <button
          onClick={onRejectAll}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-0.5"
        >
          <RotateCcw className="h-2.5 w-2.5" />
          Undo All
        </button>

        <button
          onClick={onAcceptAll}
          className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline transition-colors cursor-pointer flex items-center gap-0.5"
        >
          <Check className="h-2.5 w-2.5" />
          Keep
        </button>
      </div>
    </div>
  )
}

export default ReviewToolbar
