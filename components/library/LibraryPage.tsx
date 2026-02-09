'use client'

import { useState, useMemo, useCallback, memo, startTransition } from 'react'
import { useRouter } from 'next/navigation'
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
  projects: Project[]
}

// Fetch all papers (library + projects)
async function fetchAllPapers(projectId?: string): Promise<AllPapersResponse> {
  const url = projectId 
    ? `/api/library/all-papers?projectId=${projectId}`
    : '/api/library/all-papers'
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
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
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
      <h3 className="font-instrument text-base tracking-tight leading-snug line-clamp-2 mb-3 group-hover:text-foreground transition-colors">
        {paper.title}
      </h3>

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
  const queryClient = useQueryClient()
  
  // OPTIMIZATION: Could combine into single state object, but keeping separate for simplicity
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<'added_at' | 'title' | 'year'>('added_at')
  const [filterSource, setFilterSource] = useState<'all' | 'upload' | 'search'>('all')
  const [filterProject, setFilterProject] = useState<string>('all')
  const [filterBookmarked, setFilterBookmarked] = useState<'all' | 'bookmarked' | 'not-bookmarked'>('all')
  const [paperToDelete, setPaperToDelete] = useState<UnifiedPaper | null>(null)

  // Fetch all papers with keepPreviousData for smooth filter transitions
  const { data, isLoading, error } = useQuery({
    queryKey: ['library', 'all-papers'],
    queryFn: () => fetchAllPapers(),
    staleTime: 2 * 60 * 1000,
    placeholderData: keepPreviousData, // OPTIMIZATION: Smooth transitions
  })

  // OPTIMIZATION: Memoize data extraction to prevent useMemo dependency changes
  const papers = useMemo(() => data?.papers ?? [], [data?.papers])
  const projects = useMemo(() => data?.projects ?? [], [data?.projects])

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

  // Sort comparator function
  const getSortComparator = useCallback((sortKey: typeof sortBy) => {
    return (a: UnifiedPaper, b: UnifiedPaper) => {
      switch (sortKey) {
        case 'title':
          return a.title.localeCompare(b.title)
        case 'year':
          const yearA = a.publication_date ? new Date(a.publication_date).getTime() : 0
          const yearB = b.publication_date ? new Date(b.publication_date).getTime() : 0
          return yearB - yearA
        case 'added_at':
        default:
          return new Date(b.firstAddedAt).getTime() - new Date(a.firstAddedAt).getTime()
      }
    }
  }, [])

  // Filter and sort papers
  const filteredPapers = useMemo(() => {
    // OPTIMIZATION: Early return if no filters active (rule: js-early-exit)
    const hasFilters = searchQuery.trim() || filterSource !== 'all' || 
                       filterProject !== 'all' || filterBookmarked !== 'all'
    
    if (!hasFilters) {
      // OPTIMIZATION: Use toSorted() for immutability (rule: js-tosorted-immutable)
      return papers.toSorted(getSortComparator(sortBy))
    }

    let result = papers

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.authors?.some((a) => a.toLowerCase().includes(q)) ||
          p.venue?.toLowerCase().includes(q) ||
          p.libraryNotes?.toLowerCase().includes(q)
      )
    }

    // Filter by source
    if (filterSource !== 'all') {
      result = result.filter((p) => p.source === filterSource)
    }

    // Filter by project
    if (filterProject !== 'all') {
      if (filterProject === 'none') {
        result = result.filter((p) => p.projects.length === 0)
      } else {
        result = result.filter((p) => p.projects.some((proj) => proj.id === filterProject))
      }
    }

    // Filter by bookmarked status
    if (filterBookmarked === 'bookmarked') {
      result = result.filter((p) => p.isBookmarked)
    } else if (filterBookmarked === 'not-bookmarked') {
      result = result.filter((p) => !p.isBookmarked)
    }

    // OPTIMIZATION: Use toSorted() for immutability (rule: js-tosorted-immutable)
    return result.toSorted(getSortComparator(sortBy))
  }, [papers, searchQuery, sortBy, filterSource, filterProject, filterBookmarked, getSortComparator])

  // Stats - memoized
  const stats = useMemo(() => {
    const uploadCount = papers.filter((p) => p.source === 'upload').length
    const searchCount = papers.filter((p) => p.source !== 'upload').length
    const bookmarkedCount = papers.filter((p) => p.isBookmarked).length
    const projectCount = projects.length
    return { total: papers.length, uploaded: uploadCount, searched: searchCount, bookmarked: bookmarkedCount, projects: projectCount }
  }, [papers, projects])

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
      setSearchQuery(value)
    })
  }, [])

  const handleSourceChange = useCallback((value: typeof filterSource) => {
    startTransition(() => {
      setFilterSource(value)
    })
  }, [])

  const handleProjectChange = useCallback((value: string) => {
    startTransition(() => {
      setFilterProject(value)
    })
  }, [])

  const handleBookmarkedChange = useCallback((value: typeof filterBookmarked) => {
    startTransition(() => {
      setFilterBookmarked(value)
    })
  }, [])

  const handleSortChange = useCallback((value: typeof sortBy) => {
    startTransition(() => {
      setSortBy(value)
    })
  }, [])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-12 h-12 rounded-full border border-destructive/20 flex items-center justify-center mb-4">
          <X className="h-5 w-5 text-destructive/60" />
        </div>
        <h3 className="font-instrument text-lg tracking-tight mb-1">Failed to load library</h3>
        <p className="text-sm text-muted-foreground mb-5">
          There was an error loading your papers.
        </p>
        <button
          className="h-8 px-4 text-xs font-medium rounded-full bg-foreground/80 text-background hover:bg-foreground/70 transition-colors"
          onClick={() => queryClient.invalidateQueries({ queryKey: ['library'] })}
        >
          Try Again
        </button>
      </div>
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
            <SelectTrigger className="w-32 h-8 rounded-full border-border/40 text-xs">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="upload">Uploaded</SelectItem>
              <SelectItem value="search">From Search</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterProject} onValueChange={handleProjectChange}>
            <SelectTrigger className="w-44 h-8 rounded-full border-border/40 text-xs">
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
            <SelectTrigger className="w-36 h-8 rounded-full border-border/40 text-xs">
              <SelectValue placeholder="Bookmarked" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all">All Papers</SelectItem>
              <SelectItem value="bookmarked">Bookmarked</SelectItem>
              <SelectItem value="not-bookmarked">Not Bookmarked</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={handleSortChange}>
            <SelectTrigger className="w-40 h-8 rounded-full border-border/40 text-xs">
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
      ) : filteredPapers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-10 h-10 rounded-full border border-border/40 flex items-center justify-center mb-4">
            {searchQuery || filterSource !== 'all' || filterProject !== 'all' ? (
              <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            ) : (
              <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            )}
          </div>
          <h3 className="font-instrument text-base tracking-tight mb-1">
            {searchQuery || filterSource !== 'all' || filterProject !== 'all' ? 'No papers found' : 'No papers yet'}
          </h3>
          <p className="text-xs text-muted-foreground max-w-[260px] leading-relaxed">
            {searchQuery || filterSource !== 'all' || filterProject !== 'all'
              ? 'Try adjusting your search or filters.'
              : 'Papers will appear here when you upload PDFs, search for papers, or create projects.'}
          </p>
        </div>
      ) : (
        <ScrollArea className="h-[calc(100vh-420px)] min-h-[300px]">
          <div className="space-y-3 pr-4">
            {filteredPapers.map((paper) => (
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
      {!isLoading && filteredPapers.length > 0 && (
        <p className="text-xs text-muted-foreground text-center font-instrument italic">
          Showing {filteredPapers.length} of {papers.length} papers
        </p>
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
