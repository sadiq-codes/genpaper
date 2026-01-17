'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { Button } from '@/components/ui/button'
import { ExternalLink, Copy, Trash2, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { CitationEditModal } from './CitationEditModal'
import type { ProjectPaper } from './types'

interface CitationPopoverProps {
  editor: Editor | null
  projectId?: string
  papers?: ProjectPaper[]  // Papers are passed directly, no API calls needed
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
}

export function CitationPopover({ editor, projectId, papers = [] }: CitationPopoverProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [citationId, setCitationId] = useState<string | null>(null)
  const [_targetElement, setTargetElement] = useState<HTMLElement | null>(null)
  const [isMounted, setIsMounted] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

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

  // Handle click on citation
  const handleClick = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement
    const citation = target.closest('[data-citation]') as HTMLElement
    
    if (citation) {
      e.preventDefault()
      e.stopPropagation()
      
      const id = citation.getAttribute('data-citation')
      if (!id) return

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
    }
  }, [])

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
    return () => {
      document.removeEventListener('click', handleClick, true)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isMounted, handleClick, handleClickOutside, handleKeyDown])

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

    // Close the modal - changes will reflect on next page load/refresh
    toast.success('Citation updated')
    setIsEditModalOpen(false)
  }, [citationId, projectId])

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
          className={cn(
            'fixed z-50 w-80 rounded-lg border bg-popover shadow-lg animate-in fade-in-0 zoom-in-95'
          )}
          style={{ top: position.top, left: position.left }}
        >
          {paper ? (
            <>
              <div className="p-4 space-y-2">
                <h4 className="font-medium text-sm line-clamp-2">{paper.title}</h4>
                <p className="text-xs text-muted-foreground">
                  {(paper.authors || []).slice(0, 3).join(', ')}
                  {(paper.authors || []).length > 3 && ' et al.'}
                </p>
                <div className="text-xs text-muted-foreground">
                  {paper.journal && <span className="italic">{paper.journal}</span>}
                  {paper.journal && paper.year && ' - '}
                  {paper.year}
                </div>
              </div>
              <div className="border-t px-2 py-2 flex gap-1 bg-muted/30">
                {projectId && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleEdit}>
                    <Pencil className="h-3 w-3 mr-1" /> Edit
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleCopyBibtex}>
                  <Copy className="h-3 w-3 mr-1" /> BibTeX
                </Button>
                {paper.doi && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => window.open(`https://doi.org/${paper.doi}`, '_blank')}
                  >
                    <ExternalLink className="h-3 w-3 mr-1" /> DOI
                  </Button>
                )}
                <div className="flex-1" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-destructive"
                  onClick={handleDelete}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </>
          ) : (
            <div className="p-4 space-y-2">
              <div className="text-sm font-medium text-muted-foreground">
                Citation not found in project papers
              </div>
              {renderedText && (
                <div className="text-xs text-muted-foreground">
                  Citation text: <span className="font-mono">{renderedText}</span>
                </div>
              )}
              {citationId && (
                <div className="text-xs text-muted-foreground mt-2">
                  ID: <span className="font-mono">{citationId.slice(0, 8)}...</span>
                </div>
              )}
              <div className="border-t pt-2 mt-2 flex gap-1">
                {projectId && citationId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={handleEdit}
                  >
                    <Pencil className="h-3 w-3 mr-1" /> Edit
                  </Button>
                )}
                <div className="flex-1" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-destructive"
                  onClick={handleDelete}
                >
                  <Trash2 className="h-3 w-3 mr-1" /> Delete
                </Button>
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
          onSave={handleSaveEdit}
        />
      )}
    </>
  )
}
