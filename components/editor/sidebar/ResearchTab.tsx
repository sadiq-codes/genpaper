'use client'

import { useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  FileText,
  Plus,
  ExternalLink,
  Trash2,
  Quote,
  ChevronDown,
  Users,
  Calendar,
  BookOpen,
} from 'lucide-react'
import type { ProjectPaper } from '../types'
import { cn } from '@/lib/utils'

// =============================================================================
// TYPES
// =============================================================================

interface ResearchTabProps {
  papers: ProjectPaper[]
  onInsertCitation: (paper: ProjectPaper) => void
  onOpenLibrary: () => void
  onRemovePaper: (paperId: string, claimCount: number) => void
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function formatAuthors(authors: string[] | undefined): string {
  if (!authors || authors.length === 0) return 'Unknown authors'
  if (authors.length === 1) return authors[0]
  if (authors.length === 2) return authors.join(' & ')
  return `${authors[0]} et al.`
}

// =============================================================================
// PAPER CARD COMPONENT
// =============================================================================

function PaperCard({ 
  paper,
  onInsertCitation,
  onRemove,
}: { 
  paper: ProjectPaper
  onInsertCitation: () => void
  onRemove: () => void
}) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className="group px-2 py-1.5 first:pt-2 last:pb-2">
      <div className={cn(
        "relative rounded-lg border border-border/40 bg-card transition-all duration-200 overflow-hidden",
        "hover:border-border/60 hover:bg-muted/20"
      )}>
        {/* Color accent bar on left */}
        <div className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full bg-primary/40 opacity-0 group-hover:opacity-100 transition-opacity" />
        
        <div className="p-3 pl-4 min-w-0 overflow-hidden">
          {/* Title - Primary focus */}
          <h4 className="text-sm font-medium leading-snug mb-2 text-foreground line-clamp-2 break-words">
            {paper.title}
          </h4>
          
          {/* Meta row: Authors, Year */}
          <div className="flex items-center gap-x-3 text-xs text-muted-foreground mb-2 min-w-0">
            {/* Authors */}
            <span className="flex items-center gap-1 min-w-0 flex-1">
              <Users className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{formatAuthors(paper.authors)}</span>
            </span>
            
            {/* Year */}
            {paper.year && (
              <span className="flex items-center gap-1 flex-shrink-0">
                <Calendar className="h-3 w-3" />
                {paper.year}
              </span>
            )}
          </div>
          
          {/* Journal - subtle */}
          {paper.journal && (
            <p className="text-[11px] text-muted-foreground/70 italic truncate mb-2 min-w-0">
              {paper.journal}
            </p>
          )}

          {/* Expandable Abstract */}
          {paper.abstract && (
            <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
              <CollapsibleTrigger asChild>
                <button className={cn(
                  "flex items-center gap-1 text-[11px] font-medium transition-colors",
                  isExpanded ? "text-primary" : "text-muted-foreground hover:text-primary"
                )}>
                  <ChevronDown className={cn(
                    "h-3 w-3 transition-transform duration-200",
                    isExpanded && "rotate-180"
                  )} />
                  {isExpanded ? 'Hide abstract' : 'Show abstract'}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <p className="text-xs text-muted-foreground leading-relaxed mt-2 p-3 bg-muted/40 rounded-md max-h-36 overflow-y-auto overflow-x-hidden break-words border border-border/50">
                  {paper.abstract}
                </p>
              </CollapsibleContent>
            </Collapsible>
          )}
          
          {/* Action Row */}
          <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-border/40">
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="secondary" 
                    size="sm" 
                    className="h-7 px-2.5 text-xs font-medium"
                    onClick={onInsertCitation}
                  >
                    <Quote className="h-3 w-3 mr-1.5" />
                    Cite
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Insert citation at cursor</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {paper.doi && (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => window.open(`https://doi.org/${paper.doi}`, '_blank')}
                    >
                      <ExternalLink className="h-3 w-3 mr-1" />
                      DOI
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Open paper (DOI)</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            <div className="flex-1" />

            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-7 w-7 p-0 text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={onRemove}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Remove from project</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// EMPTY STATE COMPONENT
// =============================================================================

function EmptyState({ onOpenLibrary }: { onOpenLibrary: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-6">
      <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-5">
        <BookOpen className="h-8 w-8 text-primary/70" />
      </div>
      <h3 className="font-semibold text-base mb-2 text-foreground">No papers yet</h3>
      <p className="text-sm text-muted-foreground mb-5 max-w-[220px] leading-relaxed">
        Add papers from your library to cite in your document
      </p>
      <Button size="default" onClick={onOpenLibrary} className="shadow-sm">
        <Plus className="h-4 w-4 mr-2" />
        Browse Library
      </Button>
    </div>
  )
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ResearchTab({
  papers,
  onInsertCitation,
  onOpenLibrary,
  onRemovePaper,
}: ResearchTabProps) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/10">
              <FileText className="h-4 w-4 text-primary" />
            </div>
            <span className="font-medium text-sm">Papers</span>
            <Badge variant="secondary" className="text-xs px-2 py-0.5 rounded-full font-medium">
              {papers.length}
            </Badge>
          </div>
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="default"
                  size="sm"
                  className="h-8 px-3 text-xs shadow-sm"
                  onClick={onOpenLibrary}
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add papers from library</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Papers List */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ScrollArea className="h-full w-full">
          {papers.length === 0 ? (
            <EmptyState onOpenLibrary={onOpenLibrary} />
          ) : (
            <div className="w-full overflow-hidden">
              {papers.map(paper => (
                <PaperCard 
                  key={paper.id} 
                  paper={paper}
                  onInsertCitation={() => onInsertCitation(paper)}
                  onRemove={() => onRemovePaper(paper.id, 0)}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Footer Tip */}
      {papers.length > 0 && (
        <div className="flex-shrink-0 px-4 py-3 border-t border-border/50">
          <p className="text-xs text-muted-foreground text-center leading-relaxed">
            <span className="font-medium text-foreground">Tip:</span> Use chat to &quot;Extract claims&quot; or &quot;Find gaps&quot;
          </p>
        </div>
      )}
    </div>
  )
}
