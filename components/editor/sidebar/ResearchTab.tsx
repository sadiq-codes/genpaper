'use client'

import { useState, memo, useCallback } from 'react'
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
  FileText,
  Plus,
  ExternalLink,
  Trash2,
  Quote,
  ChevronDown,
  BookOpen,
  Loader2,
  AlertCircle,
  RefreshCw,
  Upload,
  Search,
} from 'lucide-react'
import type { ProjectPaper } from '../types'
import { cn } from '@/lib/utils'
import type { ProcessingStatus } from '../hooks/usePaperProcessingStatus'

// =============================================================================
// TYPES
// =============================================================================

interface ProcessingSummary {
  total: number
  pending: number
  processing: number
  processed: number
  failed: number
  allProcessed: boolean
}

interface ResearchTabProps {
  papers: ProjectPaper[]
  onInsertCitation: (paper: ProjectPaper) => void
  onOpenLibrary: () => void
  onRemovePaper: (paperId: string, claimCount: number) => void
  getProcessingStatus?: (paperId: string) => ProcessingStatus
  processingSummary?: ProcessingSummary
  onRetryPaper?: (paperId: string) => void
  isPolling?: boolean
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function formatAuthors(authors: string[] | undefined): string {
  if (!authors || authors.length === 0) return 'Unknown'
  if (authors.length === 1) return authors[0]
  if (authors.length === 2) return authors.join(' & ')
  return `${authors[0]} et al.`
}

function formatMeta(authors: string[] | undefined, year?: number, journal?: string): string {
  const parts: string[] = []
  parts.push(formatAuthors(authors))
  if (year) parts.push(String(year))
  if (journal) parts.push(journal)
  return parts.join(' · ')
}

// =============================================================================
// SOURCE ICON - Minimal, icon-only indicator
// =============================================================================

function SourceIcon({ source }: { source?: 'upload' | 'search' }) {
  const Icon = source === 'upload' ? Upload : Search
  const label = source === 'upload' ? 'Uploaded PDF' : 'From search'
  
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-muted-foreground/50 hover:text-muted-foreground transition-colors">
            <Icon className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only">{label}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="left">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// =============================================================================
// PROCESSING STATUS - Only shown when NOT ready
// =============================================================================

function ProcessingBadge({ 
  status, 
  onRetry 
}: { 
  status: ProcessingStatus
  onRetry?: () => void 
}) {
  // Don't show anything when processed (ready)
  if (status === 'processed') return null
  
  if (status === 'processing') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-blue-500 shrink-0">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        <span>Processing…</span>
      </span>
    )
  }
  
  if (status === 'failed') {
    return (
      <button 
        onClick={(e) => {
          e.stopPropagation()
          onRetry?.()
        }}
        className="flex items-center gap-1 text-[10px] text-destructive hover:underline shrink-0"
      >
        <AlertCircle className="h-3 w-3" aria-hidden="true" />
        <span>Failed</span>
        {onRetry && <RefreshCw className="h-2.5 w-2.5" aria-hidden="true" />}
      </button>
    )
  }
  
  // pending
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
      <Loader2 className="h-3 w-3 animate-spin opacity-60" aria-hidden="true" />
      <span>Pending…</span>
    </span>
  )
}

// =============================================================================
// PAPER CARD - Redesigned with cleaner layout
// =============================================================================

const PaperCard = memo(function PaperCard({ 
  paper,
  onInsertCitation,
  onRemove,
  processingStatus,
  onRetry,
}: { 
  paper: ProjectPaper
  onInsertCitation: () => void
  onRemove: () => void
  processingStatus?: ProcessingStatus
  onRetry?: () => void
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const isReady = !processingStatus || processingStatus === 'processed'

  return (
    <div className={cn(
      "rounded-lg border bg-card p-3 transition-colors",
      "hover:bg-muted/30"
    )}>
      {/* Title + Processing status (only when not ready) */}
      <div className="flex items-start gap-2">
        <h4 className="flex-1 text-sm font-medium leading-snug line-clamp-2 min-w-0">
          {paper.title}
        </h4>
        {processingStatus && processingStatus !== 'processed' && (
          <ProcessingBadge status={processingStatus} onRetry={onRetry} />
        )}
      </div>
      
      {/* Meta: Author · Year · Venue + Source icon */}
      <div className="flex items-center justify-between gap-2 mt-1">
        <p className="text-xs text-muted-foreground truncate min-w-0 flex-1">
          {formatMeta(paper.authors, paper.year, paper.journal)}
        </p>
        <SourceIcon source={paper.source} />
      </div>
      
      {/* Actions Row */}
      <div className="flex items-center gap-1 mt-3 pt-2 border-t">
        {/* Cite Button */}
        <Button 
          variant="secondary" 
          size="sm" 
          className="h-7 px-2 text-xs"
          onClick={onInsertCitation}
          disabled={!isReady}
        >
          <Quote className="h-3 w-3 mr-1" aria-hidden="true" />
          Cite
        </Button>

        {/* Open/DOI Button */}
        {paper.doi && (
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => window.open(`https://doi.org/${paper.doi}`, '_blank')}
          >
            <ExternalLink className="h-3 w-3 mr-1" aria-hidden="true" />
            Open
          </Button>
        )}

        {/* Abstract Toggle */}
        {paper.abstract && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-expanded={isExpanded}
          >
            <ChevronDown 
              className={cn(
                "h-3 w-3 mr-1 transition-transform",
                isExpanded && "rotate-180"
              )} 
              aria-hidden="true" 
            />
            {isExpanded ? 'Less' : 'More'}
          </Button>
        )}

        <div className="flex-1" />

        {/* Delete Button - always visible but muted */}
        <TooltipProvider delayDuration={400}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-7 w-7 p-0 text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10"
                onClick={onRemove}
                aria-label="Remove from project"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Remove from project</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Expandable Abstract */}
      {paper.abstract && isExpanded && (
        <div className="mt-3 pt-3 border-t">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {paper.abstract}
          </p>
        </div>
      )}
    </div>
  )
})

// =============================================================================
// EMPTY STATE COMPONENT
// =============================================================================

function EmptyState({ onOpenLibrary }: { onOpenLibrary: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center px-6">
      <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 mb-4">
        <BookOpen className="h-6 w-6 text-primary/70" aria-hidden="true" />
      </div>
      <h3 className="font-medium text-sm mb-1">No papers yet</h3>
      <p className="text-xs text-muted-foreground mb-4 max-w-[200px]">
        Add papers from your library to cite them
      </p>
      <Button size="sm" onClick={onOpenLibrary}>
        <Plus className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
        Browse Library
      </Button>
    </div>
  )
}

// =============================================================================
// MEMOIZED PAPER CARD ITEM
// =============================================================================

interface PaperListItemProps {
  paper: ProjectPaper
  onInsertCitation: (paper: ProjectPaper) => void
  onRemovePaper: (paperId: string) => void
  processingStatus?: ProcessingStatus
  onRetryPaper?: (paperId: string) => void
}

const PaperListItem = memo(function PaperListItem({
  paper,
  onInsertCitation,
  onRemovePaper,
  processingStatus,
  onRetryPaper,
}: PaperListItemProps) {
  const handleInsertCitation = useCallback(() => {
    onInsertCitation(paper)
  }, [onInsertCitation, paper])
  
  const handleRemove = useCallback(() => {
    onRemovePaper(paper.id)
  }, [onRemovePaper, paper.id])
  
  const handleRetry = useCallback(() => {
    onRetryPaper?.(paper.id)
  }, [onRetryPaper, paper.id])
  
  return (
    <PaperCard
      paper={paper}
      onInsertCitation={handleInsertCitation}
      onRemove={handleRemove}
      processingStatus={processingStatus}
      onRetry={onRetryPaper ? handleRetry : undefined}
    />
  )
})

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ResearchTab({
  papers,
  onInsertCitation,
  onOpenLibrary,
  onRemovePaper,
  getProcessingStatus,
  processingSummary,
  onRetryPaper,
}: ResearchTabProps) {
  const uploadedPapers = papers.filter(p => p.source === 'upload')
  const hasUploadedPapers = uploadedPapers.length > 0
  
  const hasProcessingPapers = hasUploadedPapers && processingSummary && 
    (processingSummary.pending > 0 || processingSummary.processing > 0)
  const hasFailedPapers = hasUploadedPapers && processingSummary && processingSummary.failed > 0
  
  const handleInsertCitation = useCallback((paper: ProjectPaper) => {
    onInsertCitation(paper)
  }, [onInsertCitation])
  
  const handleRemovePaper = useCallback((paperId: string) => {
    onRemovePaper(paperId, 0)
  }, [onRemovePaper])
  
  const handleRetryPaper = useCallback((paperId: string) => {
    onRetryPaper?.(paperId)
  }, [onRetryPaper])
  
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span className="font-medium text-sm">Papers</span>
            <Badge variant="secondary" className="text-xs px-1.5 py-0 rounded-full">
              {papers.length}
            </Badge>
          </div>
          <Button
            variant="default"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={onOpenLibrary}
          >
            <Plus className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
            Add
          </Button>
        </div>
        
        {/* Processing status indicator */}
        {hasUploadedPapers && (hasProcessingPapers || hasFailedPapers) && (
          <div className="mt-2 flex items-center gap-3 text-[11px]">
            {hasProcessingPapers && processingSummary && (
              <span className="flex items-center gap-1 text-blue-500">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Processing {processingSummary.processing + processingSummary.pending}
              </span>
            )}
            {hasFailedPapers && processingSummary && (
              <span className="flex items-center gap-1 text-destructive">
                <AlertCircle className="h-3 w-3" aria-hidden="true" />
                {processingSummary.failed} failed
              </span>
            )}
          </div>
        )}
      </div>

      {/* Papers List */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ScrollArea className="h-full">
          {papers.length === 0 ? (
            <EmptyState onOpenLibrary={onOpenLibrary} />
          ) : (
            <div className="p-3 space-y-2">
              {papers.map(paper => {
                const isUploadedPaper = paper.source === 'upload'
                return (
                  <PaperListItem
                    key={paper.id}
                    paper={paper}
                    onInsertCitation={handleInsertCitation}
                    onRemovePaper={handleRemovePaper}
                    processingStatus={isUploadedPaper ? getProcessingStatus?.(paper.id) : undefined}
                    onRetryPaper={isUploadedPaper ? handleRetryPaper : undefined}
                  />
                )
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Footer Tip */}
      {papers.length > 0 && (
        <div className="flex-shrink-0 px-4 py-2.5 border-t">
          <p className="text-[11px] text-muted-foreground text-center">
            Use chat to find claims or research gaps
          </p>
        </div>
      )}
    </div>
  )
}
