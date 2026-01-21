'use client'

import { FileText, Loader2, AlertCircle, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { UploadedPdf } from './types'

interface PdfChipProps {
  pdf: UploadedPdf
  onRemove: () => void
  disabled?: boolean
}

export function PdfChip({ pdf, onRemove, disabled }: PdfChipProps) {
  const isLoading = pdf.status === 'uploading' || pdf.status === 'processing'
  const isError = pdf.status === 'error'
  const isReady = pdf.status === 'ready'

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm',
        'border transition-colors',
        isError && 'bg-destructive/10 border-destructive/30 text-destructive',
        isLoading && 'bg-muted/50 border-border/50 text-muted-foreground',
        isReady && 'bg-muted border-border text-foreground'
      )}
      title={pdf.error || pdf.title || pdf.filename}
    >
      {/* Status Icon */}
      {isLoading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" />
      ) : isError ? (
        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
      ) : (
        <FileText className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
      )}

      {/* Filename */}
      <span className="max-w-[120px] sm:max-w-[150px] truncate">
        {pdf.filename}
      </span>

      {/* Remove Button */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onRemove()
        }}
        disabled={disabled}
        className={cn(
          'p-0.5 rounded-full transition-colors flex-shrink-0',
          'hover:bg-foreground/10',
          'focus:outline-none focus:ring-1 focus:ring-primary',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
        aria-label={`Remove ${pdf.filename}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

interface PdfChipListProps {
  pdfs: UploadedPdf[]
  onRemove: (id: string) => void
  disabled?: boolean
}

export function PdfChipList({ pdfs, onRemove, disabled }: PdfChipListProps) {
  if (pdfs.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1">
      {pdfs.map((pdf) => (
        <PdfChip
          key={pdf.id}
          pdf={pdf}
          onRemove={() => onRemove(pdf.id)}
          disabled={disabled}
        />
      ))}
    </div>
  )
}
