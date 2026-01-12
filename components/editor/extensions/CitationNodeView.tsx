'use client'

import { useState, useEffect } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { ExternalLink, Copy, Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface PaperInfo {
  id: string
  title: string
  authors: string[]
  year: number | null
  journal?: string
  doi?: string
}

// Cache for fetched paper info to avoid repeated API calls
const paperCache = new Map<string, PaperInfo>()

export function CitationNodeView({ node, selected, deleteNode, updateAttributes }: NodeViewProps) {
  const { id, authors: initialAuthors, title: initialTitle, year: initialYear, journal: initialJournal, doi: initialDoi } = node.attrs
  
  // Check if we have full paper info or just the ID
  const hasFullInfo = initialAuthors?.length > 0 || initialTitle
  
  const [paperInfo, setPaperInfo] = useState<PaperInfo | null>(
    hasFullInfo ? {
      id,
      title: initialTitle || '',
      authors: initialAuthors || [],
      year: initialYear,
      journal: initialJournal,
      doi: initialDoi,
    } : null
  )
  const [isLoading, setIsLoading] = useState(!hasFullInfo)
  const [error, setError] = useState<string | null>(null)
  
  // Fetch paper info if we only have the ID
  useEffect(() => {
    if (hasFullInfo || !id) return
    
    // Check cache first
    const cached = paperCache.get(id)
    if (cached) {
      setPaperInfo(cached)
      setIsLoading(false)
      // Update node attributes with cached data
      updateAttributes({
        authors: cached.authors,
        title: cached.title,
        year: cached.year,
        journal: cached.journal,
        doi: cached.doi,
      })
      return
    }
    
    // Fetch from API
    const fetchPaper = async () => {
      try {
        const res = await fetch(`/api/papers/${id}`)
        if (!res.ok) {
          throw new Error('Paper not found')
        }
        const paper = await res.json()
        
        const info: PaperInfo = {
          id: paper.id,
          title: paper.title || 'Untitled',
          authors: paper.authors || [],
          year: paper.year || paper.publication_date ? new Date(paper.publication_date).getFullYear() : null,
          journal: paper.journal || paper.venue,
          doi: paper.doi,
        }
        
        // Cache it
        paperCache.set(id, info)
        setPaperInfo(info)
        
        // Update node attributes so subsequent renders don't need to fetch
        updateAttributes({
          authors: info.authors,
          title: info.title,
          year: info.year,
          journal: info.journal,
          doi: info.doi,
        })
      } catch (err) {
        console.error('Failed to fetch paper info:', err)
        setError('Citation not found')
      } finally {
        setIsLoading(false)
      }
    }
    
    fetchPaper()
  }, [id, hasFullInfo, updateAttributes])
  
  // Format citation text: (Author et al., 2020) or (Author, 2020)
  const formatCitationText = () => {
    if (isLoading) return '(...)'
    if (error || !paperInfo) return `[${id?.slice(0, 8) || '?'}]`
    
    const { authors, year } = paperInfo
    const authorPart = authors?.length > 0 
      ? authors[0].split(' ').pop() + (authors.length > 1 ? ' et al.' : '')
      : 'Unknown'
    return `(${authorPart}, ${year || 'n.d.'})`
  }

  // Format full author list
  const formatAuthors = () => {
    const authors = paperInfo?.authors
    if (!authors || authors.length === 0) return 'Unknown'
    if (authors.length === 1) return authors[0]
    if (authors.length === 2) return `${authors[0]} and ${authors[1]}`
    return `${authors[0]}, ${authors[1]}, et al.`
  }

  const handleCopyBibtex = () => {
    if (!paperInfo) return
    const { authors, title, year, journal, doi } = paperInfo
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
    if (paperInfo?.doi) {
      window.open(`https://doi.org/${paperInfo.doi}`, '_blank')
    }
  }

  return (
    <NodeViewWrapper as="span" className="inline">
      <Popover>
        <PopoverTrigger asChild>
          <span
            className={cn(
              'citation-inline cursor-pointer text-primary hover:text-primary/80 hover:underline transition-colors',
              selected && 'ring-2 ring-primary ring-offset-1 rounded',
              isLoading && 'opacity-50',
              error && 'text-destructive'
            )}
            data-citation={id}
            data-type="citation"
          >
            {formatCitationText()}
          </span>
        </PopoverTrigger>
        <PopoverContent 
          className="w-80 p-0" 
          align="start"
          side="bottom"
        >
          {isLoading ? (
            <div className="p-4 flex items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading citation...</span>
            </div>
          ) : error ? (
            <div className="p-4">
              <p className="text-sm text-destructive">{error}</p>
              <p className="text-xs text-muted-foreground mt-1">Paper ID: {id}</p>
            </div>
          ) : paperInfo ? (
            <>
              <div className="p-4 space-y-3">
                {/* Title */}
                <h4 className="font-medium text-sm leading-tight line-clamp-2">
                  {paperInfo.title || 'Untitled'}
                </h4>
                
                {/* Authors */}
                <p className="text-xs text-muted-foreground">
                  {formatAuthors()}
                </p>
                
                {/* Journal and Year */}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {paperInfo.journal && (
                    <span className="italic">{paperInfo.journal}</span>
                  )}
                  {paperInfo.journal && paperInfo.year && <span>-</span>}
                  {paperInfo.year && <span>{paperInfo.year}</span>}
                </div>

                {/* DOI */}
                {paperInfo.doi && (
                  <p className="text-xs text-muted-foreground font-mono truncate">
                    DOI: {paperInfo.doi}
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
                
                {paperInfo.doi && (
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
            </>
          ) : null}
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  )
}
