'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
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
  Calendar,
  Users,
  FileText,
  FolderOpen,
  Star,
  Bookmark,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// Types
interface UnifiedPaper {
  id: string
  title: string
  abstract: string | null
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

export function LibraryPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<'added_at' | 'title' | 'year'>('added_at')
  const [filterSource, setFilterSource] = useState<'all' | 'upload' | 'search'>('all')
  const [filterProject, setFilterProject] = useState<string>('all')
  const [filterBookmarked, setFilterBookmarked] = useState<'all' | 'bookmarked' | 'not-bookmarked'>('all')
  const [paperToDelete, setPaperToDelete] = useState<UnifiedPaper | null>(null)

  // Fetch all papers
  const { data, isLoading, error } = useQuery({
    queryKey: ['library', 'all-papers'],
    queryFn: () => fetchAllPapers(),
    staleTime: 2 * 60 * 1000,
  })

  const papers = data?.papers || []
  const projects = data?.projects || []

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

  // Filter and sort papers
  const filteredPapers = useMemo(() => {
    let result = [...papers]

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

    // Sort
    result.sort((a, b) => {
      switch (sortBy) {
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
    })

    return result
  }, [papers, searchQuery, sortBy, filterSource, filterProject, filterBookmarked])

  // Stats
  const stats = useMemo(() => {
    const uploadCount = papers.filter((p) => p.source === 'upload').length
    const searchCount = papers.filter((p) => p.source !== 'upload').length
    const bookmarkedCount = papers.filter((p) => p.isBookmarked).length
    const projectCount = projects.length
    return { total: papers.length, uploaded: uploadCount, searched: searchCount, bookmarked: bookmarkedCount, projects: projectCount }
  }, [papers, projects])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="rounded-full bg-destructive/10 p-4 mb-4">
          <X className="h-8 w-8 text-destructive" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Failed to load library</h3>
        <p className="text-sm text-muted-foreground mb-4">
          There was an error loading your papers.
        </p>
        <Button onClick={() => queryClient.invalidateQueries({ queryKey: ['library'] })}>
          Try Again
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <BookOpen className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-sm text-muted-foreground">Total Papers</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10">
              <Bookmark className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.bookmarked}</p>
              <p className="text-sm text-muted-foreground">Bookmarked</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Upload className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.uploaded}</p>
              <p className="text-sm text-muted-foreground">Uploaded</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10">
              <FolderOpen className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.projects}</p>
              <p className="text-sm text-muted-foreground">Projects</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search papers by title, author, or venue..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-9"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Filter row */}
        <div className="flex flex-wrap gap-2">
          <Select value={filterSource} onValueChange={(v) => setFilterSource(v as typeof filterSource)}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="upload">Uploaded</SelectItem>
              <SelectItem value="search">From Search</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterProject} onValueChange={setFilterProject}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              <SelectItem value="none">Not in any project</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  <span className="truncate max-w-[150px]">{project.topic}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterBookmarked} onValueChange={(v) => setFilterBookmarked(v as typeof filterBookmarked)}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Bookmarked" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Papers</SelectItem>
              <SelectItem value="bookmarked">Bookmarked</SelectItem>
              <SelectItem value="not-bookmarked">Not Bookmarked</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="added_at">Recently Added</SelectItem>
              <SelectItem value="title">Title (A-Z)</SelectItem>
              <SelectItem value="year">Year (Newest)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Papers List */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Card key={i} className="p-4">
              <div className="animate-pulse space-y-3">
                <div className="h-5 bg-muted rounded w-3/4" />
                <div className="h-4 bg-muted rounded w-1/2" />
                <div className="flex gap-2">
                  <div className="h-6 bg-muted rounded w-20" />
                  <div className="h-6 bg-muted rounded w-16" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : filteredPapers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="rounded-full bg-muted p-4 mb-4">
            {searchQuery || filterSource !== 'all' || filterProject !== 'all' ? (
              <Search className="h-8 w-8 text-muted-foreground" />
            ) : (
              <BookOpen className="h-8 w-8 text-muted-foreground" />
            )}
          </div>
          <h3 className="text-lg font-semibold mb-2">
            {searchQuery || filterSource !== 'all' || filterProject !== 'all' ? 'No papers found' : 'No papers yet'}
          </h3>
          <p className="text-sm text-muted-foreground max-w-md">
            {searchQuery || filterSource !== 'all' || filterProject !== 'all'
              ? 'Try adjusting your search or filters.'
              : 'Papers will appear here when you upload PDFs, search for papers, or create projects.'}
          </p>
        </div>
      ) : (
        <ScrollArea className="h-[calc(100vh-480px)] min-h-[300px]">
          <div className="space-y-3 pr-4">
            {filteredPapers.map((paper) => (
              <Card 
                key={paper.id} 
                className="p-4 hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => router.push(`/library/${paper.id}`)}
              >
                <div className="flex items-start gap-4">
                  {/* Icon + Bookmark indicator */}
                  <div className="flex-shrink-0 mt-1 relative">
                    {paper.source === 'upload' ? (
                      <div className="p-2 rounded-lg bg-blue-500/10">
                        <FileText className="h-4 w-4 text-blue-500" />
                      </div>
                    ) : (
                      <div className="p-2 rounded-lg bg-green-500/10">
                        <Search className="h-4 w-4 text-green-500" />
                      </div>
                    )}
                    {paper.isBookmarked && (
                      <div className="absolute -top-1 -right-1 bg-amber-500 rounded-full p-0.5">
                        <Bookmark className="h-2.5 w-2.5 text-white fill-white" />
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 space-y-2">
                    <h3 className="font-medium leading-snug line-clamp-2">{paper.title}</h3>

                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1 truncate">
                        <Users className="h-3.5 w-3.5 flex-shrink-0" />
                        {formatAuthors(paper.authors)}
                      </span>
                      {paper.publication_date && (
                        <span className="flex items-center gap-1 flex-shrink-0">
                          <Calendar className="h-3.5 w-3.5" />
                          {formatDate(paper.publication_date)}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {paper.venue && (
                        <Badge variant="secondary" className="text-xs">
                          {paper.venue}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-xs">
                        {paper.source === 'upload' ? 'Uploaded' : 'Found'}
                      </Badge>
                      
                      {/* Projects using this paper */}
                      {paper.projects.length > 0 && (
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge 
                                variant="outline" 
                                className="text-xs bg-purple-500/10 text-purple-600 border-purple-500/20 cursor-help"
                              >
                                <FolderOpen className="h-3 w-3 mr-1" />
                                {paper.projects.length} project{paper.projects.length !== 1 ? 's' : ''}
                              </Badge>
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

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {/* Bookmark button */}
                    {!paper.isBookmarked && (
                      <TooltipProvider delayDuration={300}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-amber-500"
                              onClick={(e) => {
                                e.stopPropagation()
                                bookmarkMutation.mutate(paper.id)
                              }}
                              disabled={bookmarkMutation.isPending}
                            >
                              {bookmarkMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Bookmark className="h-4 w-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Save to library</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    
                    {paper.doi && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation()
                          window.open(`https://doi.org/${paper.doi}`, '_blank')
                        }}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    )}
                    
                    {paper.isBookmarked && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation()
                          setPaperToDelete(paper)
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Results count */}
      {!isLoading && filteredPapers.length > 0 && (
        <p className="text-sm text-muted-foreground text-center">
          Showing {filteredPapers.length} of {papers.length} papers
        </p>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!paperToDelete} onOpenChange={() => setPaperToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove from library?</DialogTitle>
            <DialogDescription>
              This will remove &quot;{paperToDelete?.title}&quot; from your bookmarked papers. 
              {paperToDelete?.projects && paperToDelete.projects.length > 0 && (
                <> The paper will still be available in the {paperToDelete.projects.length} project{paperToDelete.projects.length !== 1 ? 's' : ''} where it&apos;s used.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaperToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => paperToDelete && deleteMutation.mutate(paperToDelete.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
