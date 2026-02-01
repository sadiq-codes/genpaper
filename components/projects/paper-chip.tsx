'use client'

import { BookOpen, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SelectedPaper } from './types'

interface PaperChipProps {
  paper: SelectedPaper
  onRemove: () => void
  disabled?: boolean
}

function formatAuthors(authors: string[]): string {
  if (!authors || authors.length === 0) return ''
  if (authors.length === 1) return authors[0]
  return `${authors[0]} et al.`
}

export function PaperChip({ paper, onRemove, disabled }: PaperChipProps) {
  const authorStr = formatAuthors(paper.authors)
  const yearStr = paper.year ? ` (${paper.year})` : ''

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm',
        'border transition-colors',
        'bg-primary/10 border-primary/30 text-primary-foreground'
      )}
      title={`${paper.title}${authorStr ? ` - ${authorStr}` : ''}${yearStr}`}
    >
      {/* Icon */}
      <BookOpen className="h-3.5 w-3.5 flex-shrink-0 text-primary" />

      {/* Title */}
      <span className="max-w-[120px] sm:max-w-[180px] truncate text-foreground">
        {paper.title}
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
        aria-label={`Remove ${paper.title}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

interface PaperChipListProps {
  papers: SelectedPaper[]
  onRemove: (id: string) => void
  disabled?: boolean
}

export function PaperChipList({ papers, onRemove, disabled }: PaperChipListProps) {
  if (papers.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1">
      {papers.map((paper) => (
        <PaperChip
          key={paper.id}
          paper={paper}
          onRemove={() => onRemove(paper.id)}
          disabled={disabled}
        />
      ))}
    </div>
  )
}
