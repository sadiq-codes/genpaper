'use client'

import { useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  FileText,
  Plus,
  ExternalLink,
  Trash2,
  Quote,
} from 'lucide-react'
import type { ProjectPaper } from '../types'

interface ResearchTabProps {
  papers: ProjectPaper[]
  onInsertCitation: (paper: ProjectPaper) => void
  onOpenLibrary: () => void
  onRemovePaper: (paperId: string, claimCount: number) => void
}

// Paper Card with Popover
function PaperCardWithPopover({ 
  paper,
  onInsertCitation,
  onRemove,
}: { 
  paper: ProjectPaper
  onInsertCitation: () => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const [showAbstract, setShowAbstract] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="w-full text-left p-2 rounded-lg border bg-card hover:bg-muted/30 transition-colors group">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-medium line-clamp-2 leading-tight">
                {paper.title}
              </h4>
              <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">
                {paper.authors?.slice(0, 2).join(', ')}
                {(paper.authors?.length || 0) > 2 && ' et al.'}
                {paper.year && ` (${paper.year})`}
              </p>
            </div>
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-80 p-0" 
        side="right" 
        align="start"
        sideOffset={8}
      >
        <div className="p-3 space-y-3">
          {/* Title */}
          <h3 className="font-semibold text-sm leading-tight">
            {paper.title}
          </h3>

          {/* Authors */}
          {paper.authors && paper.authors.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {paper.authors.join(', ')}
            </p>
          )}

          {/* Metadata */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {paper.year && <span>{paper.year}</span>}
            {paper.journal && (
              <span className="truncate max-w-[150px]">{paper.journal}</span>
            )}
          </div>

          {/* Abstract */}
          {paper.abstract && (
            <div className="space-y-1">
              <button
                onClick={() => setShowAbstract(!showAbstract)}
                className="text-xs font-medium text-primary hover:underline"
              >
                {showAbstract ? 'Hide abstract' : 'Show abstract'}
              </button>
              {showAbstract && (
                <p className="text-xs text-muted-foreground leading-relaxed max-h-32 overflow-y-auto">
                  {paper.abstract}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-2 p-3 border-t bg-muted/30">
          <Button
            size="sm"
            variant="default"
            className="flex-1 h-8 text-xs"
            onClick={() => {
              onInsertCitation()
              setOpen(false)
            }}
          >
            <Quote className="h-3 w-3 mr-1" />
            Insert Citation
          </Button>
          
          {paper.doi && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2"
              onClick={() => window.open(`https://doi.org/${paper.doi}`, '_blank')}
            >
              <ExternalLink className="h-3 w-3" />
            </Button>
          )}
          
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => {
              onRemove()
              setOpen(false)
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function ResearchTab({
  papers,
  onInsertCitation,
  onOpenLibrary,
  onRemovePaper,
}: ResearchTabProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 p-3 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            <span className="font-medium text-sm">Papers</span>
            <Badge variant="secondary" className="text-xs">
              {papers.length}
            </Badge>
          </div>
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={onOpenLibrary}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add papers from library</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Papers List */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1.5">
          {papers.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground mb-1">No papers yet</p>
              <p className="text-xs text-muted-foreground mb-3">
                Add papers to cite in your document
              </p>
              <Button size="sm" variant="outline" onClick={onOpenLibrary}>
                <Plus className="h-3 w-3 mr-1" />
                Add Papers
              </Button>
            </div>
          ) : (
            papers.map(paper => (
              <PaperCardWithPopover 
                key={paper.id} 
                paper={paper}
                onInsertCitation={() => onInsertCitation(paper)}
                onRemove={() => onRemovePaper(paper.id, 0)}
              />
            ))
          )}
        </div>
      </ScrollArea>

      {/* Tip */}
      {papers.length > 0 && (
        <div className="flex-shrink-0 p-3 border-t bg-muted/30">
          <p className="text-[10px] text-muted-foreground text-center">
            Tip: Use chat to &quot;Extract claims&quot; or &quot;Find gaps&quot; in your papers
          </p>
        </div>
      )}
    </div>
  )
}
