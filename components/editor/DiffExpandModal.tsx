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
      return { icon: Minus, label: 'Delete', colorClass: 'text-diff-delete' }
    case 'insert':
      return { icon: Plus, label: 'Insert', colorClass: 'text-diff-insert' }
    case 'replace':
      return { icon: ArrowLeftRight, label: 'Replace', colorClass: 'text-diff-modify' }
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
            <Icon className={cn('h-5 w-5', config.colorClass)} />
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
            <div className="flex flex-col min-h-0 rounded-lg border border-diff-delete/50 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2 bg-diff-delete/15 border-b border-diff-delete/30">
                <Minus className="h-4 w-4 text-diff-delete" />
                <span className="text-sm font-medium text-diff-delete">
                  Current content (will be removed)
                </span>
              </div>
              <ScrollArea className="flex-1 p-4 bg-diff-delete/5">
                <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/80 line-through decoration-diff-delete/60 decoration-2">
                  {oldContent}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* New content */}
          {showNewContent && newContent && (
            <div className="flex flex-col min-h-0 rounded-lg border border-diff-insert/50 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2 bg-diff-insert/15 border-b border-diff-insert/30">
                <Plus className="h-4 w-4 text-diff-insert" />
                <span className="text-sm font-medium text-diff-insert">
                  New content (will be added)
                </span>
              </div>
              <ScrollArea className="flex-1 p-4 bg-diff-insert/5">
                <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
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
              'border-destructive/50 text-destructive hover:bg-destructive/10'
            )}
          >
            <X className="h-4 w-4 mr-2" />
            Reject
          </Button>
          <Button
            onClick={handleAccept}
            className={cn(
              'min-h-[44px] min-w-[100px] font-medium',
              'bg-primary text-primary-foreground hover:bg-primary/90'
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
