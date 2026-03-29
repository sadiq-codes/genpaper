'use client'

import { useState, useMemo, useCallback, memo, startTransition, useEffect } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Search,
  BookOpen,
  ExternalLink,
  Trash2,
  Upload,
  Loader2,
  X,
  FolderOpen,
  Bookmark,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { SectionEmptyState, SectionErrorState } from '@/components/ui/async-state'

// Types
interface UnifiedPaper {
  id: string
  title: string
  authors: string[]
  publication_date: string | null
  venue: string | null
  doi: string | null
  pdf_url: string | null
  source: string | null
  citation_count: number | null
  processing_status: string | null
  owner_id: string | null
  metadata: Record<string, unknown> | null
  isBookmarked: boolean
  libraryNotes: string | null
  libraryAddedAt: string | null
  projects: Array<{ id: string; topic: string }>
  firstAddedAt: string
}

interface Project {
  id: string
  topic: string
}

interface AllPapersResponse {
  papers: UnifiedPaper[]
  count: number
  offset: number
  limit: number
  hasMore: boolean
  projects: Project[]
  stats: {
    total: number
    uploaded: number
    searched: number
    bookmarked: number
    projects: number
  }
}

const PAGE_SIZE = 30

async function fetchAllPapers(params: {
  q: string
  sort: 'added_at' | 'title' | 'year'
  source: 'all' | 'upload' | 'search'
  project: string
  bookmarked: 'all' | 'bookmarked' | 'not-bookmarked'
  offset: number
  limit: number
}): Promise<AllPapersResponse> {
  const searchParams = new URLSearchParams()
  if (params.q) searchParams.set('q', params.q)
  if (params.sort !== 'added_at') searchParams.set('sort', params.sort)
  if (params.source !== 'all') searchParams.set('source', params.source)
  if (params.project !== 'all') searchParams.set('project', params.project)
  if (params.bookmarked !== 'all') searchParams.set('bookmarked', params.bookmarked)
  searchParams.set('offset', String(params.offset))
  searchParams.set('limit', String(params.limit))

  const url = `/api/library/all-papers?${searchParams.toString()}`
  const response = await fetch(url)
  if (!response.ok) throw new Error('Failed to load papers')
  return response.json()
}

// Remove paper from library
async function removePaperFromLibrary(paperId: string): Promise<void> {
  const response = await fetch(`/api/library?paperId=${paperId}`, {
    method: 'DELETE',
  })
  if (!response.ok) throw new Error('Failed to remove paper')
}

// Add paper to library (bookmark)
async function addPaperToLibrary(paperId: string): Promise<void> {
  const response = await fetch('/api/library', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paperId }),
  })
  if (!response.ok) throw new Error('Failed to add paper')
}

function formatAuthors(authors: string[] | undefined): string {
  if (!authors || authors.length === 0) return 'Unknown authors'
  if (authors.length === 1) return authors[0]
  if (authors.length === 2) return authors.join(' & ')
  return `${authors[0]} et al.`
}

function formatDate(dateString: string | null): string {
  if (!dateString) return ''
  try {
    return new Date(dateString).getFullYear().toString()
  } catch {
    return ''
  }
}

function formatPaperType(raw?: string): string | null {
  if (!raw) return null
  const map: Record<string, string> = {
    'article': 'Article', 'journal-article': 'Article', 'conference-paper': 'Conference',
    'preprint': 'Preprint', 'review': 'Review', 'book-chapter': 'Book Chapter',
    'book': 'Book', 'dissertation': 'Dissertation', 'editorial': 'Editorial',
  }
  return map[raw.toLowerCase()] || raw.charAt(0).toUpperCase() + raw.slice(1)
}



// OPTIMIZATION: Hoist static skeleton JSX (rule: rendering-hoist-jsx)
const paperListSkeleton = (
    <div className="space-y-3">
    {[0, 1, 2, 3, 4].map((i) => (
      <div key={i} className="rounded-xl border border-border/60 bg-card p-3 sm:p-4 animate-pulse">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-muted/60" />
          <div className="h-3 bg-muted/40 rounded w-16" />
        </div>
        <div className="h-4 bg-muted/50 rounded w-4/5 mb-2" />
        <div className="h-4 bg-muted/40 rounded w-3/5 mb-3" />
        <div className="pt-3 border-t border-border/40 flex gap-3">
          <div className="h-3 bg-muted/30 rounded w-24" />
          <div className="h-3 bg-muted/30 rounded w-12" />
        </div>
      </div>
    ))}
  </div>
)

// OPTIMIZATION: Memoized PaperCard component (rule: rerender-memo)
interface PaperCardProps {
  paper: UnifiedPaper
  onNavigate: (id: string) => void
  onDelete: (paper: UnifiedPaper) => void
  onBookmark: (id: string) => void
  isBookmarking: boolean
}

const PaperCard = memo(function PaperCard({
  paper,
  onNavigate,
  onDelete,
  onBookmark,
  isBookmarking,
}: PaperCardProps) {
  const handleClick = useCallback(() => {
    onNavigate(paper.id)
  }, [onNavigate, paper.id])

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onDelete(paper)
  }, [onDelete, paper])

  const handleBookmarkClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onBookmark(paper.id)
  }, [onBookmark, paper.id])

  const handleExternalClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (paper.doi) {
      window.open(`https://doi.org/${paper.doi}`, '_blank')
    }
  }, [paper.doi])

  return (
    <div 
      className={cn(
        "relative rounded-xl border border-border/60 bg-card p-3 sm:p-4 cursor-pointer group",
        "transition-all duration-300 ease-out",
        "hover:border-foreground/15 hover:shadow-sm hover:-translate-y-px",
        "[content-visibility:auto] [contain-intrinsic-size:0_120px]"
      )}
      onClick={handleClick}
    >
      {/* Header: source icon + bookmark */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-muted/70 flex items-center justify-center shrink-0">
            {paper.source === 'upload' ? (
              <Upload className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            ) : (
              <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            )}
          </div>
          <span className="text-[11px] font-medium text-muted-foreground tracking-wide uppercase">
            {paper.source === 'upload' ? 'Uploaded' : 'Found'}
          </span>
          {paper.isBookmarked && (
            <Bookmark className="h-3 w-3 text-amber-500 fill-amber-500 shrink-0" aria-hidden="true" />
          )}
        </div>

        {/* Actions — show on hover */}
        <div className="flex items-center gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          {!paper.isBookmarked && (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-amber-500 transition-colors"
                    onClick={handleBookmarkClick}
                    disabled={isBookmarking}
                  >
                    {isBookmarking ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Bookmark className="h-3.5 w-3.5" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>Save to library</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          
          {paper.doi && (
            <button
              className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              onClick={handleExternalClick}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          )}
          
          {paper.isBookmarked && (
            <button
              className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
              onClick={handleDeleteClick}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Title */}
      <h3 className="font-instrument text-base tracking-tight leading-snug line-clamp-2 mb-2 group-hover:text-foreground transition-colors">
        {paper.title}
      </h3>

      {/* Type / OA / Fields badges */}
      {paper.metadata && (() => {
        const paperType = formatPaperType(paper.metadata?.paper_type as string | undefined)
        const fields = (paper.metadata?.fields_of_study as string[] | undefined)?.slice(0, 2)
        const keywords = (paper.metadata?.keywords as string[] | undefined)?.slice(0, 2)
        const tags = fields?.length ? fields : keywords
        const hasBadges = paperType || tags?.length
        if (!hasBadges) return null
        return (
          <div className="flex flex-wrap items-center gap-1 mb-3">
            {paperType && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-muted/50 text-muted-foreground">
                {paperType}
              </span>
            )}
            {tags?.map((tag) => (
              <span key={tag} className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] bg-foreground/5 text-muted-foreground truncate max-w-[120px]">
                {tag}
              </span>
            ))}
          </div>
        )
      })()}

      {/* Footer: Meta row */}
      <div className="flex items-center justify-between pt-3 border-t border-border/40">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="truncate max-w-[200px]">{formatAuthors(paper.authors)}</span>
          {paper.publication_date && (
            <>
              <span className="text-border">·</span>
              <span>{formatDate(paper.publication_date)}</span>
            </>
          )}
        </div>
        {paper.projects.length > 0 && (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-[10px] text-muted-foreground cursor-help shrink-0">
                  {paper.projects.length} project{paper.projects.length !== 1 ? 's' : ''}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <div className="text-xs">
                  <p className="font-medium mb-1">Used in:</p>
                  {paper.projects.slice(0, 3).map((proj) => (
                    <p key={proj.id} className="truncate max-w-[200px]">• {proj.topic}</p>
                  ))}
                  {paper.projects.length > 3 && (
                    <p className="text-muted-foreground">+{paper.projects.length - 3} more</p>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </div>
  )
})

export function LibraryPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const initialSearch = searchParams.get('q') || ''
  const initialSort = (searchParams.get('sort') as 'added_at' | 'title' | 'year' | null) || 'added_at'
  const initialSource = (searchParams.get('source') as 'all' | 'upload' | 'search' | null) || 'all'
  const initialProject = searchParams.get('project') || 'all'
  const initialBookmarked = (searchParams.get('bookmarked') as 'all' | 'bookmarked' | 'not-bookmarked' | null) || 'all'
  
  // URL state keeps library views shareable and back-button friendly.
  const [searchQuery, setSearchQuery] = useState(initialSearch)
  const [sortBy, setSortBy] = useState<'added_at' | 'title' | 'year'>(initialSort)
  const [filterSource, setFilterSource] = useState<'all' | 'upload' | 'search'>(initialSource)
  const [filterProject, setFilterProject] = useState<string>(initialProject)
  const [filterBookmarked, setFilterBookmarked] = useState<'all' | 'bookmarked' | 'not-bookmarked'>(initialBookmarked)
  const [paperToDelete, setPaperToDelete] = useState<UnifiedPaper | null>(null)
  const [page, setPage] = useState(0)
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(initialSearch)

  const syncFiltersToUrl = useCallback((nextState: {
    q?: string
    sort?: 'added_at' | 'title' | 'year'
    source?: 'all' | 'upload' | 'search'
    project?: string
    bookmarked?: 'all' | 'bookmarked' | 'not-bookmarked'
  }) => {
    const params = new URLSearchParams(searchParams.toString())
    const merged = {
      q: nextState.q ?? searchQuery,
      sort: nextState.sort ?? sortBy,
      source: nextState.source ?? filterSource,
      project: nextState.project ?? filterProject,
      bookmarked: nextState.bookmarked ?? filterBookmarked,
    }

    if (merged.q) params.set('q', merged.q)
    else params.delete('q')

    if (merged.sort !== 'added_at') params.set('sort', merged.sort)
    else params.delete('sort')

    if (merged.source !== 'all') params.set('source', merged.source)
    else params.delete('source')

    if (merged.project !== 'all') params.set('project', merged.project)
    else params.delete('project')

    if (merged.bookmarked !== 'all') params.set('bookmarked', merged.bookmarked)
    else params.delete('bookmarked')

    const nextQuery = params.toString()
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false })
  }, [filterBookmarked, filterProject, filterSource, pathname, router, searchParams, searchQuery, sortBy])

  const searchParamsString = searchParams.toString()
  useEffect(() => {
    const q = searchParams.get('q') || ''
    const sort = (searchParams.get('sort') as 'added_at' | 'title' | 'year' | null) || 'added_at'
    const source = (searchParams.get('source') as 'all' | 'upload' | 'search' | null) || 'all'
    const project = searchParams.get('project') || 'all'
    const bookmarked = (searchParams.get('bookmarked') as 'all' | 'bookmarked' | 'not-bookmarked' | null) || 'all'

    if (q !== searchQuery) setSearchQuery(q)
    if (sort !== sortBy) setSortBy(sort)
    if (source !== filterSource) setFilterSource(source)
    if (project !== filterProject) setFilterProject(project)
    if (bookmarked !== filterBookmarked) setFilterBookmarked(bookmarked)
    setPage(0)
  }, [filterBookmarked, filterProject, filterSource, searchParamsString, searchQuery, searchParams, sortBy])

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim())
    }, 200)

    return () => clearTimeout(timer)
  }, [searchQuery])

  // Fetch only the visible slice of papers for the current filters.
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['library', 'all-papers', debouncedSearchQuery, sortBy, filterSource, filterProject, filterBookmarked, page],
    queryFn: () => fetchAllPapers({
      q: debouncedSearchQuery,
      sort: sortBy,
      source: filterSource,
      project: filterProject,
      bookmarked: filterBookmarked,
      offset: page * PAGE_SIZE,
      limit: PAGE_SIZE,
    }),
    staleTime: 2 * 60 * 1000,
    placeholderData: keepPreviousData,
  })

  const papers = useMemo(() => data?.papers ?? [], [data?.papers])
  const projects = useMemo(() => data?.projects ?? [], [data?.projects])
  const totalCount = data?.count ?? 0
  const hasMore = data?.hasMore ?? false
  const stats = data?.stats ?? {
    total: 0,
    uploaded: 0,
    searched: 0,
    bookmarked: 0,
    projects: 0,
  }

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: removePaperFromLibrary,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library'] })
      toast.success('Paper removed from library')
      setPaperToDelete(null)
    },
    onError: () => {
      toast.error('Failed to remove paper')
    },
  })

  // Bookmark mutation
  const bookmarkMutation = useMutation({
    mutationFn: addPaperToLibrary,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library'] })
      toast.success('Paper saved to library')
    },
    onError: () => {
      toast.error('Failed to save paper')
    },
  })

  // OPTIMIZATION: Stable callbacks for PaperCard (rule: rerender-functional-setstate)
  const handleNavigate = useCallback((id: string) => {
    router.push(`/library/${id}`)
  }, [router])

  const handleDelete = useCallback((paper: UnifiedPaper) => {
    setPaperToDelete(paper)
  }, [])

  const handleBookmark = useCallback((paperId: string) => {
    bookmarkMutation.mutate(paperId)
  }, [bookmarkMutation])

  // OPTIMIZATION: Use startTransition for non-urgent filter updates (rule: rerender-transitions)
  const handleSearchChange = useCallback((value: string) => {
    startTransition(() => {
      setPage(0)
      setSearchQuery(value)
      syncFiltersToUrl({ q: value })
    })
  }, [syncFiltersToUrl])

  const handleSourceChange = useCallback((value: typeof filterSource) => {
    startTransition(() => {
      setPage(0)
      setFilterSource(value)
      syncFiltersToUrl({ source: value })
    })
  }, [syncFiltersToUrl])

  const handleProjectChange = useCallback((value: string) => {
    startTransition(() => {
      setPage(0)
      setFilterProject(value)
      syncFiltersToUrl({ project: value })
    })
  }, [syncFiltersToUrl])

  const handleBookmarkedChange = useCallback((value: typeof filterBookmarked) => {
    startTransition(() => {
      setPage(0)
      setFilterBookmarked(value)
      syncFiltersToUrl({ bookmarked: value })
    })
  }, [syncFiltersToUrl])

  const handleSortChange = useCallback((value: typeof sortBy) => {
    startTransition(() => {
      setPage(0)
      setSortBy(value)
      syncFiltersToUrl({ sort: value })
    })
  }, [syncFiltersToUrl])

  if (error) {
    return (
      <SectionErrorState
        title="Failed to load library"
        description="There was an error loading your papers."
        icon={<X className="h-5 w-5 text-destructive/60" aria-hidden="true" />}
        action={(
          <button
            className="h-8 px-4 text-xs font-medium rounded-full bg-foreground/80 text-background hover:bg-foreground/70 transition-colors inline-flex items-center gap-1.5 disabled:opacity-50 disabled:pointer-events-none"
            disabled={isFetching}
            onClick={() => queryClient.invalidateQueries({ queryKey: ['library'] })}
          >
            {isFetching ? <><Loader2 className="h-3 w-3 animate-spin" />Retrying…</> : "Try Again"}
          </button>
        )}
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Stats Row */}
      <div className="flex items-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-instrument text-2xl tracking-tight">{stats.total}</span>
          <span className="text-muted-foreground text-xs">papers</span>
        </div>
        <div className="w-px h-4 bg-border/40" />
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Bookmark className="h-3 w-3 text-amber-500" aria-hidden="true" />
          <span>{stats.bookmarked}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Upload className="h-3 w-3" aria-hidden="true" />
          <span>{stats.uploaded}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FolderOpen className="h-3 w-3" aria-hidden="true" />
          <span>{stats.projects} projects</span>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <Input
            placeholder="Search papers by title, author, or venue..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10 pr-9 h-10 rounded-xl border-border/40 bg-background placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:border-foreground/20 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => handleSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Select value={filterSource} onValueChange={handleSourceChange}>
            <SelectTrigger className="w-32 h-8 rounded-full border-border/60 text-xs">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="upload">Uploaded</SelectItem>
              <SelectItem value="search">From Search</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterProject} onValueChange={handleProjectChange}>
            <SelectTrigger className="w-44 h-8 rounded-full border-border/60 text-xs">
              <SelectValue placeholder="Project" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all">All Projects</SelectItem>
              <SelectItem value="none">Not in any project</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  <span className="truncate max-w-[150px]">{project.topic}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterBookmarked} onValueChange={handleBookmarkedChange}>
            <SelectTrigger className="w-36 h-8 rounded-full border-border/60 text-xs">
              <SelectValue placeholder="Bookmarked" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all">All Papers</SelectItem>
              <SelectItem value="bookmarked">Bookmarked</SelectItem>
              <SelectItem value="not-bookmarked">Not Bookmarked</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={handleSortChange}>
            <SelectTrigger className="w-40 h-8 rounded-full border-border/60 text-xs">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="added_at">Recently Added</SelectItem>
              <SelectItem value="title">Title (A-Z)</SelectItem>
              <SelectItem value="year">Year (Newest)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Papers List */}
      {isLoading ? (
        paperListSkeleton
      ) : papers.length === 0 ? (
        <SectionEmptyState
          title={searchQuery || filterSource !== 'all' || filterProject !== 'all' ? 'No papers found' : 'No papers yet'}
          description={
            searchQuery || filterSource !== 'all' || filterProject !== 'all'
              ? 'Try adjusting your search or filters.'
              : 'Papers will appear here when you upload PDFs, search for papers, or create projects.'
          }
          icon={
            searchQuery || filterSource !== 'all' || filterProject !== 'all'
              ? <Search className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              : <BookOpen className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          }
        />
      ) : (
        <ScrollArea className="h-[calc(100vh-420px)] min-h-[300px]">
          <div className="space-y-3 pr-4">
            {papers.map((paper) => (
              <PaperCard
                key={paper.id}
                paper={paper}
                onNavigate={handleNavigate}
                onDelete={handleDelete}
                onBookmark={handleBookmark}
                isBookmarking={bookmarkMutation.isPending}
              />
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Results count */}
      {!isLoading && papers.length > 0 && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-xs text-muted-foreground text-center font-instrument italic">
            Showing {page * PAGE_SIZE + 1}-{page * PAGE_SIZE + papers.length} of {totalCount} papers
          </p>
          <div className="flex items-center gap-2">
            <button
              className="h-8 rounded-full border border-border/50 px-3 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={page === 0 || isFetching}
            >
              Previous
            </button>
            <button
              className="h-8 rounded-full border border-border/50 px-3 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => setPage((current) => current + 1)}
              disabled={!hasMore || isFetching}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!paperToDelete} onOpenChange={() => setPaperToDelete(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-instrument text-lg tracking-tight">Remove from library?</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              This will remove &quot;{paperToDelete?.title}&quot; from your bookmarked papers. 
              {paperToDelete?.projects && paperToDelete.projects.length > 0 && (
                <> The paper will still be available in the {paperToDelete.projects.length} project{paperToDelete.projects.length !== 1 ? 's' : ''} where it&apos;s used.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <button
              className="h-9 px-4 text-sm rounded-full border border-border/40 hover:bg-muted transition-colors"
              onClick={() => setPaperToDelete(null)}
            >
              Cancel
            </button>
            <button
              className="h-9 px-4 text-sm rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
              onClick={() => paperToDelete && deleteMutation.mutate(paperToDelete.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Remove
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
