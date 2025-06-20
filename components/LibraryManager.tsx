'use client'

import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

import { 
  BookOpen, 
  Search, 
  Plus, 
  SortAsc,
  SortDesc,
  MoreVertical,
  ExternalLink,
  Trash2,
  Edit3,
  Quote,
  FolderPlus,
  Folder,

  X,
  Check,
  Upload,
  Settings,
  Star
} from 'lucide-react'
import { format } from 'date-fns'
import type { 
  LibraryPaper, 
  LibraryCollection, 
  Paper,
  LibraryFilters,
  PaperWithAuthors,
  PaperSources,
  PaperSource
} from '@/types/simplified'
import FileUpload from '@/components/FileUpload'
import React from 'react'
import { LoadingSpinner } from '@/components/ui/loading-spinner'

interface LibraryManagerProps {
  className?: string
}

export default function LibraryManager({ className }: LibraryManagerProps) {
  // Library state
  const [libraryPapers, setLibraryPapers] = useState<LibraryPaper[]>([])
  const [collections, setCollections] = useState<LibraryCollection[]>([])
  const [loading, setLoading] = useState(true)
  const [error,setError] = useState<string | null>(null)

  // Search and filters
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Paper[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [processingPapers, setProcessingPapers] = useState<Set<string>>(new Set())
  const [filters, setFilters] = useState<LibraryFilters>({
    sortBy: 'added_at',
    sortOrder: 'desc'
  })
  
  // Advanced search options
  const [searchOptions, setSearchOptions] = useState({
    sources: ['openalex', 'crossref', 'semantic_scholar'] as PaperSources,
    maxResults: 25,
    includePreprints: true,
    fromYear: undefined as number | undefined,
    toYear: undefined as number | undefined,
    openAccessOnly: false
  })
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false)
  // UI state
  //  const [selectedPapers, setSelectedPapers] = useState<Set<string>>(new Set())
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showCollectionDialog, setShowCollectionDialog] = useState(false)
  const [editingNotes, setEditingNotes] = useState<string | null>(null)
  const [notesText, setNotesText] = useState('')
  const [removingPapers, setRemovingPapers] = useState<Set<string>>(new Set())

  // Collection creation
  const [newCollectionName, setNewCollectionName] = useState('')
  const [newCollectionDescription, setNewCollectionDescription] = useState('')

  useEffect(() => {
    loadLibraryData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  const loadLibraryData = async () => {
    try {
      setLoading(true)
      setError(null)

      const params = new URLSearchParams()
      if (filters.search) params.set('search', filters.search)
      if (filters.collectionId) params.set('collection', filters.collectionId)
      if (filters.source) params.set('source', filters.source)
      if (filters.sortBy) params.set('sortBy', filters.sortBy)
      if (filters.sortOrder) params.set('sortOrder', filters.sortOrder)
      
      // Add timestamp for cache busting
      params.set('_t', Date.now().toString())

      const [libraryResponse, collectionsResponse] = await Promise.all([
        fetch(`/api/library?${params.toString()}`, { 
          credentials: 'include',
          cache: 'no-store' // Prevent browser caching
        }),
        fetch(`/api/collections?_t=${Date.now()}`, { 
          credentials: 'include',
          cache: 'no-store' // Prevent browser caching
        })
      ])

      if (libraryResponse.ok) {
        const { papers } = await libraryResponse.json()
        setLibraryPapers(papers)
      }

      if (collectionsResponse.ok) {
        const { collections } = await collectionsResponse.json()
        setCollections(collections)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load library')
    } finally {
      setLoading(false)
    }
  }
  console.log(error)
  const searchOnlinePapers = async (query: string) => {
    if (!query.trim()) return

    try {
      setIsSearching(true)
      
      // Use lightweight library search for fast UX
      const response = await fetch('/api/library-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          query: query,
          options: {
            maxResults: searchOptions.maxResults,
            sources: searchOptions.sources,
            includePreprints: searchOptions.includePreprints,
            fromYear: searchOptions.fromYear,
            toYear: searchOptions.toYear,
            openAccessOnly: searchOptions.openAccessOnly
          }
        })
      })
      
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          // Transform the results to match Paper interface
          const transformedPapers: PaperWithAuthors[] = data.papers.map((paper: PaperWithAuthors) => ({
            id: paper.id,
            title: paper.title,
            abstract: paper.abstract,
            publication_date: paper.publication_date ? `${paper.publication_date}-01-01` : null,
            venue: paper.venue,
            doi: paper.doi,
            url: paper.url,
            pdf_url: null,
            metadata: {
              citation_count: paper.citation_count,
              impact_score: paper.impact_score,
              source: paper.source
            },
            source: paper.source,
            citation_count: paper.citation_count || 0,
            impact_score: Math.max(paper.impact_score || 0, 0),
            created_at: new Date().toISOString(),
            authors: [],
            author_names: []
          }))
          
          setSearchResults(transformedPapers)
          console.log(`📚 Library search found ${transformedPapers.length} papers from sources: ${searchOptions.sources.join(', ')}`)
        } else {
          console.error('Library search failed:', data.error)
          setSearchResults([])
        }
      } else {
        console.error('Library search request failed:', response.status)
        setSearchResults([])
      }
    } catch (err) {
      console.error('Library search error:', err)
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }

  const addPaperToLibrary = async (paperId: string, notes?: string) => {
    try {
      // Show processing status
      setProcessingPapers(prev => new Set(prev).add(paperId))
      
      // First, check if the paper exists in database, if not, ingest it lightly
      const searchResult = searchResults.find(p => p.id === paperId)
      if (searchResult) {
        // Convert search result to PaperDTO for lightweight ingestion
        const paperDTO = {
          title: searchResult.title,
          abstract: searchResult.abstract || undefined,
          publication_date: searchResult.publication_date || undefined,
          venue: searchResult.venue || undefined,
          doi: searchResult.doi || undefined,
          url: searchResult.url || undefined,
          pdf_url: searchResult.pdf_url || undefined,
          metadata: {
            ...searchResult.metadata,
            added_via: 'library_search'
          },
          source: searchResult.source || 'library_search',
          citation_count: searchResult.citation_count || 0,
          impact_score: searchResult.impact_score || 0,
          authors: searchResult.authors?.map(a => a.name || a) || []
        }

        // Ingest paper without chunks using the library ingestion API
        const ingestResponse = await fetch('/api/papers/ingest-lightweight', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ paper: paperDTO })
        })

        if (!ingestResponse.ok) {
          console.warn('Failed to ingest paper, but continuing with library addition')
        } else {
          const { paperId: actualPaperId } = await ingestResponse.json()
          console.log(`📚 Paper ingested without chunks: ${actualPaperId}`)
          
          // If paper has PDF URL, queue it for background processing
          if (searchResult.pdf_url) {
            console.log(`📄 Queueing PDF processing for: ${searchResult.title}`)
            try {
              const { pdfQueue } = await import('@/lib/services/pdf-queue')
              const jobId = await pdfQueue.addJob(
                actualPaperId, 
                searchResult.pdf_url, 
                searchResult.title, 
                'user-id', // TODO: Get actual user ID
                'normal'
              )
              console.log(`✅ PDF processing queued: ${jobId}`)
              
              // Subscribe to real-time updates (optional)
              pdfQueue.subscribeToStatus(jobId, (status) => {
                console.log(`📄 PDF processing update:`, status)
                // TODO: Update UI with processing status
              })
            } catch (pdfError) {
              console.warn(`⚠️ PDF processing queue failed, but paper still added to library:`, pdfError)
            }
          }
        }
      }

      // Add to user's library
      const response = await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ paperId, notes })
      })

      if (response.ok) {
        await loadLibraryData()
        setSearchResults(prev => prev.filter(p => p.id !== paperId))
        console.log(`📚 Paper added to library: ${paperId}`)
      } else {
        const errorData = await response.json()
        
        // Handle duplicate entries gracefully
        if (response.status === 409 && errorData.code === 'DUPLICATE_ENTRY') {
          // Remove from search results without showing error
          setSearchResults(prev => prev.filter(p => p.id !== paperId))
          console.log(`📚 Paper already in library: ${paperId}`)
          return // Don't throw error for duplicates
        }
        
        console.error('Failed to add paper to library:', errorData.error)
        throw new Error(errorData.error || 'Failed to add to library')
      }
    } catch (err) {
      console.error('Error adding paper to library:', err)
      // Show error feedback to user
      alert(`Failed to add paper to library: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      // Clear processing status
      setProcessingPapers(prev => {
        const newSet = new Set(prev)
        newSet.delete(paperId)
        return newSet
      })
    }
  }

  const removePaperFromLibrary = async (paperId: string) => {
    try {
      console.log(`🗑️ Attempting to remove paper: ${paperId}`)
      
      // Add to removing state
      setRemovingPapers(prev => new Set(prev).add(paperId))
      
      const response = await fetch(`/api/library?paperId=${paperId}`, {
        method: 'DELETE',
        credentials: 'include'
      })

      console.log(`📡 DELETE response status: ${response.status}`)

      if (response.ok) {
        console.log(`✅ Successfully removed paper: ${paperId}`)
        
        // Optimistically update UI first
        setLibraryPapers(prev => prev.filter(p => p.paper.id !== paperId))
        
        // Then reload data to ensure consistency with server
        await loadLibraryData()
        
        // Optional: Show success toast
        // toast.success('Paper removed from library')
      } else {
        // Handle specific error cases
        const errorData = await response.text()
        console.error(`❌ Failed to remove paper: ${response.status} - ${errorData}`)
        
        if (response.status === 401) {
          console.error('Authentication required - user may need to log in again')
          // Optional: Show auth error toast
          // toast.error('Please log in again to remove papers')
        } else if (response.status === 404) {
          console.error('Paper not found in library')
          // Paper might already be removed, so update UI and reload data
          setLibraryPapers(prev => prev.filter(p => p.paper.id !== paperId))
          await loadLibraryData()
        } else {
          console.error('Unknown error removing paper')
          // Reload data to ensure UI reflects server state
          await loadLibraryData()
          // Optional: Show generic error toast  
          // toast.error('Failed to remove paper from library')
        }
      }
    } catch (err) {
      console.error('Network error removing paper:', err)
      // Reload data on network error to ensure consistency
      await loadLibraryData()
      // Optional: Show network error toast
      // toast.error('Network error - please try again')
    } finally {
      // Remove from removing state
      setRemovingPapers(prev => {
        const newSet = new Set(prev)
        newSet.delete(paperId)
        return newSet
      })
    }
  }

  const updatePaperNotes = async (libraryPaperId: string, notes: string) => {
    try {
      const response = await fetch(`/api/library?id=${libraryPaperId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ notes })
      })

      if (response.ok) {
        setLibraryPapers(prev => prev.map(paper => 
          paper.id === libraryPaperId 
            ? { ...paper, notes }
            : paper
        ))
      }
    } catch (err) {
      console.error('Error updating notes:', err)
    }
  }

  const createCollection = async () => {
    if (!newCollectionName.trim()) return

    try {
      const response = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: newCollectionName.trim(),
          description: newCollectionDescription.trim() || undefined
        })
      })

      if (response.ok) {
        setShowCollectionDialog(false)
        setNewCollectionName('')
        setNewCollectionDescription('')
        // Reload to get updated collections
        await loadLibraryData()
      }
    } catch (err) {
      console.error('Error creating collection:', err)
    }
  }
  const handleUploadComplete = async () => {
    // Refresh library data to show newly uploaded papers
    await loadLibraryData()
  }

  const filteredLibraryPapers = useMemo(() => {
    return libraryPapers.filter(paper => {
      if (filters.search) {
        const search = filters.search.toLowerCase()
        return (
          paper.paper.title.toLowerCase().includes(search) ||
          paper.paper.abstract?.toLowerCase().includes(search) ||
          paper.notes?.toLowerCase().includes(search)
        )
      }
      return true
    })
  }, [libraryPapers, filters.search])

  const handleNotesEdit = (libraryPaper: LibraryPaper) => {
    setEditingNotes(libraryPaper.id)
    setNotesText(libraryPaper.notes || '')
  }

  const saveNotes = async () => {
    if (!editingNotes) return
    
    await updatePaperNotes(editingNotes, notesText)
    setEditingNotes(null)
    setNotesText('')
  }

  const cancelNotesEdit = () => {
    setEditingNotes(null)
    setNotesText('')
  }

  const PaperCard = ({ paper, isSearchResult = false }: { paper: Paper | LibraryPaper, isSearchResult?: boolean }) => {
    const actualPaper = 'paper' in paper ? paper.paper : paper
    const libraryPaper = 'paper' in paper ? paper : null
    // const isInLibrary = !isSearchResult
    const isProcessing = isSearchResult && processingPapers.has(actualPaper.id)
    const isRemoving = removingPapers.has(actualPaper.id)

    return (
      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="pt-4">
          <div className="space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex-1 space-y-1">
                <h3 className="font-medium text-sm leading-tight line-clamp-2">
                  {actualPaper.title}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {actualPaper.authors?.map(a => typeof a === 'string' ? a : a.name).join(', ') || 'Unknown authors'}
                </p>
              </div>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" disabled={isProcessing}>
                    {isProcessing ? (
                      <LoadingSpinner size="sm" className="h-4 w-4" />
                    ) : (
                      <MoreVertical className="h-4 w-4" />
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {isSearchResult ? (
                    <DropdownMenuItem 
                      onClick={() => addPaperToLibrary(actualPaper.id)}
                      disabled={isProcessing}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      {isProcessing ? 'Adding...' : 'Add to Library'}
                    </DropdownMenuItem>
                  ) : (
                    <>
                      <DropdownMenuItem onClick={() => handleNotesEdit(libraryPaper!)}>
                        <Edit3 className="h-4 w-4 mr-2" />
                        Edit Notes
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => removePaperFromLibrary(actualPaper.id)}
                        disabled={isRemoving}
                        className="text-red-600"
                      >
                        {isRemoving ? (
                          <LoadingSpinner size="sm" text="Remove" />
                        ) : (
                          <>
                            <Trash2 className="h-4 w-4 mr-2" />
                            Remove
                          </>
                        )}
                      </DropdownMenuItem>
                    </>
                  )}
                  {actualPaper.url && (
                    <DropdownMenuItem onClick={() => window.open(actualPaper.url, '_blank')}>
                      <ExternalLink className="h-4 w-4 mr-2" />
                      View Paper
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {isProcessing && (
              <div className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg">
                <LoadingSpinner size="sm" text="Adding to library..." className="text-blue-600" />
              </div>
            )}

            {actualPaper.abstract && (
              <p className="text-xs text-muted-foreground line-clamp-2">
                {actualPaper.abstract}
              </p>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              {actualPaper.venue && (
                <Badge variant="secondary" className="text-xs">
                  {actualPaper.venue}
                </Badge>
              )}
              {actualPaper.publication_date && (
                <span className="text-xs text-muted-foreground">
                  {new Date(actualPaper.publication_date).getFullYear()}
                </span>
              )}
              {actualPaper.citation_count && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Quote className="h-3 w-3" />
                  {actualPaper.citation_count}
                </span>
              )}
              
              {/* Show additional metadata for search results */}
              {isSearchResult && actualPaper.metadata && (
                <React.Fragment>
                  {(actualPaper.metadata as { source?: string }).source && (
                    <Badge variant="outline" className="text-xs">
                      {(actualPaper.metadata as { source: string }).source}
                    </Badge>
                  )}
                  {(actualPaper.metadata as { relevanceScore?: number }).relevanceScore && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Star className="h-3 w-3" />
                      {(actualPaper.metadata as { relevanceScore: number }).relevanceScore.toFixed(2)}
                    </span>
                  )}
                </React.Fragment>
              )}
            </div>

            {libraryPaper?.notes && editingNotes !== libraryPaper.id && (
              <div className="p-2 bg-muted rounded text-xs">
                <p className="font-medium mb-1">Notes:</p>
                <p>{libraryPaper.notes}</p>
              </div>
            )}

            {editingNotes === libraryPaper?.id && (
              <div className="space-y-2">
                <Textarea
                  placeholder="Add your notes..."
                  value={notesText}
                  onChange={(e) => setNotesText(e.target.value)}
                  rows={3}
                  className="text-xs"
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveNotes}>
                    <Check className="h-3 w-3 mr-1" />
                    Save
                  </Button>
                  <Button variant="outline" size="sm" onClick={cancelNotesEdit}>
                    <X className="h-3 w-3 mr-1" />
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {libraryPaper?.added_at && (
              <p className="text-xs text-muted-foreground">
                Added {format(new Date(libraryPaper.added_at), 'PP')}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className={`max-w-7xl mx-auto p-4 sm:p-6 space-y-4 sm:space-y-6 ${className}`}>
      {/* Header Section - Responsive */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Library</h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            Manage your research papers and collections
          </p>
        </div>
        
        {/* Action Buttons - Mobile Responsive */}
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Dialog open={showCollectionDialog} onOpenChange={setShowCollectionDialog}>
            <DialogTrigger asChild>
              <Button variant="outline" className="w-full sm:w-auto">
                <FolderPlus className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">New Collection</span>
                <span className="sm:hidden">New Collection</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="mx-4 sm:mx-0 w-[calc(100vw-2rem)] sm:w-full max-w-md">
              <DialogHeader>
                <DialogTitle>Create Collection</DialogTitle>
                <DialogDescription>
                  Organize your papers into collections for better management
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="collection-name">Collection Name</Label>
                  <Input
                    id="collection-name"
                    placeholder="e.g., Machine Learning Papers"
                    value={newCollectionName}
                    onChange={(e) => setNewCollectionName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="collection-description">Description (optional)</Label>
                  <Textarea
                    id="collection-description"
                    placeholder="Brief description of this collection..."
                    value={newCollectionDescription}
                    onChange={(e) => setNewCollectionDescription(e.target.value)}
                  />
                </div>
                <div className="flex flex-col sm:flex-row justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowCollectionDialog(false)} className="w-full sm:w-auto">
                    Cancel
                  </Button>
                  <Button onClick={createCollection} disabled={!newCollectionName.trim()} className="w-full sm:w-auto">
                    Create Collection
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button className="w-full sm:w-auto">
                <Plus className="h-4 w-4 mr-2" />
                Add Papers
              </Button>
            </DialogTrigger>
            <DialogContent className="mx-4 sm:mx-0 w-[calc(100vw-2rem)] sm:w-full max-w-4xl max-h-[90vh] sm:max-h-[80vh]">
              <DialogHeader>
                <DialogTitle>Search and Add Papers</DialogTitle>
                <DialogDescription>
                  Search for papers online and add them to your library
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4">
                {/* Search Controls - Mobile Responsive */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search for research papers..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && searchOnlinePapers(searchQuery)}
                      className="pl-10"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline"
                      onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                      className="px-3 w-full sm:w-auto"
                    >
                      <Settings className="h-4 w-4 sm:mr-0" />
                      <span className="sm:hidden ml-2">Advanced</span>
                    </Button>
                    <Button 
                      onClick={() => searchOnlinePapers(searchQuery)}
                      disabled={isSearching || !searchQuery.trim()}
                      className="w-full sm:w-auto"
                    >
                      {isSearching ? (
                        <LoadingSpinner size="sm" className="h-4 w-4 sm:mr-0" />
                      ) : (
                        <Search className="h-4 w-4 sm:mr-0" />
                      )}
                      <span className="sm:hidden ml-2">{isSearching ? 'Searching...' : 'Search'}</span>
                    </Button>
                  </div>
                </div>

                {/* Advanced Search Options - Mobile Responsive */}
                {showAdvancedOptions && (
                  <Card className="p-3 sm:p-4 bg-muted/50">
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Settings className="h-4 w-4" />
                        <span className="font-medium text-sm sm:text-base">Advanced Search Options</span>
                      </div>
                      
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Sources Selection */}
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">Search Sources</Label>
                          <div className="space-y-2">
                            {[
                              { id: 'openalex', label: 'OpenAlex', desc: 'Comprehensive research database' },
                              { id: 'crossref', label: 'Crossref', desc: 'DOI registry & metadata' },
                              { id: 'semantic_scholar', label: 'Semantic Scholar', desc: 'AI-powered search' },
                              { id: 'arxiv', label: 'ArXiv', desc: 'Preprint repository' },
                              { id: 'core', label: 'CORE', desc: 'Open access repository' }
                            ].map(source => (
                              <div key={source.id} className="flex items-center space-x-2">
                                <input
                                  type="checkbox"
                                  id={source.id}
                                  checked={searchOptions.sources.includes(source.id as PaperSource)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSearchOptions(prev => ({
                                        ...prev,
                                        sources: [...prev.sources, source.id as PaperSource]
                                      }))
                                    } else {
                                      setSearchOptions(prev => ({
                                        ...prev,
                                        sources: prev.sources.filter(s => s !== source.id as PaperSource)
                                      }))
                                    }
                                  }}
                                  className="rounded border-gray-300"
                                />
                                <Label htmlFor={source.id} className="text-sm">
                                  <span className="font-medium">{source.label}</span>
                                  <span className="text-muted-foreground ml-1 hidden sm:inline">({source.desc})</span>
                                </Label>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Filters */}
                        <div className="space-y-3">
                          <div className="space-y-2">
                            <Label className="text-sm font-medium">Max Results</Label>
                            <Select 
                              value={searchOptions.maxResults.toString()} 
                              onValueChange={(value) => setSearchOptions(prev => ({ ...prev, maxResults: parseInt(value) }))}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="10">10 papers</SelectItem>
                                <SelectItem value="25">25 papers</SelectItem>
                                <SelectItem value="50">50 papers</SelectItem>
                                <SelectItem value="100">100 papers</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2">
                            <Label className="text-sm font-medium">Publication Year Range</Label>
                            <div className="flex gap-2">
                              <Input
                                type="number"
                                placeholder="From year"
                                value={searchOptions.fromYear || ''}
                                onChange={(e) => setSearchOptions(prev => ({ 
                                  ...prev, 
                                  fromYear: e.target.value ? parseInt(e.target.value) : undefined 
                                }))}
                                className="flex-1"
                              />
                              <span className="self-center text-muted-foreground text-sm">to</span>
                              <Input
                                type="number"
                                placeholder="To year"
                                value={searchOptions.toYear || ''}
                                onChange={(e) => setSearchOptions(prev => ({ 
                                  ...prev, 
                                  toYear: e.target.value ? parseInt(e.target.value) : undefined 
                                }))}
                                className="flex-1"
                              />
                            </div>
                          </div>

                          <div className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              id="preprints"
                              checked={searchOptions.includePreprints}
                              onChange={(e) => setSearchOptions(prev => ({ ...prev, includePreprints: e.target.checked }))}
                              className="rounded border-gray-300"
                            />
                            <Label htmlFor="preprints" className="text-sm">Include preprints</Label>
                          </div>

                          <div className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              id="openaccess"
                              checked={searchOptions.openAccessOnly}
                              onChange={(e) => setSearchOptions(prev => ({ ...prev, openAccessOnly: e.target.checked }))}
                              className="rounded border-gray-300"
                            />
                            <Label htmlFor="openaccess" className="text-sm">Open access only</Label>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>
                )}

                {/* Search Results Summary - Mobile Responsive */}
                {searchResults.length > 0 && !isSearching && (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <Search className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">
                        Found {searchResults.length} papers
                      </span>
                      {searchQuery && (
                        <span className="text-sm text-muted-foreground hidden sm:inline">
                          for &quot;{searchQuery}&quot;
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      {searchOptions.sources.map(source => (
                        <Badge key={source} variant="outline" className="text-xs">
                          {source}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Search Results Grid - Mobile Responsive */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-h-96 overflow-y-auto">
                  {searchResults.length === 0 && !isSearching && searchQuery && (
                    <div className="col-span-full text-center py-8 text-muted-foreground">
                      <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No papers found for &quot;{searchQuery}&quot;</p>
                    </div>
                  )}
                  
                  {searchResults.map(paper => (
                    <PaperCard key={paper.id} paper={paper} isSearchResult />
                  ))}
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Your Library
              </CardTitle>
              <CardDescription>
                {libraryPapers.length} papers in your library
              </CardDescription>
            </div>
            
            {/* Search and Filter Controls - Mobile Responsive */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full lg:w-auto">
              <div className="relative flex-1 lg:flex-initial">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search library..."
                  value={filters.search || ''}
                  onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                  className="pl-10 w-full lg:w-64"
                />
              </div>
              
              <div className="flex gap-2">
                <Select 
                  value={filters.sortBy} 
                  onValueChange={(value: 'added_at' | 'title' | 'publication_date' | 'citation_count') => 
                    setFilters(prev => ({ ...prev, sortBy: value }))
                  }
                >
                  <SelectTrigger className="w-full sm:w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="added_at">Date Added</SelectItem>
                    <SelectItem value="title">Title</SelectItem>
                    <SelectItem value="publication_date">Publication Date</SelectItem>
                    <SelectItem value="citation_count">Citations</SelectItem>
                  </SelectContent>
                </Select>
                
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setFilters(prev => ({ 
                    ...prev, 
                    sortOrder: prev.sortOrder === 'asc' ? 'desc' : 'asc' 
                  }))}
                  className="px-3"
                >
                  {filters.sortOrder === 'asc' ? (
                    <SortAsc className="h-4 w-4" />
                  ) : (
                    <SortDesc className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        
        <CardContent>
          <Tabs defaultValue="all" className="w-full">
            {/* Tabs List - Mobile Responsive */}
            <div className="overflow-x-auto">
              <TabsList className="w-full sm:w-auto">
                <TabsTrigger value="all" className="text-xs sm:text-sm">
                  <span className="hidden sm:inline">All Papers ({libraryPapers.length})</span>
                  <span className="sm:hidden">All ({libraryPapers.length})</span>
                </TabsTrigger>
                <TabsTrigger value="upload" className="text-xs sm:text-sm">
                  <Upload className="h-4 w-4 mr-1" />
                  <span className="hidden sm:inline">Upload</span>
                </TabsTrigger>
                {collections.map(collection => (
                  <TabsTrigger key={collection.id} value={collection.id} className="text-xs sm:text-sm">
                    <Folder className="h-4 w-4 mr-1" />
                    <span className="hidden sm:inline">{collection.name} ({collection.paper_count || 0})</span>
                    <span className="sm:hidden">{collection.name.substring(0, 8)}...</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            <TabsContent value="upload" className="mt-6">
              <FileUpload onUploadComplete={handleUploadComplete} />
            </TabsContent>

            <TabsContent value="all" className="mt-6">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <LoadingSpinner text="Loading library..." />
                </div>
              ) : filteredLibraryPapers.length === 0 ? (
                <div className="text-center py-12">
                  <BookOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <h3 className="text-lg font-medium mb-2">No papers in your library</h3>
                  <p className="text-muted-foreground mb-4 text-sm sm:text-base">
                    Start building your research library by adding papers
                  </p>
                  <Button onClick={() => setShowAddDialog(true)} className="w-full sm:w-auto">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Your First Paper
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
                  {filteredLibraryPapers.map(paper => (
                    <PaperCard key={paper.id} paper={paper} />
                  ))}
                </div>
              )}
            </TabsContent>

            {collections.map(collection => (
              <TabsContent key={collection.id} value={collection.id} className="mt-6">
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <h3 className="font-medium">{collection.name}</h3>
                      {collection.description && (
                        <p className="text-sm text-muted-foreground">{collection.description}</p>
                      )}
                    </div>
                    <Badge variant="secondary">
                      {collection.paper_count || 0} papers
                    </Badge>
                  </div>
                  
                  <div className="text-center py-8 text-muted-foreground">
                    <Folder className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm sm:text-base">Collection management coming soon</p>
                  </div>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
} 