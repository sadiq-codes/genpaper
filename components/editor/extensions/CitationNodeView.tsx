'use client'

import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { ExternalLink, Copy, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export function CitationNodeView({ node, selected, deleteNode }: NodeViewProps) {
  const { authors, title, year, journal, doi, id } = node.attrs
  
  // Format citation text: (Author et al., 2020) or (Author, 2020)
  const authorPart = authors?.length > 0 
    ? authors[0].split(' ').pop() + (authors.length > 1 ? ' et al.' : '')
    : 'Unknown'
  const citationText = `(${authorPart}, ${year || 'n.d.'})`

  // Format full author list
  const formatAuthors = () => {
    if (!authors || authors.length === 0) return 'Unknown'
    if (authors.length === 1) return authors[0]
    if (authors.length === 2) return `${authors[0]} and ${authors[1]}`
    return `${authors[0]}, ${authors[1]}, et al.`
  }

  const handleCopyBibtex = () => {
    const bibtex = `@article{${id},
  author = {${authors?.join(' and ') || 'Unknown'}},
  title = {${title}},
  year = {${year || 'n.d.'}},
  journal = {${journal || ''}}${doi ? `,\n  doi = {${doi}}` : ''}
}`
    navigator.clipboard.writeText(bibtex)
    toast.success('BibTeX copied to clipboard')
  }

  const handleOpenDoi = () => {
    if (doi) {
      window.open(`https://doi.org/${doi}`, '_blank')
    }
  }

  return (
    <NodeViewWrapper as="span" className="inline">
      <Popover>
        <PopoverTrigger asChild>
          <span
            className={cn(
              'citation-inline cursor-pointer text-primary hover:text-primary/80 hover:underline transition-colors',
              selected && 'ring-2 ring-primary ring-offset-1 rounded'
            )}
            data-citation={id}
            data-type="citation"
          >
            {citationText}
          </span>
        </PopoverTrigger>
        <PopoverContent 
          className="w-80 p-0" 
          align="start"
          side="bottom"
        >
          <div className="p-4 space-y-3">
            {/* Title */}
            <h4 className="font-medium text-sm leading-tight line-clamp-2">
              {title || 'Untitled'}
            </h4>
            
            {/* Authors */}
            <p className="text-xs text-muted-foreground">
              {formatAuthors()}
            </p>
            
            {/* Journal and Year */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {journal && (
                <span className="italic">{journal}</span>
              )}
              {journal && year && <span>-</span>}
              {year && <span>{year}</span>}
            </div>

            {/* DOI */}
            {doi && (
              <p className="text-xs text-muted-foreground font-mono truncate">
                DOI: {doi}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="border-t px-2 py-2 flex items-center gap-1 bg-muted/30">
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-7 text-xs"
              onClick={handleCopyBibtex}
            >
              <Copy className="h-3 w-3 mr-1" />
              Copy BibTeX
            </Button>
            
            {doi && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-7 text-xs"
                onClick={handleOpenDoi}
              >
                <ExternalLink className="h-3 w-3 mr-1" />
                Open
              </Button>
            )}
            
            <div className="flex-1" />
            
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={deleteNode}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  )
}
