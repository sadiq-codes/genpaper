'use client'

import { useMemo } from 'react'
import { formatDistanceToNow, format as formatDate } from 'date-fns'
import { RotateCcw, X, Clock, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ProjectPaper } from '../types'
import { useCitationFormatter } from '../hooks/useCitationFormatter'
import type { VersionWithContent } from './useVersionHistory'

/** Citation marker regex: [@paperId#instanceId] or [@paperId]. */
const CITATION_MARKER_RE = /\[@([a-f0-9-]+)(?:#([a-f0-9-]+|\.{1,3}))?\]/gi

/** Replace internal citation markers with style-aware citation text. */
function renderReadableCitations(
  text: string,
  papers: ProjectPaper[],
  formatCitation: (paper: ProjectPaper, citationNumber?: number) => string,
  isNumericStyle: boolean
): string {
  if (!text) return text

  const paperMap = new Map(papers.map(p => [p.id, p]))
  const citationNumbers = new Map<string, number>()
  let nextCitationNumber = 1

  return text
    .replace(CITATION_MARKER_RE, (_match, paperId: string) => {
      const paper = paperMap.get(paperId)
      if (!paper) return '(citation)'

      if (isNumericStyle) {
        if (!citationNumbers.has(paperId)) {
          citationNumbers.set(paperId, nextCitationNumber++)
        }
        return formatCitation(paper, citationNumbers.get(paperId))
      }

      return formatCitation(paper)
    })
    .replace(/  +/g, ' ')
}

interface VersionPreviewProps {
  version: VersionWithContent | null
  papers: ProjectPaper[]
  citationStyle: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onRestore: () => void
}

export function VersionPreview({
  version,
  papers,
  citationStyle,
  open,
  onOpenChange,
  onRestore,
}: VersionPreviewProps) {
  const { format: formatCitation, isNumeric, isStyleLoaded } = useCitationFormatter(citationStyle || 'apa')

  const cleanContent = useMemo(
    () =>
      version
        ? renderReadableCitations(
            version.content,
            papers,
            (paper, citationNumber) => formatCitation(paper, citationNumber),
            isNumeric
          )
        : '',
    [version, papers, formatCitation, isNumeric, isStyleLoaded]
  )

  if (!version) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[85vh] flex flex-col rounded-2xl p-0">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0">
          <DialogTitle className="flex items-center gap-2.5 font-instrument text-lg tracking-tight">
            <FileText className="h-4.5 w-4.5 text-muted-foreground" />
            Version Preview
          </DialogTitle>
          <DialogDescription className="flex items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-medium">
              <Clock className="h-3 w-3" />
              {formatDistanceToNow(new Date(version.created_at), { addSuffix: true })}
            </span>
            <span className="text-xs text-muted-foreground/70">
              {formatDate(new Date(version.created_at), 'PPpp')}
            </span>
            {version.word_count && (
              <span className="text-xs text-muted-foreground/70">
                {version.word_count.toLocaleString()} words
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto mx-6 mb-4 border border-border/50 rounded-2xl bg-card">
          <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm leading-relaxed p-5">
            {cleanContent}
          </div>
        </div>

        <DialogFooter className="px-6 pb-6 pt-2 gap-2 sm:gap-2 shrink-0">
          <Button
            variant="outline"
            className="rounded-full border-border/50 hover:border-border"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4 mr-2" />
            Close
          </Button>
          <Button className="rounded-full" onClick={onRestore}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Restore This Version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
