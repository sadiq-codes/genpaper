'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { 
  Check, 
  X, 
  Minus, 
  Plus, 
  ArrowLeftRight 
} from 'lucide-react'
import { cn } from '@/lib/utils'

// =============================================================================
// TYPES
// =============================================================================

export interface DiffExpandModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editType: 'delete' | 'insert' | 'replace'
  oldContent?: string
  newContent?: string
  sectionLabel?: string
  onAccept: () => void
  onReject: () => void
}

// =============================================================================
// HELPERS
// =============================================================================

function getEditTypeConfig(type: 'delete' | 'insert' | 'replace') {
  switch (type) {
    case 'delete':
      return { icon: Minus, label: 'Delete', color: 'red' }
    case 'insert':
      return { icon: Plus, label: 'Insert', color: 'green' }
    case 'replace':
      return { icon: ArrowLeftRight, label: 'Replace', color: 'blue' }
  }
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function DiffExpandModal({
  open,
  onOpenChange,
  editType,
  oldContent,
  newContent,
  sectionLabel,
  onAccept,
  onReject,
}: DiffExpandModalProps) {
  const config = getEditTypeConfig(editType)
  const Icon = config.icon
  
  const showOldContent = editType === 'delete' || editType === 'replace'
  const showNewContent = editType === 'insert' || editType === 'replace'
  const showBothColumns = showOldContent && showNewContent

  const handleAccept = () => {
    onAccept()
    onOpenChange(false)
  }

  const handleReject = () => {
    onReject()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className={cn(
              'h-5 w-5',
              config.color === 'red' && 'text-red-600',
              config.color === 'green' && 'text-green-600',
              config.color === 'blue' && 'text-blue-600'
            )} />
            <span>{config.label}</span>
            {sectionLabel && (
              <span className="text-muted-foreground font-normal">
                in {sectionLabel}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Content comparison */}
        <div className={cn(
          'flex-1 min-h-0 grid gap-4',
          showBothColumns ? 'md:grid-cols-2' : 'grid-cols-1'
        )}>
          {/* Old content */}
          {showOldContent && oldContent && (
            <div className="flex flex-col min-h-0 rounded-lg border border-red-200 dark:border-red-800 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-800">
                <Minus className="h-4 w-4 text-red-600 dark:text-red-400" />
                <span className="text-sm font-medium text-red-700 dark:text-red-300">
                  Current content (will be removed)
                </span>
              </div>
              <ScrollArea className="flex-1 p-4 bg-red-50/50 dark:bg-red-950/10">
                <div className="text-sm leading-relaxed whitespace-pre-wrap text-red-800 dark:text-red-200 line-through decoration-red-400/60 decoration-2">
                  {oldContent}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* New content */}
          {showNewContent && newContent && (
            <div className="flex flex-col min-h-0 rounded-lg border border-green-200 dark:border-green-800 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2 bg-green-50 dark:bg-green-950/30 border-b border-green-200 dark:border-green-800">
                <Plus className="h-4 w-4 text-green-600 dark:text-green-400" />
                <span className="text-sm font-medium text-green-700 dark:text-green-300">
                  New content (will be added)
                </span>
              </div>
              <ScrollArea className="flex-1 p-4 bg-green-50/50 dark:bg-green-950/10">
                <div className="text-sm leading-relaxed whitespace-pre-wrap text-green-800 dark:text-green-200">
                  {newContent}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter className="flex-shrink-0 gap-2 sm:gap-2">
          <div className="flex-1 text-xs text-muted-foreground hidden sm:block">
            <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Enter</kbd>
            <span className="mx-1">accept</span>
            <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono ml-2">Esc</kbd>
            <span className="mx-1">reject</span>
          </div>
          <Button
            variant="outline"
            onClick={handleReject}
            className={cn(
              'min-h-[44px] min-w-[100px] font-medium',
              'border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700',
              'dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/50'
            )}
          >
            <X className="h-4 w-4 mr-2" />
            Reject
          </Button>
          <Button
            onClick={handleAccept}
            className={cn(
              'min-h-[44px] min-w-[100px] font-medium',
              'bg-green-600 text-white hover:bg-green-700',
              'dark:bg-green-700 dark:hover:bg-green-600'
            )}
          >
            <Check className="h-4 w-4 mr-2" />
            Accept
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default DiffExpandModal
