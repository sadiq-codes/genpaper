'use client'

import { useEffect, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { closeCiteDialogEffect, citeUIState } from './extensions/citeBridge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

interface CiteDialogProps {
  editorView: EditorView | null
}

interface Paper {
  id: string
  title: string
  authors?: string[]
  year?: number
  doi?: string
  url?: string
}

export function CiteDialog({ editorView }: CiteDialogProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Paper[]>([])
  const [loading, setLoading] = useState(false)

  // Subscribe to editor state to know when to open
  useEffect(() => {
    if (!editorView) return

    let lastOpen = false
    const updateListener = EditorView.updateListener.of(() => {
      const state = editorView.state.field(citeUIState)
      if (state.open !== lastOpen) {
        setOpen(state.open)
        lastOpen = state.open
      }
    })

    editorView.dispatch({
      effects: EditorView.appendConfig.of(updateListener)
    })

    return () => {
      // Cleanup is handled by editor destruction
    }
  }, [editorView])

  const searchPapers = async () => {
    if (!query.trim()) return
    
    setLoading(true)
    try {
      // TODO: Replace with actual search API call
      const response = await fetch(`/api/search-papers?q=${encodeURIComponent(query)}`)
      const data = await response.json()
      setResults(data.papers || [])
    } catch (error) {
      console.error('Failed to search papers:', error)
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  const onPick = async (paper: Paper) => {
    if (!editorView) return

    // Insert citation placeholder
    const selection = editorView.state.selection.main
    let placeholder = ''
    
    if (paper.doi) {
      placeholder = `[[CITE:doi:${paper.doi}]]`
    } else {
      // Use title as fallback
      const sanitizedTitle = paper.title.replace(/[[\]]/g, '').substring(0, 50)
      placeholder = `[[CITE:title:${sanitizedTitle}]]`
    }

    editorView.dispatch({
      changes: { from: selection.to, to: selection.to, insert: ` ${placeholder}` },
      effects: closeCiteDialogEffect.of(null),
      selection: { anchor: selection.to + placeholder.length + 1 }
    })

    // Reset dialog state
    setQuery('')
    setResults([])
    setOpen(false)
  }

  const handleClose = () => {
    if (editorView) {
      editorView.dispatch({
        effects: closeCiteDialogEffect.of(null)
      })
    }
    setOpen(false)
  }

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent side="right" className="w-[520px]">
        <SheetHeader>
          <SheetTitle>Add Citation</SheetTitle>
        </SheetHeader>
        
        <div className="mt-6 space-y-4">
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search library or web..."
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  searchPapers()
                }
              }}
            />
            <Button onClick={searchPapers} disabled={loading}>
              {loading ? 'Searching...' : 'Search'}
            </Button>
          </div>

          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {results.length === 0 && query && !loading && (
              <div className="text-center text-muted-foreground py-8">
                No papers found. Try a different search term.
              </div>
            )}
            
            {results.map((paper) => (
              <div
                key={paper.id}
                className="p-3 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                onClick={() => onPick(paper)}
              >
                <div className="font-medium text-sm line-clamp-2">
                  {paper.title}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {paper.authors?.join(', ')} {paper.year && `· ${paper.year}`}
                </div>
                {paper.doi && (
                  <div className="text-xs text-blue-600 mt-1">
                    DOI: {paper.doi}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}