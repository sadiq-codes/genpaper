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
    <div className="group border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors">
      <div className="p-3">
        {/* Header Row: Type Badge + Year */}
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground">
            Article
          </Badge>
          <div className="flex-1" />
          {paper.year && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {paper.year}
            </span>
          )}
        </div>
        
        {/* Title */}
        <h4 className="text-sm font-medium leading-tight mb-1.5 text-foreground line-clamp-2">
          {paper.title}
        </h4>
        
        {/* Authors */}
        <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
          <Users className="h-3 w-3 flex-shrink-0" />
          <span className="truncate">{formatAuthors(paper.authors)}</span>
        </p>
        
        {/* Journal */}
        {paper.journal && (
          <p className="text-[11px] text-muted-foreground/80 italic truncate">
            {paper.journal}
          </p>
        )}

        {/* Expandable Abstract */}
        {paper.abstract && (
          <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-1 text-[11px] text-primary hover:underline mt-2">
                <ChevronDown className={cn(
                  "h-3 w-3 transition-transform",
                  isExpanded && "rotate-180"
                )} />
                {isExpanded ? 'Hide abstract' : 'Show abstract'}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <p className="text-xs text-muted-foreground leading-relaxed mt-2 p-2 bg-muted/50 rounded-md max-h-32 overflow-y-auto">
                {paper.abstract}
              </p>
            </CollapsibleContent>
          </Collapsible>
        )}
        
        {/* Action Row */}
        <div className="flex items-center gap-1 mt-3 pt-2 border-t border-border/50">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-7 px-2 text-xs"
                  onClick={onInsertCitation}
                >
                  <Quote className="h-3 w-3 mr-1" />
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
                    className="h-7 px-2 text-xs"
                    onClick={() => window.open(`https://doi.org/${paper.doi}`, '_blank')}
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Open
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
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  onClick={onRemove}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Remove from project</TooltipContent>
            </Tooltip>
          </TooltipProvider>
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
    <div className="flex flex-col items-center justify-center py-12 text-center px-4">
      <div className="flex items-center justify-center w-14 h-14 rounded-full bg-muted mb-4">
        <BookOpen className="h-7 w-7 text-muted-foreground" />
      </div>
      <h3 className="font-medium text-sm mb-1 text-foreground">No papers yet</h3>
      <p className="text-xs text-muted-foreground mb-4 max-w-[200px] leading-relaxed">
        Add papers from your library to cite in your document
      </p>
      <Button size="sm" onClick={onOpenLibrary}>
        <Plus className="h-3.5 w-3.5 mr-1.5" />
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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 p-3 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">Papers</span>
            <Badge variant="secondary" className="text-xs px-1.5 py-0">
              {papers.length}
            </Badge>
          </div>
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={onOpenLibrary}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
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
        <ScrollArea className="h-full">
          {papers.length === 0 ? (
            <EmptyState onOpenLibrary={onOpenLibrary} />
          ) : (
            <div className="pb-2">
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
        <div className="flex-shrink-0 p-3 border-t bg-muted/30">
          <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
            <span className="font-medium">Tip:</span> Use chat to &quot;Extract claims&quot; or &quot;Find gaps&quot; from your papers
          </p>
        </div>
      )}
    </div>
  )
}
