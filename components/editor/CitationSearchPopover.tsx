'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, BookOpen, Users, Calendar, ExternalLink, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card } from '@/components/ui/card'

interface PaperResult {
  id: string
  title: string
  authors: string[]
  year: number | null
  journal?: string
  abstract?: string
  doi?: string
  type: 'library' | 'search' | 'suggestion'
}

interface CitationSearchPopoverProps {
  position: { x: number; y: number }
  onSelect: (paperId: string, displayText: string) => void
  onClose: () => void
}

export default function CitationSearchPopover({ 
  position, 
  onSelect, 
  onClose 
}: CitationSearchPopoverProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PaperResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const popoverRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Position popover
  useEffect(() => {
    if (popoverRef.current) {
      const rect = popoverRef.current.getBoundingClientRect()
      const viewportHeight = window.innerHeight
      const viewportWidth = window.innerWidth
      
      let top = position.y + 10
      let left = position.x
      
      // Adjust if popover would go off screen
      if (top + rect.height > viewportHeight) {
        top = position.y - rect.height - 10
      }
      if (left + rect.width > viewportWidth) {
        left = viewportWidth - rect.width - 10
      }
      
      popoverRef.current.style.top = `${top}px`
      popoverRef.current.style.left = `${left}px`
    }
  }, [position])

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [])

  // Search for papers
  const searchPapers = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([])
      return
    }

    setIsLoading(true)
    try {
      // Search user's library first
      const libraryResponse = await fetch(`/api/library-search?q=${encodeURIComponent(searchQuery)}&limit=3`)
      const libraryResults = libraryResponse.ok ? await libraryResponse.json() : []

      // Search external sources
      const searchResponse = await fetch(`/api/search-papers?q=${encodeURIComponent(searchQuery)}&limit=5`)
      const searchResults = searchResponse.ok ? await searchResponse.json() : []

      const combined: PaperResult[] = [
        // Library papers first
        ...libraryResults.map((paper: any) => ({
          id: paper.paper_id || paper.id,
          title: paper.title,
          authors: paper.authors || [],
          year: paper.publication_year,
          journal: paper.journal,
          abstract: paper.abstract,
          doi: paper.doi,
          type: 'library' as const
        })),
        // External search results
        ...searchResults.slice(0, 5).map((paper: any) => ({
          id: paper.id || paper.paper_id,
          title: paper.title,
          authors: paper.authors || [],
          year: paper.year,
          journal: paper.journal,
          abstract: paper.abstract,
          doi: paper.doi,
          type: 'search' as const
        }))
      ]

      setResults(combined)
      setSelectedIndex(0)
    } catch (error) {
      console.error('Search error:', error)
      setResults([])
    }
    setIsLoading(false)
  }, [])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query) {
        searchPapers(query)
      } else {
        setResults([])
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [query, searchPapers])

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, results.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (results[selectedIndex]) {
          handleSelect(results[selectedIndex])
        }
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }, [results, selectedIndex, onClose])

  // Handle paper selection
  const handleSelect = useCallback((paper: PaperResult) => {
    const displayText = formatCitation(paper)
    onSelect(paper.id, displayText)
  }, [onSelect])

  // Format citation display text
  const formatCitation = (paper: PaperResult): string => {
    const firstAuthor = paper.authors[0]
    if (!firstAuthor) return `[${paper.title.substring(0, 20)}...]`
    
    const authorName = firstAuthor.split(' ').pop() || firstAuthor
    const year = paper.year ? `, ${paper.year}` : ''
    
    if (paper.authors.length === 1) {
      return `[${authorName}${year}]`
    } else if (paper.authors.length === 2) {
      const secondAuthor = paper.authors[1].split(' ').pop() || paper.authors[1]
      return `[${authorName} & ${secondAuthor}${year}]`
    } else {
      return `[${authorName} et al.${year}]`
    }
  }

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  return (
    <div
      ref={popoverRef}
      className="fixed z-50 w-96 bg-white border border-gray-200 rounded-lg shadow-xl"
      onKeyDown={handleKeyDown}
    >
      <div className="p-3 border-b border-gray-100">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            ref={inputRef}
            placeholder="Search papers to cite..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-10 pr-4"
          />
        </div>
      </div>

      <ScrollArea className="max-h-80">
        <div className="p-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              <span className="ml-2 text-sm text-gray-500">Searching...</span>
            </div>
          ) : results.length > 0 ? (
            <div className="space-y-1">
              {results.map((paper, index) => (
                <Card
                  key={paper.id}
                  className={`p-3 cursor-pointer transition-colors hover:bg-gray-50 ${
                    index === selectedIndex ? 'bg-blue-50 border-blue-200' : ''
                  }`}
                  onClick={() => handleSelect(paper)}
                >
                  <div className="flex items-start gap-2">
                    <BookOpen className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-gray-900 line-clamp-2">
                        {paper.title}
                      </h4>
                      {paper.authors.length > 0 && (
                        <div className="flex items-center gap-1 mt-1">
                          <Users className="h-3 w-3 text-gray-400" />
                          <span className="text-xs text-gray-600 truncate">
                            {paper.authors.join(', ')}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        {paper.year && (
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3 text-gray-400" />
                            <span className="text-xs text-gray-600">{paper.year}</span>
                          </div>
                        )}
                        {paper.journal && (
                          <span className="text-xs text-gray-600 truncate">
                            {paper.journal}
                          </span>
                        )}
                        <Badge 
                          variant="secondary" 
                          className="text-xs"
                        >
                          {paper.type === 'library' ? 'Library' : 'Search'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : query ? (
            <div className="py-6 text-center">
              <BookOpen className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No papers found</p>
              <p className="text-xs text-gray-400 mt-1">Try different keywords</p>
            </div>
          ) : (
            <div className="py-6 text-center">
              <Search className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">Start typing to search</p>
              <p className="text-xs text-gray-400 mt-1">Search your library or external sources</p>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="p-2 border-t border-gray-100 bg-gray-50 rounded-b-lg">
        <div className="flex justify-between items-center text-xs text-gray-500">
          <span>Use ↑↓ to navigate, Enter to select</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-6 px-2 text-xs"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
} 