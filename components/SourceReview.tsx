'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { 
  Search, 
  BookOpen, 
  Pin, 
  PinOff,
  Users,
  Calendar,
  ExternalLink,
  AlertCircle
} from 'lucide-react'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import type { LibraryPaper, LibraryFilters, Author } from '@/types/simplified'

interface SourceReviewProps {
  selectedPaperIds: string[]
  onPaperSelectionChange: (paperId: string, selected: boolean) => void
  onPinnedPapersChange: (pinnedIds: string[]) => void
  className?: string
}

interface LibraryResponse {
  papers: LibraryPaper[]
  total: number
}

export default function SourceReview({ 
  selectedPaperIds, 
  onPaperSelectionChange, 
  onPinnedPapersChange,
  className 
}: SourceReviewProps) {
  const [libraryPapers, setLibraryPapers] = useState<LibraryPaper[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pinnedPaperIds, setPinnedPaperIds] = useState<Set<string>>(new Set(selectedPaperIds))
  
  // Filter states
  const [filters, setFilters] = useState<LibraryFilters>({
    search: '',
    sortBy: 'added_at',
    sortOrder: 'desc'
  })

  // Memoized utility functions
  const formatDate = useCallback((dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }, [])

  const formatAuthors = useCallback((authors: Author[]) => {
    if (!authors || authors.length === 0) return 'Unknown authors'
    if (authors.length === 1) return authors[0].name
    if (authors.length === 2) return `${authors[0].name} & ${authors[1].name}`
    return `${authors[0].name} et al.`
  }, [])

  // Memoized filtered papers to prevent unnecessary recalculations
  const filteredPapers = useMemo(() => {
    let filtered = [...libraryPapers]

    // Apply search filter
    if (filters.search) {
      const searchLower = filters.search.toLowerCase()
      filtered = filtered.filter(lp => 
        lp.paper.title.toLowerCase().includes(searchLower) ||
        lp.paper.abstract?.toLowerCase().includes(searchLower) ||
        lp.paper.authors?.some(author => 
          author.name.toLowerCase().includes(searchLower)
        ) ||
        lp.paper.venue?.toLowerCase().includes(searchLower) ||
        lp.notes?.toLowerCase().includes(searchLower)
      )
    }

    // Apply source filter
    if (filters.source) {
      filtered = filtered.filter(lp => lp.paper.source === filters.source)
    }

    // Apply sorting
    const sortBy = filters.sortBy || 'added_at'
    const sortOrder = filters.sortOrder || 'desc'
    
    filtered.sort((a, b) => {
      let comparison = 0
      
      switch (sortBy) {
        case 'added_at':
          comparison = new Date(a.added_at).getTime() - new Date(b.added_at).getTime()
          break
        case 'title':
          comparison = a.paper.title.localeCompare(b.paper.title)
          break
        case 'publication_date':
          const dateA = a.paper.publication_date ? new Date(a.paper.publication_date).getTime() : 0
          const dateB = b.paper.publication_date ? new Date(b.paper.publication_date).getTime() : 0
          comparison = dateA - dateB
          break
        case 'citation_count':
          comparison = (a.paper.citation_count || 0) - (b.paper.citation_count || 0)
          break
        default:
          comparison = 0
      }
      
      return sortOrder === 'asc' ? comparison : -comparison
    })

    return filtered
  }, [libraryPapers, filters])

  const loadLibraryPapers = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      
      const response = await fetch('/api/library/papers', {
        credentials: 'include'
      })
      
      if (!response.ok) {
        throw new Error('Failed to fetch library papers')
      }
      
      const data: LibraryResponse = await response.json()
      setLibraryPapers(data.papers || [])
    } catch (error) {
      console.error('Failed to load library:', error)
      setError('Failed to load library papers')
    } finally {
      setLoading(false)
    }
  }, [])

  const handlePinToggle = useCallback((paperId: string) => {
    const newPinnedIds = new Set(pinnedPaperIds)
    if (newPinnedIds.has(paperId)) {
      newPinnedIds.delete(paperId)
      onPaperSelectionChange(paperId, false)
    } else {
      newPinnedIds.add(paperId)
      onPaperSelectionChange(paperId, true)
    }
    setPinnedPaperIds(newPinnedIds)
  }, [pinnedPaperIds, onPaperSelectionChange])

  const handleSelectAll = useCallback(() => {
    const allIds = filteredPapers.map(lp => lp.paper.id)
    setPinnedPaperIds(new Set(allIds))
    allIds.forEach(id => onPaperSelectionChange(id, true))
  }, [filteredPapers, onPaperSelectionChange])

  const handleClearAll = useCallback(() => {
    pinnedPaperIds.forEach(id => onPaperSelectionChange(id, false))
    setPinnedPaperIds(new Set())
  }, [pinnedPaperIds, onPaperSelectionChange])

  // Load data only once
  useEffect(() => {
    loadLibraryPapers()
  }, [loadLibraryPapers])

  // Update parent only when pinnedPaperIds actually changes
  useEffect(() => {
    const pinnedArray = Array.from(pinnedPaperIds)
    onPinnedPapersChange(pinnedArray)
  }, [pinnedPaperIds, onPinnedPapersChange])

  if (loading) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-center py-8">
          <LoadingSpinner text="Loading your library..." />
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-center py-8">
          <AlertCircle className="h-6 w-6 text-red-500 mr-2" />
          <span className="text-red-700">{error}</span>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={loadLibraryPapers}
            className="ml-4"
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          Source Review
          <Badge variant="secondary" className="ml-auto">
            {pinnedPaperIds.size} pinned
          </Badge>
        </CardTitle>
        <CardDescription>
          Select papers from your library to use as sources. Pinned papers will be used alongside automatically discovered papers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Label htmlFor="search">Search papers</Label>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="search"
                  placeholder="Search title, authors, venue, or notes..."
                  value={filters.search}
                  onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Sort by</Label>
              <Select 
                value={`${filters.sortBy}-${filters.sortOrder}`}
                onValueChange={(value) => {
                  const [sortBy, sortOrder] = value.split('-') as [typeof filters.sortBy, typeof filters.sortOrder]
                  setFilters(prev => ({ ...prev, sortBy, sortOrder }))
                }}
              >
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="added_at-desc">Recently added</SelectItem>
                  <SelectItem value="added_at-asc">Oldest first</SelectItem>
                  <SelectItem value="title-asc">Title A-Z</SelectItem>
                  <SelectItem value="title-desc">Title Z-A</SelectItem>
                  <SelectItem value="publication_date-desc">Newest papers</SelectItem>
                  <SelectItem value="publication_date-asc">Oldest papers</SelectItem>
                  <SelectItem value="citation_count-desc">Most cited</SelectItem>
                  <SelectItem value="citation_count-asc">Least cited</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Bulk actions */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectAll}
                disabled={filteredPapers.length === 0}
              >
                <Pin className="h-4 w-4 mr-1" />
                Pin All ({filteredPapers.length})
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearAll}
                disabled={pinnedPaperIds.size === 0}
              >
                <PinOff className="h-4 w-4 mr-1" />
                Clear All
              </Button>
            </div>
            <div className="text-sm text-muted-foreground">
              {filteredPapers.length} of {libraryPapers.length} papers
            </div>
          </div>
        </div>

        <Separator />

        {/* Papers list */}
        <ScrollArea className="h-96">
          {filteredPapers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {libraryPapers.length === 0 
                ? "No papers in your library yet. Add some papers to get started."
                : "No papers match your search criteria."
              }
            </div>
          ) : (
            <div className="space-y-3">
              {filteredPapers.map((libraryPaper) => {
                const isPinned = pinnedPaperIds.has(libraryPaper.paper.id)
                
                return (
                  <Card 
                    key={libraryPaper.id}
                    className={`transition-all ${isPinned ? 'ring-2 ring-primary shadow-md' : 'hover:shadow-sm'}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <Button
                          variant={isPinned ? "default" : "outline"}
                          size="sm"
                          onClick={() => handlePinToggle(libraryPaper.paper.id)}
                          className="shrink-0"
                        >
                          {isPinned ? (
                            <Pin className="h-4 w-4" />
                          ) : (
                            <PinOff className="h-4 w-4" />
                          )}
                        </Button>
                        
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-sm leading-tight mb-1">
                            {libraryPaper.paper.title}
                          </h4>
                          
                          <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
                            <div className="flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              {formatAuthors(libraryPaper.paper.authors || [])}
                            </div>
                            {libraryPaper.paper.publication_date && (
                              <div className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {formatDate(libraryPaper.paper.publication_date)}
                              </div>
                            )}
                            {libraryPaper.paper.citation_count && (
                              <Badge variant="secondary" className="text-xs">
                                {libraryPaper.paper.citation_count} citations
                              </Badge>
                            )}
                          </div>
                          
                          {libraryPaper.paper.abstract && (
                            <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                              {libraryPaper.paper.abstract}
                            </p>
                          )}
                          
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {libraryPaper.paper.venue && (
                                <Badge variant="outline" className="text-xs">
                                  {libraryPaper.paper.venue}
                                </Badge>
                              )}
                              {libraryPaper.paper.source && (
                                <Badge variant="outline" className="text-xs">
                                  {libraryPaper.paper.source}
                                </Badge>
                              )}
                            </div>
                            
                            <div className="flex items-center gap-1">
                              {libraryPaper.paper.url && (
                                <Button variant="ghost" size="sm" asChild>
                                  <a 
                                    href={libraryPaper.paper.url} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="p-1"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                </Button>
                              )}
                            </div>
                          </div>
                          
                          {libraryPaper.notes && (
                            <div className="mt-2 p-2 bg-muted rounded text-xs">
                              <strong>Notes:</strong> {libraryPaper.notes}
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  )
} 