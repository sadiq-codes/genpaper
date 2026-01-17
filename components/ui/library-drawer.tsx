'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Search, 
  BookOpen, 
  Globe, 
  X, 
  ExternalLink,
  Calendar,
  Users,
  Quote,
  Loader2,
  Plus,
  Check,
  Library,
  FileText,
  ChevronDown,
  Sparkles
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

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
  relevanceScore?: number
  source: string
  type: 'library' | 'search'
}

type SearchMode = 'library' | 'online'

// API fetchers
async function fetchLibraryPapers(): Promise<SearchResult[]> {
  const response = await fetch('/api/papers?library=me&sortBy=added_at&sortOrder=desc&maxResults=100')
  if (!response.ok) throw new Error('Failed to load library')
  
  const data = await response.json()
  return data.papers.map((item: any) => ({
    id: item.paper.id,
    title: item.paper.title,
    authors: item.paper.author_names || [],
    year: item.paper.publication_date ? new Date(item.paper.publication_date).getFullYear() : null,
    journal: item.paper.venue,
    abstract: item.paper.abstract,
    doi: item.paper.doi,
    url: item.paper.pdf_url || (item.paper.doi ? `https://doi.org/${item.paper.doi}` : undefined),
    citationCount: item.paper.citation_count,
    source: item.paper.source || 'library',
    type: 'library' as const
  }))
}

async function searchPapersOnline(query: string): Promise<SearchResult[]> {
  const response = await fetch('/api/library-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      options: {
        maxResults: 25,
        sources: ['openalex', 'crossref', 'semantic_scholar']
      }
    })
  })

  if (!response.ok) throw new Error('Search failed')
  
  const data = await response.json()
  if (!data.success) throw new Error('Search failed')
  
  return data.papers.map((paper: any) => ({
    id: paper.canonical_id,
    title: paper.title,
    authors: paper.authors || [],
    year: paper.year,
    journal: paper.venue,
    abstract: paper.abstract,
    doi: paper.doi,
    url: paper.url || (paper.doi ? `https://doi.org/${paper.doi}` : undefined),
    citationCount: paper.citationCount,
    relevanceScore: paper.relevanceScore,
    source: paper.source,
    type: 'search' as const
  }))
}

async function addPaperToLibrary(paperId: string): Promise<void> {
  const response = await fetch('/api/library', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paperId })
  })
  if (!response.ok) throw new Error('Failed to add paper to library')
}

export default function LibraryDrawer({ 
  isOpen, 
  onClose, 
  onAddToProject,
  currentProjectId,
  initialQuery = ''
}: LibraryDrawerProps) {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState(initialQuery)
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [searchMode, setSearchMode] = useState<SearchMode>('library')
  const [expandedAbstract, setExpandedAbstract] = useState<string | null>(null)
  const [addedPapers, setAddedPapers] = useState<Set<string>>(new Set())

  // Fetch library papers with React Query - cached across drawer opens
  const { 
    data: libraryPapers = [], 
    isLoading: isLoadingLibrary 
  } = useQuery({
    queryKey: ['library', 'papers'],
    queryFn: fetchLibraryPapers,
    enabled: isOpen,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  // Online search with React Query
  const { 
    data: onlineResults = [], 
    isLoading: isSearchingOnline,
    isFetching: isFetchingOnline
  } = useQuery({
    queryKey: ['papers', 'search', debouncedQuery],
    queryFn: () => searchPapersOnline(debouncedQuery),
    enabled: isOpen && searchMode === 'online' && debouncedQuery.length >= 3,
    staleTime: 2 * 60 * 1000, // 2 minutes for search results
  })

  // Mutation for adding papers to library
  const addToLibraryMutation = useMutation({
    mutationFn: addPaperToLibrary,
    onSuccess: () => {
      // Invalidate library to refetch
      queryClient.invalidateQueries({ queryKey: ['library', 'papers'] })
    }
  })

  // Debounce search query
  useEffect(() => {
    // For online search, require minimum 3 characters
    if (searchMode === 'online' && query.trim().length < 3) {
      setDebouncedQuery('')
      return
    }
    
    const timer = setTimeout(() => {
      setDebouncedQuery(query)
    }, searchMode === 'online' ? 800 : 150)
    
    return () => clearTimeout(timer)
  }, [query, searchMode])

  // Reset when drawer opens
  useEffect(() => {
    if (isOpen) {
      setAddedPapers(new Set())
      if (initialQuery) {
        setQuery(initialQuery)
        if (initialQuery.trim()) {
          setSearchMode('online')
        }
      }
    }
  }, [isOpen, initialQuery])

  // Filter library papers locally (instant)
  const filteredLibraryPapers = useMemo(() => {
    if (!query.trim()) return libraryPapers
    
    const q = query.toLowerCase()
    return libraryPapers.filter(paper =>
      paper.title.toLowerCase().includes(q) ||
      paper.authors.some(author => author.toLowerCase().includes(q)) ||
      paper.journal?.toLowerCase().includes(q) ||
      paper.abstract?.toLowerCase().includes(q)
    )
  }, [libraryPapers, query])

  // Mark online results that are already in library
  const enrichedOnlineResults = useMemo(() => {
    const libraryIds = new Set(libraryPapers.map(p => p.id))
    return onlineResults.map(paper => ({
      ...paper,
      type: libraryIds.has(paper.id) ? 'library' as const : 'search' as const
    }))
  }, [onlineResults, libraryPapers])

  // Determine which results to show
  const results = searchMode === 'library' ? filteredLibraryPapers : enrichedOnlineResults
  const isSearching = searchMode === 'online' && (isSearchingOnline || isFetchingOnline)

  // Add paper to project
  const handleAddToProject = useCallback(async (paper: SearchResult) => {
    if (!currentProjectId || addedPapers.has(paper.id)) return

    try {
      // If from online search, add to library first
      if (paper.type === 'search') {
        await addToLibraryMutation.mutateAsync(paper.id)
      }

      onAddToProject?.(paper.id, paper.title)
      setAddedPapers(prev => new Set(prev).add(paper.id))
    } catch (error) {
      console.error('Error adding paper:', error)
    }
  }, [currentProjectId, onAddToProject, addedPapers, addToLibraryMutation])

  if (!isOpen) return null

  const showEmptyLibrary = searchMode === 'library' && libraryPapers.length === 0 && !query && !isLoadingLibrary
  const showNoResults = results.length === 0 && query.trim().length >= 3 && !isSearching
  const showSearchPrompt = searchMode === 'online' && !query && !isSearching
  const showMinCharsHint = searchMode === 'online' && query.trim().length > 0 && query.trim().length < 3

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in-0 duration-200"
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div className="absolute right-0 top-0 h-full w-[420px] max-w-[90vw] bg-background border-l shadow-2xl animate-in slide-in-from-right duration-300 flex flex-col">
        {/* Header */}
        <div className="flex-none border-b bg-muted/30">
          <div className="flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10">
                <Library className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="font-semibold text-base">Paper Library</h2>
                <p className="text-xs text-muted-foreground">
                  {libraryPapers.length} papers in your library
                </p>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Search Mode Toggle */}
          <div className="px-5 pb-4">
            <div className="flex gap-1 p-1 bg-muted rounded-lg">
              <button
                onClick={() => setSearchMode('library')}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-all",
                  searchMode === 'library' 
                    ? "bg-background text-foreground shadow-sm" 
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <BookOpen className="h-4 w-4" />
                My Library
              </button>
              <button
                onClick={() => setSearchMode('online')}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-all",
                  searchMode === 'online' 
                    ? "bg-background text-foreground shadow-sm" 
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Globe className="h-4 w-4" />
                Search Online
              </button>
            </div>
          </div>

          {/* Search Input */}
          <div className="px-5 pb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={searchMode === 'library' ? "Filter your papers..." : "Search academic papers..."}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-10 h-10 bg-background"
                autoFocus
              />
              {isSearching && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>
        </div>

        {/* Results */}
        <ScrollArea className="flex-1">
          <div className="p-4">
            {/* Loading State */}
            {(isSearching || isLoadingLibrary) && results.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
                <p className="text-sm text-muted-foreground">
                  {isLoadingLibrary ? 'Loading library...' : 'Searching papers...'}
                </p>
              </div>
            )}

            {/* Empty Library */}
            {showEmptyLibrary && (
              <EmptyState
                icon={BookOpen}
                title="Your library is empty"
                description="Search online to find and add papers to your library"
                action={
                  <Button onClick={() => setSearchMode('online')} size="sm">
                    <Globe className="h-4 w-4 mr-2" />
                    Search Online
                  </Button>
                }
              />
            )}

            {/* Search Prompt */}
            {showSearchPrompt && (
              <EmptyState
                icon={Sparkles}
                title="Search academic papers"
                description="Find papers from OpenAlex, CrossRef, and Semantic Scholar"
              />
            )}

            {/* Minimum characters hint */}
            {showMinCharsHint && (
              <EmptyState
                icon={Search}
                title="Keep typing..."
                description="Enter at least 3 characters to search"
              />
            )}

            {/* No Results */}
            {showNoResults && (
              <EmptyState
                icon={FileText}
                title="No papers found"
                description={searchMode === 'library' 
                  ? "Try different keywords or search online" 
                  : "Try different search terms"}
                action={searchMode === 'library' && (
                  <Button onClick={() => setSearchMode('online')} variant="outline" size="sm">
                    <Globe className="h-4 w-4 mr-2" />
                    Search Online
                  </Button>
                )}
              />
            )}

            {/* Results List */}
            {results.length > 0 && (
              <div className="space-y-2">
                {results.map((paper) => (
                  <PaperCard
                    key={paper.id}
                    paper={paper}
                    onAdd={() => handleAddToProject(paper)}
                    isProcessing={addToLibraryMutation.isPending && addToLibraryMutation.variables === paper.id}
                    isAdded={addedPapers.has(paper.id)}
                    showAddButton={!!currentProjectId}
                    isExpanded={expandedAbstract === paper.id}
                    onToggleExpand={() => setExpandedAbstract(
                      expandedAbstract === paper.id ? null : paper.id
                    )}
                  />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        {results.length > 0 && (
          <div className="flex-none px-5 py-3 border-t bg-muted/30">
            <p className="text-xs text-muted-foreground text-center">
              Showing {results.length} {results.length === 1 ? 'paper' : 'papers'}
              {searchMode === 'online' && ' from academic databases'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// Empty State Component
function EmptyState({ 
  icon: Icon, 
  title, 
  description, 
  action 
}: { 
  icon: any
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center px-4">
      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-muted mb-4">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="font-medium text-sm mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground mb-4 max-w-[240px]">{description}</p>
      {action}
    </div>
  )
}

// Paper Card Component
interface PaperCardProps {
  paper: SearchResult
  onAdd: () => void
  isProcessing: boolean
  isAdded: boolean
  showAddButton: boolean
  isExpanded: boolean
  onToggleExpand: () => void
}

function PaperCard({ 
  paper, 
  onAdd, 
  isProcessing, 
  isAdded,
  showAddButton,
  isExpanded,
  onToggleExpand
}: PaperCardProps) {
  const authorDisplay = useMemo(() => {
    if (!paper.authors.length) return null
    if (paper.authors.length <= 2) return paper.authors.join(' & ')
    return `${paper.authors[0]} et al.`
  }, [paper.authors])

  return (
    <div className={cn(
      "group rounded-lg border bg-card p-4 transition-all hover:shadow-sm",
      isAdded && "border-primary/30 bg-primary/5"
    )}>
      {/* Header Row */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {/* Title */}
          <h3 
            className="font-medium text-sm leading-snug line-clamp-2 cursor-pointer hover:text-primary transition-colors"
            onClick={onToggleExpand}
          >
            {paper.title}
          </h3>
          
          {/* Meta Row */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {authorDisplay && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Users className="h-3 w-3" />
                {authorDisplay}
              </span>
            )}
            {paper.year && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {paper.year}
              </span>
            )}
            {paper.citationCount !== undefined && paper.citationCount > 0 && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Quote className="h-3 w-3" />
                {paper.citationCount.toLocaleString()}
              </span>
            )}
          </div>

          {/* Journal */}
          {paper.journal && (
            <p className="text-xs text-muted-foreground mt-1 truncate">
              {paper.journal}
            </p>
          )}
        </div>

        {/* Badges */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge 
            variant={paper.type === 'library' ? 'default' : 'secondary'}
            className="text-[10px] px-1.5 py-0"
          >
            {paper.type === 'library' ? 'Library' : paper.source}
          </Badge>
          {/* Relevance indicator for search results */}
          {paper.type === 'search' && paper.relevanceScore !== undefined && (
            <div className="flex items-center gap-1" title={`Relevance: ${Math.round(paper.relevanceScore * 100)}%`}>
              <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                <div 
                  className={cn(
                    "h-full rounded-full transition-all",
                    paper.relevanceScore >= 0.5 ? "bg-green-500" :
                    paper.relevanceScore >= 0.35 ? "bg-yellow-500" : "bg-orange-500"
                  )}
                  style={{ width: `${Math.min(100, paper.relevanceScore * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Expandable Abstract */}
      {paper.abstract && isExpanded && (
        <div className="mt-3 pt-3 border-t">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {paper.abstract}
          </p>
        </div>
      )}

      {/* Actions Row */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t">
        <div className="flex items-center gap-1">
          {paper.abstract && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onToggleExpand}
              className="h-7 px-2 text-xs text-muted-foreground"
            >
              <ChevronDown className={cn(
                "h-3 w-3 mr-1 transition-transform",
                isExpanded && "rotate-180"
              )} />
              {isExpanded ? 'Less' : 'Abstract'}
            </Button>
          )}
          {paper.url && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(paper.url, '_blank')}
              className="h-7 px-2 text-xs text-muted-foreground"
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              View
            </Button>
          )}
        </div>
        
        {showAddButton && (
          <Button
            size="sm"
            variant={isAdded ? "secondary" : "default"}
            onClick={onAdd}
            disabled={isProcessing || isAdded}
            className="h-7 px-3 text-xs"
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                Adding...
              </>
            ) : isAdded ? (
              <>
                <Check className="h-3 w-3 mr-1" />
                Added
              </>
            ) : (
              <>
                <Plus className="h-3 w-3 mr-1" />
                Add to Project
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
