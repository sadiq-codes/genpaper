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
  ArrowLeft,
  Calendar,
  Users,
  Eye,
  Copy,
} from 'lucide-react'
import type { ProjectPaper } from '../types'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
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
  onViewDetail,
  processingStatus,
  onRetry,
}: { 
  paper: ProjectPaper
  onInsertCitation: () => void
  onRemove: () => void
  onViewDetail: () => void
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
      {/* Title - clickable to view detail */}
      <div className="flex items-start gap-2">
        <h4 
          className="flex-1 text-sm font-medium leading-snug line-clamp-2 min-w-0 cursor-pointer hover:text-primary transition-colors"
          onClick={onViewDetail}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onViewDetail() } }}
        >
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
        {/* Open Button - opens PDF if available, otherwise DOI */}
        {(paper.pdfUrl || paper.doi) && (
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => {
              const url = paper.pdfUrl || (paper.doi ? `https://doi.org/${paper.doi}` : null)
              if (url) window.open(url, '_blank')
            }}
          >
            <ExternalLink className="h-3 w-3 mr-1" aria-hidden="true" />
            Open
          </Button>
        )}

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
  onViewDetail: (paper: ProjectPaper) => void
  processingStatus?: ProcessingStatus
  onRetryPaper?: (paperId: string) => void
}

const PaperListItem = memo(function PaperListItem({
  paper,
  onInsertCitation,
  onRemovePaper,
  onViewDetail,
  processingStatus,
  onRetryPaper,
}: PaperListItemProps) {
  const handleInsertCitation = useCallback(() => {
    onInsertCitation(paper)
  }, [onInsertCitation, paper])
  
  const handleRemove = useCallback(() => {
    onRemovePaper(paper.id)
  }, [onRemovePaper, paper.id])
  
  const handleViewDetail = useCallback(() => {
    onViewDetail(paper)
  }, [onViewDetail, paper])
  
  const handleRetry = useCallback(() => {
    onRetryPaper?.(paper.id)
  }, [onRetryPaper, paper.id])
  
  return (
    <PaperCard
      paper={paper}
      onInsertCitation={handleInsertCitation}
      onRemove={handleRemove}
      onViewDetail={handleViewDetail}
      processingStatus={processingStatus}
      onRetry={onRetryPaper ? handleRetry : undefined}
    />
  )
})

// =============================================================================
// PAPER DETAIL VIEW
// =============================================================================

function PaperDetailView({
  paper,
  onBack,
  onInsertCitation,
  onRemove,
}: {
  paper: ProjectPaper
  onBack: () => void
  onInsertCitation: () => void
  onRemove: () => void
}) {
  const allAuthors = paper.authors?.length ? paper.authors.join(', ') : 'Unknown'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header with back button */}
      <div className="shrink-0 px-4 py-3 border-b flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={onBack}
          aria-label="Back to papers list"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="font-medium text-sm truncate">Paper Details</span>
      </div>

      {/* Scrollable content */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-4">
          {/* Title */}
          <h3 className="text-sm font-semibold leading-snug">{paper.title}</h3>

          {/* Meta */}
          <div className="space-y-2">
            {paper.authors && paper.authors.length > 0 && (
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{allAuthors}</span>
              </div>
            )}
            {paper.year && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{paper.year}</span>
              </div>
            )}
            {paper.journal && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{paper.journal}</span>
              </div>
            )}
            {paper.doi && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded shrink-0">DOI</span>
                <button
                  className="truncate hover:text-foreground transition-colors text-left"
                  onClick={() => {
                    navigator.clipboard.writeText(`https://doi.org/${paper.doi}`)
                    toast.success('DOI copied')
                  }}
                  title="Click to copy"
                >
                  {paper.doi}
                </button>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 pt-1">
            {paper.pdfUrl && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => window.open(paper.pdfUrl, '_blank')}
              >
                <Eye className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                View PDF
              </Button>
            )}
            {paper.doi && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => window.open(`https://doi.org/${paper.doi}`, '_blank')}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                DOI
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              className="h-8 text-xs"
              onClick={onInsertCitation}
            >
              <Quote className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
              Cite
            </Button>
          </div>

          {/* Abstract */}
          {paper.abstract && (
            <div className="pt-2">
              <h4 className="text-xs font-medium mb-2">Abstract</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {paper.abstract}
              </p>
            </div>
          )}

          {/* Source badge */}
          <div className="flex items-center gap-2 pt-2 border-t">
            <Badge variant="secondary" className="text-[10px]">
              {paper.source === 'upload' ? 'Uploaded PDF' : 'From search'}
            </Badge>
          </div>

          {/* Remove button */}
          <div className="pt-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 w-full justify-center"
              onClick={onRemove}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
              Remove from project
            </Button>
          </div>
        </div>
      </ScrollArea>
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
  getProcessingStatus,
  processingSummary,
  onRetryPaper,
}: ResearchTabProps) {
  const [selectedPaper, setSelectedPaper] = useState<ProjectPaper | null>(null)

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

  const handleViewDetail = useCallback((paper: ProjectPaper) => {
    setSelectedPaper(paper)
  }, [])

  // Detail view
  if (selectedPaper) {
    return (
      <PaperDetailView
        paper={selectedPaper}
        onBack={() => setSelectedPaper(null)}
        onInsertCitation={() => onInsertCitation(selectedPaper)}
        onRemove={() => {
          onRemovePaper(selectedPaper.id, 0)
          setSelectedPaper(null)
        }}
      />
    )
  }
  
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
                    onViewDetail={handleViewDetail}
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
