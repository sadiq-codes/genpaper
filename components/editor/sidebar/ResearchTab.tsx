'use client'

import { useState, memo, useCallback } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Plus,
  ExternalLink,
  Trash2,
  ChevronDown,
  BookOpen,
  Loader2,
  AlertCircle,
  RefreshCw,
  Upload,
  Search,
  ArrowLeft,
  Eye,
  Copy,
} from 'lucide-react'
import type { ProjectPaper } from '../types'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useResearchEditor } from '../research-editor-context'
import type { ProcessingStatus } from '../hooks/usePaperProcessingStatus'

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
  const label = source === 'upload' ? 'Uploaded' : 'From Search'
  
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-muted-foreground hover:text-foreground transition-colors">
            <Icon className="h-2.5 w-2.5" aria-hidden="true" />
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
      <span className="flex items-center gap-1 text-[9px] text-blue-500/70 shrink-0 uppercase tracking-wide font-medium">
        <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden="true" />
        <span>Processing</span>
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
        className="flex items-center gap-1 text-[9px] text-destructive/70 hover:text-destructive shrink-0 uppercase tracking-wide font-medium transition-colors"
      >
        <AlertCircle className="h-2.5 w-2.5" aria-hidden="true" />
        <span>Failed</span>
        {onRetry && <RefreshCw className="h-2 w-2" aria-hidden="true" />}
      </button>
    )
  }
  
  // pending
  return (
    <span className="flex items-center gap-1 text-[9px] text-muted-foreground/50 shrink-0 uppercase tracking-wide font-medium">
      <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden="true" />
      <span>Pending</span>
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
    <div className="px-4 py-3.5 border-b border-border/40 last:border-b-0 group">
      {/* Title row */}
      <div className="flex items-start gap-2">
        <h4 
          className="flex-1 font-instrument text-sm tracking-tight leading-snug line-clamp-2 min-w-0 cursor-pointer hover:text-foreground transition-colors"
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
      <div className="flex items-center justify-between gap-2 mt-1.5">
        <p className="text-xs text-muted-foreground truncate min-w-0 flex-1">
          {formatMeta(paper.authors, paper.year, paper.journal)}
        </p>
        <SourceIcon source={paper.source} />
      </div>
      
      {/* Actions Row */}
      <div className="flex items-center gap-1 mt-2.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        {/* Cite */}
        <button
          className="h-6 px-2.5 text-[10px] font-medium rounded-full bg-foreground/80 text-background hover:bg-foreground/70 transition-colors disabled:opacity-40"
          onClick={onInsertCitation}
          disabled={!isReady}
        >
          Cite
        </button>

        {/* View PDF */}
        {paper.pdfUrl && (
          <TooltipProvider delayDuration={400}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground rounded-full border border-border/40 hover:border-border/60 transition-colors"
                  onClick={() => window.open(paper.pdfUrl, '_blank')}
                  aria-label="View PDF"
                >
                  <Eye className="h-3 w-3" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent>View PDF</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Open DOI */}
        {paper.doi && (
          <TooltipProvider delayDuration={400}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground rounded-full border border-border/40 hover:border-border/60 transition-colors"
                  onClick={() => window.open(`https://doi.org/${paper.doi}`, '_blank')}
                  aria-label="Open DOI link"
                >
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Open DOI</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Copy DOI */}
        {paper.doi && (
          <TooltipProvider delayDuration={400}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground rounded-full transition-colors"
                  onClick={() => {
                    navigator.clipboard.writeText(`https://doi.org/${paper.doi}`)
                    toast.success('DOI link copied')
                  }}
                  aria-label="Copy DOI link"
                >
                  <Copy className="h-3 w-3" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Copy DOI</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Abstract Toggle */}
        {paper.abstract && (
          <button
            className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground rounded-full transition-colors flex items-center gap-0.5"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-expanded={isExpanded}
          >
            <ChevronDown 
              className={cn(
                "h-2.5 w-2.5 transition-transform",
                isExpanded && "rotate-180"
              )} 
              aria-hidden="true" 
            />
            {isExpanded ? 'Less' : 'More'}
          </button>
        )}

        <div className="flex-1" />

        {/* Delete */}
        <TooltipProvider delayDuration={400}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-destructive rounded-full transition-colors"
                onClick={onRemove}
                aria-label="Remove from project"
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Remove from project</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Expandable Abstract */}
      {paper.abstract && isExpanded && (
        <div className="mt-3 pt-3 border-t border-border/40">
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
    <div className="flex flex-col items-center justify-center py-16 text-center px-8">
      <div className="flex items-center justify-center w-10 h-10 rounded-full border border-border/40 mb-4">
        <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </div>
      <h3 className="font-instrument text-base tracking-tight mb-1">No papers yet</h3>
      <p className="text-xs text-muted-foreground mb-5 max-w-[200px] leading-relaxed">
        Add papers from your library to cite them in your research
      </p>
      <button
        className="h-8 px-4 text-xs font-medium rounded-full bg-foreground/80 text-background hover:bg-foreground transition-colors inline-flex items-center gap-1.5"
        onClick={onOpenLibrary}
      >
        <Plus className="h-3 w-3" aria-hidden="true" />
        Browse Library
      </button>
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
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-border/30 flex items-center justify-between">
        <button
          className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          onClick={onBack}
          aria-label="Back to papers list"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <button
          className="h-7 px-3 text-[10px] font-medium rounded-full bg-foreground/80 text-background hover:bg-foreground transition-colors"
          onClick={onInsertCitation}
        >
          Cite
        </button>
      </div>

      {/* Scrollable content */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4">
          {/* Title */}
          <h3 className="font-instrument text-base tracking-tight leading-snug">{paper.title}</h3>

          {/* Meta line */}
          <p className="text-xs text-muted-foreground mt-2">
            {allAuthors}
            {paper.year && ` · ${paper.year}`}
          </p>
          {paper.journal && (
            <p className="text-xs text-muted-foreground mt-0.5 italic">{paper.journal}</p>
          )}

          {/* DOI inline */}
          {paper.doi && (
            <div className="flex items-center gap-2 mt-2">
              <button
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors truncate"
                onClick={() => {
                  navigator.clipboard.writeText(paper.doi!)
                  toast.success('DOI copied')
                }}
                title="Click to copy DOI"
              >
                <span className="font-mono">{paper.doi}</span>
              </button>
              <button
                className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground rounded-full hover:bg-muted/50 transition-colors shrink-0"
                onClick={() => {
                  navigator.clipboard.writeText(`https://doi.org/${paper.doi}`)
                  toast.success('Link copied')
                }}
                aria-label="Copy link"
              >
                <Copy className="h-2.5 w-2.5" aria-hidden="true" />
              </button>
            </div>
          )}

          {/* Quick actions row */}
          <div className="flex items-center gap-1.5 mt-4">
            {paper.pdfUrl && (
              <button
                className="h-7 px-3 text-[11px] rounded-full border border-border/40 text-muted-foreground hover:text-foreground hover:border-border/60 transition-colors inline-flex items-center gap-1.5"
                onClick={() => window.open(paper.pdfUrl, '_blank')}
              >
                <Eye className="h-3 w-3" aria-hidden="true" />
                PDF
              </button>
            )}
            {paper.doi && (
              <button
                className="h-7 px-3 text-[11px] rounded-full border border-border/40 text-muted-foreground hover:text-foreground hover:border-border/60 transition-colors inline-flex items-center gap-1.5"
                onClick={() => window.open(`https://doi.org/${paper.doi}`, '_blank')}
              >
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                Open
              </button>
            )}
          </div>

          {/* Abstract */}
          {paper.abstract && (
            <div className="mt-5 pt-4 border-t border-border/30">
              <p className="text-xs text-muted-foreground leading-relaxed">
                {paper.abstract}
              </p>
            </div>
          )}

          {/* Source + Remove */}
          <div className="flex items-center justify-between mt-5 pt-3 border-t border-border/30">
            <span className="text-[10px] text-muted-foreground">
              {paper.source === 'upload' ? 'Uploaded PDF' : 'From search'}
            </span>
            <button
              className="text-[11px] text-muted-foreground hover:text-destructive transition-colors inline-flex items-center gap-1"
              onClick={onRemove}
            >
              <Trash2 className="h-2.5 w-2.5" aria-hidden="true" />
              Remove
            </button>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ResearchTab() {
  const {
    papers,
    insertCitation,
    openLibraryDrawer: onOpenLibrary,
    removePaper,
    getProcessingStatus,
    processingSummary,
    retryPaper,
  } = useResearchEditor()

  const [selectedPaper, setSelectedPaper] = useState<ProjectPaper | null>(null)

  const uploadedPapers = papers.filter(p => p.source === 'upload')
  const hasUploadedPapers = uploadedPapers.length > 0
  
  const hasProcessingPapers = hasUploadedPapers && processingSummary && 
    (processingSummary.pending > 0 || processingSummary.processing > 0)
  const hasFailedPapers = hasUploadedPapers && processingSummary && processingSummary.failed > 0
  
  const handleInsertCitation = useCallback((paper: ProjectPaper) => {
    insertCitation({
      id: paper.id,
      authors: paper.authors,
      title: paper.title,
      year: paper.year,
      journal: paper.journal,
      doi: paper.doi,
    })
  }, [insertCitation])
  
  const handleRemovePaper = useCallback((paperId: string) => {
    removePaper(paperId, 0)
  }, [removePaper])
  
  const handleRetryPaper = useCallback((paperId: string) => {
    retryPaper(paperId)
  }, [retryPaper])

  const handleViewDetail = useCallback((paper: ProjectPaper) => {
    setSelectedPaper(paper)
  }, [])

  // Detail view
  if (selectedPaper) {
    return (
      <PaperDetailView
        paper={selectedPaper}
        onBack={() => setSelectedPaper(null)}
        onInsertCitation={() => handleInsertCitation(selectedPaper)}
        onRemove={() => {
          handleRemovePaper(selectedPaper.id)
          setSelectedPaper(null)
        }}
      />
    )
  }
  
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-border/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-instrument text-sm tracking-tight">Papers</span>
            {papers.length > 0 && (
              <span className="text-[10px] text-muted-foreground tabular-nums">{papers.length}</span>
            )}
          </div>
          <button
            className="h-7 px-3 text-[11px] font-medium rounded-full bg-foreground/80 text-background hover:bg-foreground transition-colors inline-flex items-center gap-1"
            onClick={onOpenLibrary}
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
            Add
          </button>
        </div>
        
        {/* Processing status indicator */}
        {hasUploadedPapers && (hasProcessingPapers || hasFailedPapers) && (
          <div className="mt-2 flex items-center gap-3 text-[10px]">
            {hasProcessingPapers && processingSummary && (
              <span className="flex items-center gap-1 text-blue-500/70">
                <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden="true" />
                Processing {processingSummary.processing + processingSummary.pending}
              </span>
            )}
            {hasFailedPapers && processingSummary && (
              <span className="flex items-center gap-1 text-destructive/70">
                <AlertCircle className="h-2.5 w-2.5" aria-hidden="true" />
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
            <div>
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
        <div className="shrink-0 px-4 py-2 border-t border-border/20">
          <p className="text-[10px] text-muted-foreground text-center font-instrument italic">
            Use chat to find claims or research gaps
          </p>
        </div>
      )}
    </div>
  )
}
