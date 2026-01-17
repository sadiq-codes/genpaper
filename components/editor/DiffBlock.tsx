'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { 
  Check, 
  X, 
  Minus, 
  Plus, 
  ArrowLeftRight,
  Maximize2,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import { cn } from '@/lib/utils'

// =============================================================================
// TYPES
// =============================================================================

export interface DiffBlockProps {
  editId: string
  type: 'delete' | 'insert' | 'replace'
  oldContent?: string
  newContent?: string
  sectionLabel?: string
  editNumber: number
  totalEdits: number
  isActive: boolean
  onAccept: () => void
  onReject: () => void
  onNavigateNext?: () => void
  onNavigatePrev?: () => void
  onExpand?: () => void
}

// =============================================================================
// CONSTANTS
// =============================================================================

const MAX_CONTENT_HEIGHT = 200
const LONG_CONTENT_THRESHOLD = 500 // chars

// =============================================================================
// HELPERS
// =============================================================================

function getEditTypeConfig(type: 'delete' | 'insert' | 'replace') {
  switch (type) {
    case 'delete':
      return {
        icon: Minus,
        label: 'Delete',
        borderClass: 'border-red-300 dark:border-red-800',
        headerClass: 'bg-red-50 dark:bg-red-950/30',
        iconClass: 'text-red-600 dark:text-red-400',
      }
    case 'insert':
      return {
        icon: Plus,
        label: 'Insert',
        borderClass: 'border-green-300 dark:border-green-800',
        headerClass: 'bg-green-50 dark:bg-green-950/30',
        iconClass: 'text-green-600 dark:text-green-400',
      }
    case 'replace':
      return {
        icon: ArrowLeftRight,
        label: 'Replace',
        borderClass: 'border-blue-300 dark:border-blue-800',
        headerClass: 'bg-blue-50 dark:bg-blue-950/30',
        iconClass: 'text-blue-600 dark:text-blue-400',
      }
  }
}

function isContentLong(content?: string): boolean {
  return (content?.length || 0) > LONG_CONTENT_THRESHOLD
}

// =============================================================================
// CONTENT DISPLAY COMPONENT
// =============================================================================

function ContentSection({
  content,
  variant,
  isScrollable,
  onExpand,
}: {
  content: string
  variant: 'old' | 'new'
  isScrollable: boolean
  onExpand?: () => void
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)

  useEffect(() => {
    if (contentRef.current) {
      setIsOverflowing(contentRef.current.scrollHeight > MAX_CONTENT_HEIGHT)
    }
  }, [content])

  const isOld = variant === 'old'
  
  return (
    <div
      className={cn(
        'relative',
        isOld 
          ? 'bg-red-50/80 dark:bg-red-950/20 border-b border-dashed border-red-200 dark:border-red-800/50' 
          : 'bg-green-50/80 dark:bg-green-950/20'
      )}
    >
      {/* Label */}
      <div className={cn(
        'px-4 py-1.5 text-xs font-medium border-b',
        isOld 
          ? 'text-red-600 dark:text-red-400 bg-red-100/50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50' 
          : 'text-green-600 dark:text-green-400 bg-green-100/50 dark:bg-green-900/20 border-green-200 dark:border-green-800/50'
      )}>
        <span className="flex items-center gap-1.5">
          {isOld ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          {isOld ? 'Current content (will be removed)' : 'New content (will be added)'}
        </span>
      </div>
      
      {/* Content */}
      <div
        ref={contentRef}
        className={cn(
          'p-4 text-sm leading-relaxed whitespace-pre-wrap',
          isScrollable && 'max-h-[200px] overflow-y-auto',
          isOld 
            ? 'text-red-800 dark:text-red-200 line-through decoration-red-400/60 dark:decoration-red-500/60 decoration-2' 
            : 'text-green-800 dark:text-green-200'
        )}
      >
        {content}
      </div>

      {/* Expand button if content overflows */}
      {isOverflowing && onExpand && (
        <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white dark:from-gray-900 to-transparent flex items-end justify-center pb-2">
          <button
            onClick={onExpand}
            className={cn(
              'flex items-center gap-1 text-xs font-medium px-3 py-1 rounded-full',
              'bg-white dark:bg-gray-800 shadow-sm border',
              isOld 
                ? 'text-red-600 dark:text-red-400 border-red-200 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-950/50' 
                : 'text-green-600 dark:text-green-400 border-green-200 dark:border-green-700 hover:bg-green-50 dark:hover:bg-green-950/50'
            )}
          >
            <Maximize2 className="h-3 w-3" />
            Show full content
          </button>
        </div>
      )}
    </div>
  )
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function DiffBlock({
  editId,
  type,
  oldContent,
  newContent,
  sectionLabel,
  editNumber,
  totalEdits,
  isActive,
  onAccept,
  onReject,
  onNavigateNext,
  onNavigatePrev,
  onExpand,
}: DiffBlockProps) {
  const config = getEditTypeConfig(type)
  const Icon = config.icon
  
  const hasLongContent = isContentLong(oldContent) || isContentLong(newContent)
  const showOldContent = type === 'delete' || type === 'replace'
  const showNewContent = type === 'insert' || type === 'replace'

  return (
    <div
      data-edit-id={editId}
      data-diff-block
      role="region"
      aria-label={`Edit ${editNumber} of ${totalEdits}: ${config.label}${sectionLabel ? ` in ${sectionLabel}` : ''}`}
      className={cn(
        'my-4 rounded-xl border-2 overflow-hidden shadow-md transition-all duration-200',
        'animate-in fade-in slide-in-from-top-2 duration-300',
        config.borderClass,
        isActive && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
      )}
    >
      {/* Header */}
      <div className={cn(
        'flex items-center justify-between px-4 py-3 border-b',
        config.headerClass
      )}>
        <div className="flex items-center gap-3">
          <div className={cn(
            'flex items-center justify-center w-8 h-8 rounded-lg',
            'bg-white/80 dark:bg-gray-900/50 shadow-sm',
            config.iconClass
          )}>
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <span className="font-semibold text-sm text-foreground">
              {config.label}
            </span>
            {sectionLabel && (
              <span className="text-muted-foreground text-sm ml-1.5">
                in {sectionLabel}
              </span>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Navigation */}
          {totalEdits > 1 && (
            <div className="flex items-center gap-1 mr-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onNavigatePrev}
                disabled={!onNavigatePrev}
                aria-label="Previous edit"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted-foreground font-medium min-w-[40px] text-center">
                {editNumber}/{totalEdits}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onNavigateNext}
                disabled={!onNavigateNext}
                aria-label="Next edit"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
          
          {/* Expand button for long content */}
          {hasLongContent && onExpand && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onExpand}
              aria-label="Expand to full view"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Content Sections */}
      <div className="divide-y divide-border/50">
        {showOldContent && oldContent && (
          <ContentSection
            content={oldContent}
            variant="old"
            isScrollable={true}
            onExpand={hasLongContent ? onExpand : undefined}
          />
        )}
        {showNewContent && newContent && (
          <ContentSection
            content={newContent}
            variant="new"
            isScrollable={true}
            onExpand={hasLongContent ? onExpand : undefined}
          />
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between p-3 bg-muted/30 border-t">
        <div className="text-xs text-muted-foreground">
          <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Enter</kbd>
          <span className="mx-1">accept</span>
          <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono ml-2">Esc</kbd>
          <span className="mx-1">reject</span>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={onReject}
            className={cn(
              'min-h-[44px] min-w-[100px] font-medium',
              'border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700',
              'dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/50 dark:hover:text-red-300'
            )}
            aria-label="Reject this edit"
          >
            <X className="h-4 w-4 mr-2" />
            Reject
          </Button>
          <Button
            onClick={onAccept}
            className={cn(
              'min-h-[44px] min-w-[100px] font-medium',
              'bg-green-600 text-white hover:bg-green-700',
              'dark:bg-green-700 dark:hover:bg-green-600'
            )}
            aria-label="Accept this edit"
          >
            <Check className="h-4 w-4 mr-2" />
            Accept
          </Button>
        </div>
      </div>
    </div>
  )
}

export default DiffBlock
