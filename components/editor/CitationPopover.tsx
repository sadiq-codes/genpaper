'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { ExternalLink, Copy, Trash2, Pencil, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { CitationEditModal } from './CitationEditModal'
import type { ProjectPaper } from './types'
import { clearPaperCache } from '@/lib/citations/local-formatter'

interface CitationPopoverProps {
  editor: Editor | null
  projectId?: string
  papers?: ProjectPaper[]  // Papers are passed directly, no API calls needed
  /** Allows parent to update local papers state immediately after editing citation metadata */
  onPaperUpdated?: (paperId: string, updates: Partial<ProjectPaper>) => void
}

/**
 * Paper info for display in popover
 * Now derived locally from papers prop instead of CitationManager
 */
interface PaperInfo {
  id: string
  title: string
  authors: string[]
  year: number | null
  journal?: string
  doi?: string
  pdfUrl?: string
}

export function CitationPopover({ editor, projectId, papers = [], onPaperUpdated }: CitationPopoverProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [citationId, setCitationId] = useState<string | null>(null)
  const [citedContent, setCitedContent] = useState<string | null>(null)
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null)
  const [isMounted, setIsMounted] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Create a quick lookup map from papers
  const paperMap = useMemo(() => {
    const map = new Map<string, PaperInfo>()
    for (const paper of papers) {
      map.set(paper.id, {
        id: paper.id,
        title: paper.title || 'Untitled',
        authors: paper.authors || [],
        year: paper.year || null,
        journal: paper.journal,
        doi: paper.doi,
        pdfUrl: paper.pdfUrl,
      })
    }
    return map
  }, [papers])

  // Get paper info from local papers (instant, no API)
  const paper = useMemo(() => {
    if (!citationId) return null
    return paperMap.get(citationId) || null
  }, [citationId, paperMap])

  // Track mount state for SSR
  useEffect(() => {
    setIsMounted(true)
  }, [])

  // Open popover for a citation element
  const openPopover = useCallback((citation: HTMLElement) => {
    const id = citation.getAttribute('data-citation')
    if (!id) return

    // Get cited content (quote) from the element
    const quoted = citation.getAttribute('data-cited-content')
    setCitedContent(quoted && quoted.trim().length > 0 ? quoted : null)

    // Position popover below the citation
    const rect = citation.getBoundingClientRect()
    let left = rect.left
    let top = rect.bottom + 8

    // Keep within viewport
    if (left + 320 > window.innerWidth) {
      left = window.innerWidth - 330
    }
    if (top + 200 > window.innerHeight) {
      top = rect.top - 208
    }

    setPosition({ top, left })
    setCitationId(id)
    setTargetElement(citation)
    setIsOpen(true)
  }, [])

  // Handle click on citation
  const handleClick = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement
    const citation = target.closest('[data-citation]') as HTMLElement
    
    if (citation) {
      e.preventDefault()
      e.stopPropagation()
      // Clear any pending hover timeout
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
        hoverTimeoutRef.current = null
      }
      openPopover(citation)
    }
  }, [openPopover])

  // Handle hover on citation
  const handleMouseEnter = useCallback((e: MouseEvent) => {
    // Don't open on hover if edit modal is open
    if (isEditModalOpen) return
    
    const target = e.target as Element | null
    if (!target || typeof target.closest !== 'function') return
    
    const citation = target.closest('[data-citation]') as HTMLElement | null
    
    if (citation) {
      // Clear any existing timeout
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
      }
      // Delay before showing popover on hover
      hoverTimeoutRef.current = setTimeout(() => {
        openPopover(citation)
      }, 300)
    }
  }, [openPopover, isEditModalOpen])

  // Handle mouse leave from citation
  const handleMouseLeave = useCallback((e: MouseEvent) => {
    // Don't close on mouse leave if edit modal is open
    if (isEditModalOpen) return
    
    const target = e.target as Element | null
    if (!target || typeof target.closest !== 'function') return
    
    const citation = target.closest('[data-citation]') as HTMLElement | null
    const relatedTarget = e.relatedTarget as HTMLElement | null
    
    if (citation) {
      // Clear pending hover timeout
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
        hoverTimeoutRef.current = null
      }
      
      // Don't close if moving to the popover
      if (relatedTarget && popoverRef.current?.contains(relatedTarget)) {
        return
      }
      
      // Close popover when leaving citation (unless it was clicked)
      // We use a small delay to allow moving to the popover
      setTimeout(() => {
        if (!popoverRef.current?.matches(':hover') && !citation.matches(':hover')) {
          setIsOpen(false)
        }
      }, 100)
    }
  }, [isEditModalOpen])

  // Handle mouse leave from popover
  const handlePopoverMouseLeave = useCallback(() => {
    // Don't close on mouse leave if edit modal is open
    if (isEditModalOpen) return
    
    // Close when leaving popover unless hovering back to citation
    setTimeout(() => {
      if (targetElement && !targetElement.matches(':hover') && !popoverRef.current?.matches(':hover')) {
        setIsOpen(false)
      }
    }, 100)
  }, [targetElement, isEditModalOpen])

  // Close on click outside
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (!isOpen || isEditModalOpen) return
    const target = e.target as HTMLElement
    if (popoverRef.current?.contains(target)) return
    if (target.closest('[data-citation]')) return
    setIsOpen(false)
  }, [isOpen, isEditModalOpen])

  // Close on escape
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && !isEditModalOpen) setIsOpen(false)
  }, [isEditModalOpen])

  useEffect(() => {
    if (!isMounted) return
    
    document.addEventListener('click', handleClick, true)
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mouseenter', handleMouseEnter, true)
    document.addEventListener('mouseleave', handleMouseLeave, true)
    
    return () => {
      document.removeEventListener('click', handleClick, true)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mouseenter', handleMouseEnter, true)
      document.removeEventListener('mouseleave', handleMouseLeave, true)
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
      }
    }
  }, [isMounted, handleClick, handleClickOutside, handleKeyDown, handleMouseEnter, handleMouseLeave])

  // Delete citation from editor
  const handleDelete = useCallback(() => {
    if (!editor || !citationId) return
    
    const { doc } = editor.state
    let pos: number | null = null
    
    doc.descendants((node, nodePos) => {
      if (node.type.name === 'citation' && node.attrs.id === citationId) {
        pos = nodePos
        return false
      }
      return true
    })
    
    if (pos !== null) {
      editor.chain().focus().deleteRange({ from: pos, to: pos + 1 }).run()
      setIsOpen(false)
    }
  }, [editor, citationId])

  // Copy BibTeX
  const handleCopyBibtex = useCallback(() => {
    if (!paper) return
    const { title, year, journal, doi, authors } = paper
    const bibtex = `@article{${citationId},
  author = {${(authors || []).join(' and ') || 'Unknown'}},
  title = {${title || ''}},
  year = {${year || 'n.d.'}},
  journal = {${journal || ''}}${doi ? `,\n  doi = {${doi}}` : ''}
}`
    navigator.clipboard.writeText(bibtex)
    toast.success('BibTeX copied')
  }, [paper, citationId])

  // Handle edit click
  const handleEdit = useCallback(() => {
    if (!citationId || !projectId) {
      toast.error('Cannot edit: missing citation or project information')
      return
    }
    setIsEditModalOpen(true)
  }, [citationId, projectId])

  // Handle save from edit modal
  const handleSaveEdit = useCallback(async (cslJson: {
    id?: string
    title: string
    author: Array<{ family: string; given: string; literal?: string }>
    type: string
    'container-title'?: string
    issued?: { 'date-parts': number[][] }
    DOI?: string
    URL?: string
    volume?: string
    issue?: string
    page?: string
    publisher?: string
  }) => {
    if (!citationId || !projectId) {
      throw new Error('No citation selected')
    }

    // Save to database via API
    const response = await fetch(`/api/citations/${citationId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        csl_json: cslJson
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Failed to update citation')
    }

    // Update local paper metadata immediately (no refresh)
    const nextTitle = cslJson.title
    const nextAuthors = (cslJson.author || [])
      .map(a => (a.family && a.given ? `${a.family}, ${a.given}` : (a.family || a.given || a.literal || '')))
      .filter(Boolean)
    const nextYear = cslJson.issued?.['date-parts']?.[0]?.[0]
    const nextJournal = cslJson['container-title']
    const nextDoi = cslJson.DOI

    // Build updated paper object
    const updatedPaperData: Partial<ProjectPaper> = {
      title: nextTitle,
      authors: nextAuthors,
      ...(typeof nextYear === 'number' && { year: nextYear }),
      journal: nextJournal,
      doi: nextDoi,
    }

    // Update editor storage FIRST (before clearing cache)
    // This ensures when CitationNodeView re-renders, it has fresh data
    if (editor) {
      const citationExt = editor.extensionManager.extensions.find(e => e.name === 'citation')
      if (citationExt?.storage?.papers) {
        const currentPapers = citationExt.storage.papers as typeof papers
        const updatedPapers = currentPapers.map(p => 
          p.id === citationId ? { ...p, ...updatedPaperData } : p
        )
        
        // Clear cache AFTER storage is updated with new data
        clearPaperCache(citationId)
        
        // Now dispatch the update - CitationNodeView will re-render with new data
        editor.commands.setPapers(updatedPapers)
      }
    }

    // Also notify parent to keep React state in sync
    onPaperUpdated?.(citationId, updatedPaperData)

    toast.success('Citation updated')
    setIsEditModalOpen(false)
  }, [citationId, projectId, onPaperUpdated, editor, papers])

  if (!isOpen) return null

  // Get rendered text from the citation element in DOM (for fallback display)
  const renderedText = citationId 
    ? document.querySelector(`[data-citation="${citationId}"]`)?.textContent || `[${citationId.slice(0, 8)}...]`
    : ''

  return (
    <>
      {createPortal(
        <div
          ref={popoverRef}
          onMouseLeave={handlePopoverMouseLeave}
          className={cn(
            'fixed z-50 w-80 rounded-xl border border-border/40 bg-popover shadow-lg animate-in fade-in-0 zoom-in-95'
          )}
          style={{ top: position.top, left: position.left }}
        >
          {paper ? (
            <>
              <div className="p-4 space-y-2">
                <h4 className="font-instrument text-sm tracking-tight line-clamp-2">{paper.title}</h4>
                <p className="text-xs text-muted-foreground">
                  {(paper.authors || []).slice(0, 3).join(', ')}
                  {(paper.authors || []).length > 3 && ' et al.'}
                </p>
                <div className="text-xs text-muted-foreground">
                  {paper.journal && <span className="italic">{paper.journal}</span>}
                  {paper.journal && paper.year && ' · '}
                  {paper.year}
                </div>
                {citedContent && (
                  <div className="pt-2 mt-2 border-t border-border/30">
                    <div className="text-[11px] text-muted-foreground mb-1 uppercase tracking-wide font-medium">Cited passage</div>
                    <div className="text-sm italic text-foreground/80">&ldquo;{citedContent}&rdquo;</div>
                  </div>
                )}
              </div>
              <div className="border-t border-border/30 px-2 py-2 flex gap-1">
                {projectId && (
                  <button onClick={handleEdit} className="inline-flex items-center gap-1 h-7 px-2 rounded-full text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                )}
                <button onClick={handleCopyBibtex} className="inline-flex items-center gap-1 h-7 px-2 rounded-full text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                  <Copy className="h-3 w-3" /> BibTeX
                </button>
                {paper.doi && (
                  <button
                    onClick={() => window.open(`https://doi.org/${paper.doi}`, '_blank')}
                    className="inline-flex items-center gap-1 h-7 px-2 rounded-full text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  >
                    <ExternalLink className="h-3 w-3" /> DOI
                  </button>
                )}
                {paper.pdfUrl && (
                  <button
                    onClick={() => window.open(paper.pdfUrl, '_blank')}
                    className="inline-flex items-center gap-1 h-7 px-2 rounded-full text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  >
                    <FileText className="h-3 w-3" /> PDF
                  </button>
                )}
                <div className="flex-1" />
                <button
                  onClick={handleDelete}
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-full text-[11px] text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </>
          ) : (
            <div className="p-4 space-y-2">
              <div className="text-sm font-instrument tracking-tight text-muted-foreground">
                Citation not found in project papers
              </div>
              {renderedText && (
                <div className="text-xs text-muted-foreground">
                  Citation text: <span className="font-mono text-[11px]">{renderedText}</span>
                </div>
              )}
              {citationId && (
                <div className="text-xs text-muted-foreground mt-2">
                  ID: <span className="font-mono text-[11px]">{citationId.slice(0, 8)}...</span>
                </div>
              )}
              <div className="border-t border-border/30 pt-2 mt-2 flex gap-1">
                {projectId && citationId && (
                  <button
                    onClick={handleEdit}
                    className="inline-flex items-center gap-1 h-7 px-2 rounded-full text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  >
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                )}
                <div className="flex-1" />
                <button
                  onClick={handleDelete}
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-full text-[11px] text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
              </div>
            </div>
          )}
        </div>,
        document.body
      )}

      {/* Edit Modal */}
      {citationId && projectId && (
        <CitationEditModal
          open={isEditModalOpen}
          onOpenChange={setIsEditModalOpen}
          paperId={citationId}
          projectId={projectId}
          initialData={paper ? {
            id: paper.id,
            type: 'article-journal',
            title: paper.title || '',
            author: (paper.authors || []).map(name => {
              // Parse author name into family/given
              if (name.includes(',')) {
                const [family, given] = name.split(',').map(s => s.trim())
                return { family, given: given || '' }
              }
              const parts = name.trim().split(/\s+/)
              if (parts.length === 1) {
                return { family: parts[0], given: '' }
              }
              return { 
                family: parts[parts.length - 1], 
                given: parts.slice(0, -1).join(' ') 
              }
            }),
            'container-title': paper.journal,
            issued: paper.year ? { 'date-parts': [[paper.year]] } : undefined,
            DOI: paper.doi,
          } : undefined}
          onSave={handleSaveEdit}
        />
      )}
    </>
  )
}
