'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { 
  Search, 
  BookOpen, 
  Plus, 
  X, 
  SortAsc,
  SortDesc,
  ExternalLink,
  Calendar,
  Users,
  Quote,
  Loader2,
  ArrowRight
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import type { LibraryPaper, Paper } from '@/types/simplified'

interface LibraryDrawerProps {
  isOpen: boolean
  onClose: () => void
  onAddToProject?: (paperId: string, title: string) => void
  currentProjectId?: string
  initialQuery?: string
}

interface SearchResult {
  id: string
  title: string
  authors: string[]
  year: number | null
  journal?: string
  abstract?: string
  doi?: string
  url?: string
  citationCount?: number
  source: string
  type: 'library' | 'search'
}

export default function LibraryDrawer({ 
  isOpen, 
  onClose, 
  onAddToProject,
  currentProjectId,
  initialQuery = ''
}: LibraryDrawerProps) {
  // Search state
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [libraryPapers, setLibraryPapers] = useState<SearchResult[]>([])
  const [showOnlineSearch, setShowOnlineSearch] = useState(false)

  // Filter state
  const [sortBy, setSortBy] = useState<'relevance' | 'date' | 'citations' | 'added_at'>('relevance')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [sourceFilter, setSourceFilter] = useState<string>('all')

  // UI state
  const [processingPapers, setProcessingPapers] = useState<Set<string>>(new Set())

  // Load user's library
  const loadLibrary = useCallback(async () => {
    try {
      const response = await fetch('/api/papers?library=me&sortBy=added_at&sortOrder=desc&maxResults=50')
      if (response.ok) {
        const data = await response.json()
        const transformed: SearchResult[] = data.papers.map((item: any) => ({
          id: item.paper.id,
          title: item.paper.title,
          authors: item.paper.author_names || [],
          year: item.paper.publication_date ? new Date(item.paper.publication_date).getFullYear() : null,
          journal: item.paper.venue,
          abstract: item.paper.abstract,
          doi: item.paper.doi,
          url: item.paper.url,
          citationCount: item.paper.citation_count,
          source: item.paper.source,
          type: 'library' as const
        }))
        setLibraryPapers(transformed)
      }
    } catch (error) {
      console.error('Error loading library:', error)
    }
  }, [])

  // Search functionality
  const searchPapers = useCallback(async (searchQuery: string, includeOnline = false) => {
    if (!searchQuery.trim() && !includeOnline) {
      setResults(libraryPapers)
      return
    }

    setIsSearching(true)
    try {
      const searchResults: SearchResult[] = []

      // Search user's library first
      if (searchQuery.trim()) {
        const libraryMatches = libraryPapers.filter(paper =>
          paper.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          paper.authors.some(author => author.toLowerCase().includes(searchQuery.toLowerCase())) ||
          paper.abstract?.toLowerCase().includes(searchQuery.toLowerCase())
        )
        searchResults.push(...libraryMatches)
      }

      // Search online sources if requested
      if (includeOnline || showOnlineSearch) {
        const response = await fetch('/api/library-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: searchQuery,
            options: {
              maxResults: 20,
              sources: ['openalex', 'crossref', 'semantic_scholar'],
              fastMode: true
            }
          })
        })

        if (response.ok) {
          const data = await response.json()
          if (data.success) {
            const onlineResults: SearchResult[] = data.papers
              .filter((paper: any) => !libraryPapers.some(lp => lp.id === paper.canonical_id))
              .map((paper: any) => ({
                id: paper.canonical_id,
                title: paper.title,
                authors: paper.authors || [],
                year: paper.year,
                journal: paper.venue,
                abstract: paper.abstract,
                doi: paper.doi,
                url: paper.url,
                citationCount: paper.citationCount,
                source: paper.source,
                type: 'search' as const
              }))
            searchResults.push(...onlineResults)
          }
        }
      }

      setResults(searchResults)
    } catch (error) {
      console.error('Search error:', error)
    }
    setIsSearching(false)
  }, [libraryPapers, showOnlineSearch])

  // Add paper to current project
  const handleAddToProject = useCallback(async (paper: SearchResult) => {
    if (!currentProjectId) {
      console.warn('No current project to add paper to')
      return
    }

    setProcessingPapers(prev => new Set(prev).add(paper.id))
    
    try {
      // If it's a search result, add to library first
      if (paper.type === 'search') {
        const addResponse = await fetch('/api/library', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paperId: paper.id })
        })

        if (!addResponse.ok) {
          throw new Error('Failed to add paper to library')
        }
      }

      // Add to current project via callback
      onAddToProject?.(paper.id, paper.title)
      
      // Update local state
      if (paper.type === 'search') {
        setLibraryPapers(prev => [...prev, { ...paper, type: 'library' }])
        setResults(prev => prev.map(p => 
          p.id === paper.id ? { ...p, type: 'library' } : p
        ))
      }

    } catch (error) {
      console.error('Error adding paper to project:', error)
    }
    
    setProcessingPapers(prev => {
      const newSet = new Set(prev)
      newSet.delete(paper.id)
      return newSet
    })
  }, [currentProjectId, onAddToProject])

  // Filter and sort results
  const filteredResults = useMemo(() => {
    let filtered = results

    // Apply source filter
    if (sourceFilter !== 'all') {
      filtered = filtered.filter(paper => paper.source === sourceFilter)
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let aValue: any, bValue: any

      switch (sortBy) {
        case 'date':
          aValue = a.year || 0
          bValue = b.year || 0
          break
        case 'citations':
          aValue = a.citationCount || 0
          bValue = b.citationCount || 0
          break
        case 'added_at':
          // Library papers first, then by title
          if (a.type === 'library' && b.type !== 'library') return -1
          if (a.type !== 'library' && b.type === 'library') return 1
          aValue = a.title
          bValue = b.title
          break
        default: // relevance
          aValue = a.title
          bValue = b.title
      }

      if (typeof aValue === 'string') {
        return sortOrder === 'asc' 
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue)
      }

      return sortOrder === 'asc' ? aValue - bValue : bValue - aValue
    })

    return filtered
  }, [results, sourceFilter, sortBy, sortOrder])

  // Initialize
  useEffect(() => {
    if (isOpen) {
      loadLibrary()
    }
  }, [isOpen, loadLibrary])

  // Search when query changes
  useEffect(() => {
    const timer = setTimeout(() => {
      searchPapers(query, showOnlineSearch)
    }, 300)

    return () => clearTimeout(timer)
  }, [query, searchPapers, showOnlineSearch])

  // Set initial query
  useEffect(() => {
    if (isOpen && initialQuery) {
      setQuery(initialQuery)
    }
  }, [isOpen, initialQuery])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-40 pointer-events-none">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/20 pointer-events-auto animate-in fade-in-0 duration-200"
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div className="absolute right-0 top-0 h-full w-96 bg-white border-l border-gray-200 shadow-xl pointer-events-auto animate-in slide-in-from-right duration-300">
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-gray-600" />
              <h2 className="font-semibold text-lg">Library</h2>
              <Badge variant="secondary" className="text-xs">
                {libraryPapers.length}
              </Badge>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Search */}
          <div className="p-4 border-b border-gray-100 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search your library..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Search Options */}
            <div className="flex items-center gap-2">
              <Button
                variant={showOnlineSearch ? "default" : "outline"}
                size="sm"
                onClick={() => setShowOnlineSearch(!showOnlineSearch)}
                className="text-xs"
              >
                <Plus className="h-3 w-3 mr-1" />
                Online Search
              </Button>
              
              <Select value={sortBy} onValueChange={(value: any) => setSortBy(value)}>
                <SelectTrigger className="w-32 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="relevance">Relevance</SelectItem>
                  <SelectItem value="date">Date</SelectItem>
                  <SelectItem value="citations">Citations</SelectItem>
                  <SelectItem value="added_at">Added</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                className="px-2 h-8"
              >
                {sortOrder === 'asc' ? (
                  <SortAsc className="h-3 w-3" />
                ) : (
                  <SortDesc className="h-3 w-3" />
                )}
              </Button>
            </div>
          </div>

          {/* Results */}
          <ScrollArea className="flex-1">
            <div className="p-4">
              {isSearching ? (
                <div className="flex items-center justify-center py-8">
                  <LoadingSpinner text="Searching..." />
                </div>
              ) : filteredResults.length > 0 ? (
                <div className="space-y-3">
                  {filteredResults.map((paper) => (
                    <PaperCard
                      key={paper.id}
                      paper={paper}
                      onAddToProject={() => handleAddToProject(paper)}
                      isProcessing={processingPapers.has(paper.id)}
                      showAddButton={!!currentProjectId}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <BookOpen className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-base font-medium mb-2">
                    {query ? 'No papers found' : 'Your library is empty'}
                  </h3>
                  <p className="text-sm text-gray-500 mb-4">
                    {query 
                      ? 'Try different keywords or enable online search'
                      : 'Start building your research library'
                    }
                  </p>
                  {!showOnlineSearch && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowOnlineSearch(true)}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Search Online
                    </Button>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Footer */}
          <div className="p-4 border-t border-gray-100 bg-gray-50">
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>{filteredResults.length} papers shown</span>
              <div className="flex items-center gap-1">
                <kbd className="inline-flex items-center rounded border bg-white px-1 py-0.5 font-mono">
                  Cmd+K
                </kbd>
                <span>to search</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Paper Card Component
interface PaperCardProps {
  paper: SearchResult
  onAddToProject: () => void
  isProcessing: boolean
  showAddButton: boolean
}

function PaperCard({ paper, onAddToProject, isProcessing, showAddButton }: PaperCardProps) {
  return (
    <Card className="hover:shadow-sm transition-all duration-200 border-border/50 hover:border-border">
      <div className="p-3 space-y-2">
        {/* Title and Type */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-medium text-sm leading-tight line-clamp-2 flex-1">
            {paper.title}
          </h3>
          <div className="flex items-center gap-1">
            <Badge 
              variant={paper.type === 'library' ? 'default' : 'secondary'} 
              className="text-xs"
            >
              {paper.type === 'library' ? 'Library' : 'Search'}
            </Badge>
          </div>
        </div>

        {/* Authors */}
        {paper.authors.length > 0 && (
          <div className="flex items-center gap-1">
            <Users className="h-3 w-3 text-gray-400" />
            <span className="text-xs text-gray-600 line-clamp-1">
              {paper.authors.join(', ')}
            </span>
          </div>
        )}

        {/* Metadata */}
        <div className="flex items-center gap-2 flex-wrap">
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
          {paper.citationCount && (
            <div className="flex items-center gap-1">
              <Quote className="h-3 w-3 text-gray-400" />
              <span className="text-xs text-gray-600">{paper.citationCount}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1">
            {paper.url && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.open(paper.url, '_blank')}
                className="h-6 px-2 text-xs"
              >
                <ExternalLink className="h-3 w-3 mr-1" />
                View
              </Button>
            )}
          </div>
          
          {showAddButton && (
            <Button
              size="sm"
              onClick={onAddToProject}
              disabled={isProcessing}
              className="h-6 px-2 text-xs"
            >
              {isProcessing ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <ArrowRight className="h-3 w-3 mr-1" />
              )}
              {isProcessing ? 'Adding...' : 'Add to Project'}
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
} 