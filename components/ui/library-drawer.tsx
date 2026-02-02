'use client'

import { useState, useEffect, useCallback, useMemo, memo } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { 
  Search, 
  BookOpen, 
  Globe, 
  X, 
  ExternalLink,
  Calendar,
  Users,
  Quote,
  Plus,
  Check,
  Library,
  FileText,
  ChevronDown
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
  /** When true, shows "Save to Library" button instead of "Add to Project" for search results */
  libraryOnlyMode?: boolean
  /** When provided, shows "Select for Project" button - used when creating a new project */
  onSelectForProject?: (paper: { id: string; title: string; authors: string[]; year: number | null }) => void
  /** Paper IDs already selected for the new project */
  selectedPaperIds?: string[]
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

// Skeleton component for loading state
function PaperCardSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-4 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="h-4 bg-muted rounded w-4/5 mb-2" />
          <div className="h-4 bg-muted rounded w-3/5 mb-3" />
          <div className="flex gap-3 mt-2">
            <div className="h-3 bg-muted rounded w-24" />
            <div className="h-3 bg-muted rounded w-12" />
          </div>
        </div>
        <div className="h-5 bg-muted rounded w-14" />
      </div>
      <div className="flex justify-between mt-4 pt-3 border-t">
        <div className="h-7 bg-muted rounded w-20" />
        <div className="h-7 bg-muted rounded w-24" />
      </div>
    </div>
  )
}

export default function LibraryDrawer({ 
  isOpen, 
  onClose, 
  onAddToProject,
  currentProjectId,
  initialQuery = '',
  libraryOnlyMode = false,
  onSelectForProject,
  selectedPaperIds = []
}: LibraryDrawerProps) {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState(initialQuery)
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [searchMode, setSearchMode] = useState<SearchMode>('library')
  const [expandedAbstract, setExpandedAbstract] = useState<string | null>(null)
  const [addedPapers, setAddedPapers] = useState<Set<string>>(new Set())
  const [savedToLibraryPapers, setSavedToLibraryPapers] = useState<Set<string>>(new Set())

  // Fetch library papers with React Query - cached across drawer opens
  const { 
    data: libraryPapers = [], 
    isLoading: isLoadingLibrary 
  } = useQuery({
    queryKey: ['library', 'papers'],
    queryFn: fetchLibraryPapers,
    enabled: isOpen,
    staleTime: 5 * 60 * 1000,
  })

  // Online search with React Query
  const { 
    data: onlineResults = [], 
    isFetching: isSearchingOnline
  } = useQuery({
    queryKey: ['papers', 'search', debouncedQuery],
    queryFn: () => searchPapersOnline(debouncedQuery),
    enabled: isOpen && searchMode === 'online' && debouncedQuery.length >= 3,
    staleTime: 2 * 60 * 1000,
    placeholderData: keepPreviousData,
  })

  // Mutation for adding papers to library
  const addToLibraryMutation = useMutation({
    mutationFn: addPaperToLibrary,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library', 'papers'] })
    }
  })

  // Debounce search query
  useEffect(() => {
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
      setSavedToLibraryPapers(new Set())
      if (initialQuery) {
        setQuery(initialQuery)
        if (initialQuery.trim()) {
          setSearchMode('online')
        }
      }
    }
  }, [isOpen, initialQuery])

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = originalOverflow
      }
    }
  }, [isOpen])

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
  const isSearching = searchMode === 'online' && isSearchingOnline

  // Add paper to project - OPTIMISTIC UPDATE
  const handleAddToProject = useCallback(async (paper: SearchResult) => {
    if (!currentProjectId || addedPapers.has(paper.id)) return

    // Optimistic: mark as added immediately
    setAddedPapers(prev => new Set(prev).add(paper.id))

    try {
      if (paper.type === 'search') {
        await addToLibraryMutation.mutateAsync(paper.id)
      }
      onAddToProject?.(paper.id, paper.title)
    } catch (error) {
      // Revert on error
      setAddedPapers(prev => {
        const next = new Set(prev)
        next.delete(paper.id)
        return next
      })
      console.error('Error adding paper:', error)
    }
  }, [currentProjectId, onAddToProject, addedPapers, addToLibraryMutation])

  // Save paper to library only - OPTIMISTIC UPDATE
  const handleSaveToLibrary = useCallback(async (paper: SearchResult) => {
    if (savedToLibraryPapers.has(paper.id) || paper.type === 'library') return

    // Optimistic: mark as saved immediately
    setSavedToLibraryPapers(prev => new Set(prev).add(paper.id))

    try {
      await addToLibraryMutation.mutateAsync(paper.id)
    } catch (error) {
      // Revert on error
      setSavedToLibraryPapers(prev => {
        const next = new Set(prev)
        next.delete(paper.id)
        return next
      })
      console.error('Error saving paper to library:', error)
    }
  }, [savedToLibraryPapers, addToLibraryMutation])

  // Select paper for new project creation - OPTIMISTIC UPDATE
  const handleSelectForProject = useCallback(async (paper: SearchResult) => {
    if (!onSelectForProject) return
    
    if (paper.type === 'search') {
      // Mark as saved optimistically
      setSavedToLibraryPapers(prev => new Set(prev).add(paper.id))
      
      try {
        await addToLibraryMutation.mutateAsync(paper.id)
      } catch (error) {
        setSavedToLibraryPapers(prev => {
          const next = new Set(prev)
          next.delete(paper.id)
          return next
        })
        console.error('Error adding paper to library:', error)
        return
      }
    }
    
    onSelectForProject({
      id: paper.id,
      title: paper.title,
      authors: paper.authors,
      year: paper.year
    })
  }, [onSelectForProject, addToLibraryMutation])

  if (!isOpen) return null

  const showEmptyLibrary = searchMode === 'library' && libraryPapers.length === 0 && !query && !isLoadingLibrary
  const showNoResults = results.length === 0 && query.trim().length >= 3 && !isSearching && !isLoadingLibrary
  const showSearchPrompt = searchMode === 'online' && !query && !isSearching && onlineResults.length === 0
  const showMinCharsHint = searchMode === 'online' && query.trim().length > 0 && query.trim().length < 3
  const showSkeletons = (isLoadingLibrary && libraryPapers.length === 0) || 
                        (isSearching && results.length === 0)

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in-0 duration-200"
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* Drawer */}
      <div 
        className="absolute right-0 top-0 h-full w-[420px] max-w-[90vw] bg-background border-l shadow-lg animate-in slide-in-from-right duration-300 flex flex-col overscroll-contain"
        role="dialog"
        aria-label="Paper library"
      >
        {/* Header */}
        <div className="flex-none border-b">
          <div className="flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10">
                <Library className="h-5 w-5 text-primary" aria-hidden="true" />
              </div>
              <div>
                <h2 className="font-semibold text-base">Papers</h2>
                <p className="text-xs text-muted-foreground">
                  {libraryPapers.length} in library
                </p>
              </div>
            </div>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={onClose} 
              className="h-8 w-8"
              aria-label="Close"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>

          {/* Search Mode Toggle */}
          <div className="px-5 pb-3">
            <div className="flex gap-1 p-1 bg-muted rounded-lg" role="tablist">
              <button
                role="tab"
                aria-selected={searchMode === 'library'}
                onClick={() => setSearchMode('library')}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  searchMode === 'library' 
                    ? "bg-background text-foreground shadow-sm" 
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <BookOpen className="h-4 w-4" aria-hidden="true" />
                Library
              </button>
              <button
                role="tab"
                aria-selected={searchMode === 'online'}
                onClick={() => setSearchMode('online')}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  searchMode === 'online' 
                    ? "bg-background text-foreground shadow-sm" 
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Globe className="h-4 w-4" aria-hidden="true" />
                Online
              </button>
            </div>
          </div>

          {/* Search Input */}
          <div className="px-5 pb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input
                placeholder={searchMode === 'library' ? "Filter papers…" : "Search papers…"}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-10 h-9 bg-background text-sm"
                aria-label={searchMode === 'library' ? "Filter papers" : "Search papers"}
              />
            </div>
            {/* Subtle searching indicator when we have results */}
            {isSearching && results.length > 0 && (
              <p className="text-[11px] text-muted-foreground mt-2 text-center" aria-live="polite">
                Updating results…
              </p>
            )}
          </div>
        </div>

        {/* Results */}
        <ScrollArea className="flex-1 overscroll-contain">
          <div className="p-4 space-y-3">
            {/* Skeleton Loading */}
            {showSkeletons && (
              <>
                <PaperCardSkeleton />
                <PaperCardSkeleton />
                <PaperCardSkeleton />
              </>
            )}

            {/* Empty Library */}
            {showEmptyLibrary && (
              <EmptyState
                icon={BookOpen}
                title="No papers yet"
                description="Search online to find papers"
                action={
                  <Button onClick={() => setSearchMode('online')} size="sm" variant="outline">
                    <Globe className="h-4 w-4 mr-2" aria-hidden="true" />
                    Search Online
                  </Button>
                }
              />
            )}

            {/* Search Prompt */}
            {showSearchPrompt && (
              <EmptyState
                icon={Search}
                title="Search academic papers"
                description="Enter a topic to search across databases"
              />
            )}

            {/* Minimum characters hint */}
            {showMinCharsHint && (
              <EmptyState
                icon={Search}
                title="Keep typing…"
                description="Enter at least 3 characters"
              />
            )}

            {/* No Results */}
            {showNoResults && (
              <EmptyState
                icon={FileText}
                title="No papers found"
                description={searchMode === 'library' 
                  ? "Try different keywords" 
                  : "Try different search terms"}
                action={searchMode === 'library' && (
                  <Button onClick={() => setSearchMode('online')} variant="outline" size="sm">
                    <Globe className="h-4 w-4 mr-2" aria-hidden="true" />
                    Search Online
                  </Button>
                )}
              />
            )}

            {/* Results List */}
            {results.length > 0 && !showSkeletons && (
              <>
                {results.map((paper) => (
                  <PaperCard
                    key={paper.id}
                    paper={paper}
                    onAdd={() => handleAddToProject(paper)}
                    onSaveToLibrary={() => handleSaveToLibrary(paper)}
                    onSelectForProject={() => handleSelectForProject(paper)}
                    isAdded={addedPapers.has(paper.id)}
                    isSavedToLibrary={savedToLibraryPapers.has(paper.id) || paper.type === 'library'}
                    isSelectedForProject={selectedPaperIds.includes(paper.id)}
                    showAddButton={!!currentProjectId}
                    showSaveToLibraryButton={libraryOnlyMode && !currentProjectId && !onSelectForProject}
                    showSelectForProjectButton={!!onSelectForProject}
                    isExpanded={expandedAbstract === paper.id}
                    onToggleExpand={() => setExpandedAbstract(
                      expandedAbstract === paper.id ? null : paper.id
                    )}
                  />
                ))}
              </>
            )}
          </div>
        </ScrollArea>

        {/* Footer - simplified */}
        {results.length > 0 && !showSkeletons && (
          <div className="flex-none px-5 py-3 border-t text-center">
            <p className="text-[11px] text-muted-foreground">
              {results.length} {results.length === 1 ? 'paper' : 'papers'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// Empty State Component - simplified
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
    <div className="flex flex-col items-center justify-center py-10 text-center px-4">
      <div className="flex items-center justify-center w-10 h-10 rounded-full bg-muted mb-3">
        <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <h3 className="font-medium text-sm mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground mb-3 max-w-[200px]">{description}</p>
      {action}
    </div>
  )
}

// Paper Card Component - simplified, no loading spinners
interface PaperCardProps {
  paper: SearchResult
  onAdd: () => void
  onSaveToLibrary?: () => void
  onSelectForProject?: () => void
  isAdded: boolean
  isSavedToLibrary: boolean
  isSelectedForProject: boolean
  showAddButton: boolean
  showSaveToLibraryButton: boolean
  showSelectForProjectButton: boolean
  isExpanded: boolean
  onToggleExpand: () => void
}

const PaperCard = memo(function PaperCard({ 
  paper, 
  onAdd,
  onSaveToLibrary,
  onSelectForProject,
  isAdded,
  isSavedToLibrary,
  isSelectedForProject,
  showAddButton,
  showSaveToLibraryButton,
  showSelectForProjectButton,
  isExpanded,
  onToggleExpand
}: PaperCardProps) {
  const authorDisplay = useMemo(() => {
    if (!paper.authors.length) return null
    if (paper.authors.length <= 2) return paper.authors.join(' & ')
    return `${paper.authors[0]} et al.`
  }, [paper.authors])

  // Handle keyboard activation for title
  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onToggleExpand()
    }
  }, [onToggleExpand])

  return (
    <div className={cn(
      "rounded-lg border bg-card p-4 transition-colors",
      isAdded && "border-primary/40 bg-primary/5"
    )}>
      {/* Header Row */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {/* Title - clickable to expand */}
          <h3 
            className="font-medium text-sm leading-snug line-clamp-2 cursor-pointer hover:text-primary transition-colors focus-visible:outline-none focus-visible:text-primary"
            onClick={onToggleExpand}
            onKeyDown={handleTitleKeyDown}
            tabIndex={0}
            role="button"
            aria-expanded={isExpanded}
          >
            {paper.title}
          </h3>
          
          {/* Meta Row */}
          <div className="flex items-center gap-2 mt-2 text-muted-foreground">
            {authorDisplay && (
              <span className="text-xs flex items-center gap-1 truncate max-w-[140px]">
                <Users className="h-3 w-3 shrink-0" aria-hidden="true" />
                {authorDisplay}
              </span>
            )}
            {paper.year && (
              <span className="text-xs flex items-center gap-1">
                <Calendar className="h-3 w-3" aria-hidden="true" />
                {paper.year}
              </span>
            )}
            {paper.citationCount !== undefined && paper.citationCount > 0 && (
              <span className="text-xs flex items-center gap-1">
                <Quote className="h-3 w-3" aria-hidden="true" />
                {paper.citationCount.toLocaleString()}
              </span>
            )}
          </div>
        </div>

        {/* Source Badge */}
        <Badge 
          variant={paper.type === 'library' ? 'secondary' : 'outline'}
          className="text-[10px] px-1.5 py-0 shrink-0"
        >
          {paper.type === 'library' ? 'Saved' : paper.source}
        </Badge>
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
              aria-expanded={isExpanded}
            >
              <ChevronDown className={cn(
                "h-3 w-3 mr-1 transition-transform",
                isExpanded && "rotate-180"
              )} aria-hidden="true" />
              {isExpanded ? 'Less' : 'More'}
            </Button>
          )}
          {paper.url && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(paper.url, '_blank')}
              className="h-7 px-2 text-xs text-muted-foreground"
            >
              <ExternalLink className="h-3 w-3 mr-1" aria-hidden="true" />
              Open
            </Button>
          )}
        </div>
        
        {/* Add to Project button */}
        {showAddButton && (
          <Button
            size="sm"
            variant={isAdded ? "secondary" : "default"}
            onClick={onAdd}
            disabled={isAdded}
            className="h-7 px-3 text-xs"
          >
            {isAdded ? (
              <><Check className="h-3 w-3 mr-1" aria-hidden="true" /> Added</>
            ) : (
              <><Plus className="h-3 w-3 mr-1" aria-hidden="true" /> Add</>
            )}
          </Button>
        )}
        
        {/* Save to Library button */}
        {showSaveToLibraryButton && paper.type === 'search' && (
          <Button
            size="sm"
            variant={isSavedToLibrary ? "secondary" : "default"}
            onClick={onSaveToLibrary}
            disabled={isSavedToLibrary}
            className="h-7 px-3 text-xs"
          >
            {isSavedToLibrary ? (
              <><Check className="h-3 w-3 mr-1" aria-hidden="true" /> Saved</>
            ) : (
              <><Plus className="h-3 w-3 mr-1" aria-hidden="true" /> Save</>
            )}
          </Button>
        )}
        
        {/* Select for Project button */}
        {showSelectForProjectButton && (
          <Button
            size="sm"
            variant={isSelectedForProject ? "secondary" : "default"}
            onClick={onSelectForProject}
            disabled={isSelectedForProject}
            className="h-7 px-3 text-xs"
          >
            {isSelectedForProject ? (
              <><Check className="h-3 w-3 mr-1" aria-hidden="true" /> Selected</>
            ) : (
              <><Plus className="h-3 w-3 mr-1" aria-hidden="true" /> Select</>
            )}
          </Button>
        )}
      </div>
    </div>
  )
})
