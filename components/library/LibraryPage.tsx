'use client'

import { useState, useMemo } from 'react'
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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface LibraryPaper {
  id: string
  paper_id: string
  added_at: string
  notes: string | null
  paper: {
    id: string
    title: string
    abstract: string | null
    authors: string[]
    publication_date: string | null
    venue: string | null
    doi: string | null
    source: string | null
    citation_count: number | null
  }
}

// Fetch library papers
async function fetchLibraryPapers(): Promise<LibraryPaper[]> {
  const response = await fetch('/api/papers?library=me&sortBy=added_at&sortOrder=desc&maxResults=100')
  if (!response.ok) throw new Error('Failed to load library')
  const data = await response.json()
  return data.papers || []
}

// Remove paper from library
async function removePaperFromLibrary(paperId: string): Promise<void> {
  const response = await fetch(`/api/library?paperId=${paperId}`, {
    method: 'DELETE',
  })
  if (!response.ok) throw new Error('Failed to remove paper')
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
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<'added_at' | 'title' | 'year'>('added_at')
  const [filterSource, setFilterSource] = useState<'all' | 'upload' | 'search'>('all')
  const [paperToDelete, setPaperToDelete] = useState<LibraryPaper | null>(null)

  // Fetch library papers
  const { data: papers = [], isLoading, error } = useQuery({
    queryKey: ['library', 'papers', 'full'],
    queryFn: fetchLibraryPapers,
    staleTime: 2 * 60 * 1000, // 2 minutes
  })

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

  // Filter and sort papers
  const filteredPapers = useMemo(() => {
    let result = [...papers]

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (p) =>
          p.paper.title.toLowerCase().includes(q) ||
          p.paper.authors?.some((a) => a.toLowerCase().includes(q)) ||
          p.paper.venue?.toLowerCase().includes(q) ||
          p.notes?.toLowerCase().includes(q)
      )
    }

    // Filter by source
    if (filterSource !== 'all') {
      result = result.filter((p) => p.paper.source === filterSource)
    }

    // Sort
    result.sort((a, b) => {
      switch (sortBy) {
        case 'title':
          return a.paper.title.localeCompare(b.paper.title)
        case 'year':
          const yearA = a.paper.publication_date ? new Date(a.paper.publication_date).getTime() : 0
          const yearB = b.paper.publication_date ? new Date(b.paper.publication_date).getTime() : 0
          return yearB - yearA
        case 'added_at':
        default:
          return new Date(b.added_at).getTime() - new Date(a.added_at).getTime()
      }
    })

    return result
  }, [papers, searchQuery, sortBy, filterSource])

  // Stats
  const stats = useMemo(() => {
    const uploadCount = papers.filter((p) => p.paper.source === 'upload').length
    const searchCount = papers.filter((p) => p.paper.source !== 'upload').length
    return { total: papers.length, uploaded: uploadCount, searched: searchCount }
  }, [papers])

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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Upload className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.uploaded}</p>
              <p className="text-sm text-muted-foreground">Uploaded PDFs</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/10">
              <Search className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.searched}</p>
              <p className="text-sm text-muted-foreground">From Search</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
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

        <Select value={filterSource} onValueChange={(v) => setFilterSource(v as typeof filterSource)}>
          <SelectTrigger className="w-full sm:w-36">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            <SelectItem value="upload">Uploaded</SelectItem>
            <SelectItem value="search">From Search</SelectItem>
          </SelectContent>
        </Select>

        <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="added_at">Recently Added</SelectItem>
            <SelectItem value="title">Title (A-Z)</SelectItem>
            <SelectItem value="year">Year (Newest)</SelectItem>
          </SelectContent>
        </Select>
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
            {searchQuery || filterSource !== 'all' ? (
              <Search className="h-8 w-8 text-muted-foreground" />
            ) : (
              <BookOpen className="h-8 w-8 text-muted-foreground" />
            )}
          </div>
          <h3 className="text-lg font-semibold mb-2">
            {searchQuery || filterSource !== 'all' ? 'No papers found' : 'Your library is empty'}
          </h3>
          <p className="text-sm text-muted-foreground max-w-md">
            {searchQuery || filterSource !== 'all'
              ? 'Try adjusting your search or filters.'
              : 'Start by uploading PDFs or searching for papers to add to your library.'}
          </p>
        </div>
      ) : (
        <ScrollArea className="h-[calc(100vh-400px)] min-h-[400px]">
          <div className="space-y-3 pr-4">
            {filteredPapers.map((item) => (
              <Card key={item.id} className="p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div className="flex-shrink-0 mt-1">
                    {item.paper.source === 'upload' ? (
                      <div className="p-2 rounded-lg bg-blue-500/10">
                        <FileText className="h-4 w-4 text-blue-500" />
                      </div>
                    ) : (
                      <div className="p-2 rounded-lg bg-green-500/10">
                        <Search className="h-4 w-4 text-green-500" />
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 space-y-2">
                    <h3 className="font-medium leading-snug line-clamp-2">{item.paper.title}</h3>

                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1 truncate">
                        <Users className="h-3.5 w-3.5 flex-shrink-0" />
                        {formatAuthors(item.paper.authors)}
                      </span>
                      {item.paper.publication_date && (
                        <span className="flex items-center gap-1 flex-shrink-0">
                          <Calendar className="h-3.5 w-3.5" />
                          {formatDate(item.paper.publication_date)}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {item.paper.venue && (
                        <Badge variant="secondary" className="text-xs">
                          {item.paper.venue}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-xs">
                        {item.paper.source === 'upload' ? 'Uploaded' : 'Found'}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Added {new Date(item.added_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {item.paper.doi && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => window.open(`https://doi.org/${item.paper.doi}`, '_blank')}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => setPaperToDelete(item)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
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
              This will remove &quot;{paperToDelete?.paper.title}&quot; from your library. The paper will still be
              available in any projects where it&apos;s been cited.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaperToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => paperToDelete && deleteMutation.mutate(paperToDelete.paper_id)}
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
