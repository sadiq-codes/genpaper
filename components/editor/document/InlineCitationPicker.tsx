'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { Editor } from '@tiptap/react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { AtSign, Search } from 'lucide-react'
import type { ProjectPaper, Citation } from '../types'
import { cn } from '@/lib/utils'

// =============================================================================
// TYPES
// =============================================================================

interface InlineCitationPickerProps {
  editor: Editor
  papers: ProjectPaper[]
  selectionTo: number
  onInsertCitation: (citation: Citation) => void
  onClose: () => void
}

// =============================================================================
// HELPERS
// =============================================================================

function formatAuthors(authors: string[] | undefined): string {
  if (!authors || authors.length === 0) return 'Unknown'
  if (authors.length === 1) return authors[0]
  if (authors.length === 2) return authors.join(' & ')
  return `${authors[0]} et al.`
}

function matchesQuery(paper: ProjectPaper, query: string): boolean {
  const q = query.toLowerCase()
  if (paper.title.toLowerCase().includes(q)) return true
  if (paper.authors?.some(a => a.toLowerCase().includes(q))) return true
  if (paper.year && String(paper.year).includes(q)) return true
  if (paper.journal?.toLowerCase().includes(q)) return true
  return false
}

// =============================================================================
// COMPONENT
// =============================================================================

export function InlineCitationPicker({
  editor,
  papers,
  selectionTo,
  onInsertCitation,
  onClose,
}: InlineCitationPickerProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Position below cursor
  const [position, setPosition] = useState({ top: 0, left: 0 })

  useEffect(() => {
    try {
      const editorContainer = editor.view.dom.closest('.ProseMirror')?.parentElement
      if (!editorContainer) return
      const containerRect = editorContainer.getBoundingClientRect()
      const coords = editor.view.coordsAtPos(selectionTo)
      setPosition({
        top: coords.bottom - containerRect.top + 4,
        left: Math.min(
          Math.max(coords.left - containerRect.left, 16),
          containerRect.width - 320
        ),
      })
    } catch {
      // fallback
    }
    inputRef.current?.focus()
  }, [editor, selectionTo])

  // Filter papers
  const filtered = useMemo(() => {
    if (!query.trim()) return papers
    return papers.filter(p => matchesQuery(p, query))
  }, [papers, query])

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [filtered.length])

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const item = list.querySelector(`[data-index="${selectedIndex}"]`) as HTMLElement | null
    if (item) {
      item.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  const handleSelect = useCallback((paper: ProjectPaper) => {
    onInsertCitation({
      id: paper.id,
      authors: paper.authors,
      title: paper.title,
      year: paper.year,
      journal: paper.journal,
      doi: paper.doi,
    })
    onClose()
  }, [onInsertCitation, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[selectedIndex]) {
        handleSelect(filtered[selectedIndex])
      }
    }
  }, [filtered, selectedIndex, handleSelect, onClose])

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-citation-picker]')) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  return (
    <div
      data-citation-picker
      className="absolute z-50"
      style={{ top: position.top, left: position.left }}
    >
      <div className="w-[300px] rounded-lg border bg-popover shadow-lg overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-2 px-3 py-2 border-b">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search papers..."
            className="flex-1 text-sm bg-transparent border-none outline-none placeholder:text-muted-foreground/50"
            autoFocus
          />
          <span className="text-[10px] text-muted-foreground shrink-0">Esc to close</span>
        </div>

        {/* Paper list */}
        <ScrollArea className="max-h-[240px]">
          <div ref={listRef}>
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                {papers.length === 0
                  ? 'No papers in project'
                  : 'No matching papers'}
              </div>
            ) : (
              filtered.map((paper, index) => (
                <button
                  key={paper.id}
                  data-index={index}
                  className={cn(
                    "w-full text-left px-3 py-2 transition-colors",
                    index === selectedIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted/50"
                  )}
                  onClick={() => handleSelect(paper)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <p className="text-sm font-medium leading-snug line-clamp-1">
                    {paper.title}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {formatAuthors(paper.authors)}{paper.year ? ` · ${paper.year}` : ''}
                  </p>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
