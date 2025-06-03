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
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { 
  BookOpen, 
  Search, 
  Plus, 
  Filter,
  SortAsc,
  SortDesc,
  MoreVertical,
  ExternalLink,
  Trash2,
  Edit3,
  Calendar,
  Quote,
  FolderPlus,
  Folder,
  Heart,
  BookMarked,
  Download,
  Share2,
  Eye,
  X,
  Check,
  Loader2,
  Upload
} from 'lucide-react'
import { format } from 'date-fns'
import type { 
  LibraryPaper, 
  LibraryCollection, 
  Paper,
  LibraryFilters,
  SearchPapersResponse
} from '@/types/simplified'
import FileUpload from '@/components/FileUpload'

interface LibraryManagerProps {
  className?: string
}

export default function LibraryManager({ className }: LibraryManagerProps) {
  // Library state
  const [libraryPapers, setLibraryPapers] = useState<LibraryPaper[]>([])
  const [collections, setCollections] = useState<LibraryCollection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Search and filters
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Paper[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [filters, setFilters] = useState<LibraryFilters>({
    sortBy: 'added_at',
    sortOrder: 'desc'
  })

  // UI state
  const [selectedPapers, setSelectedPapers] = useState<Set<string>>(new Set())
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showCollectionDialog, setShowCollectionDialog] = useState(false)
  const [editingNotes, setEditingNotes] = useState<string | null>(null)
  const [notesText, setNotesText] = useState('')

  // Collection creation
  const [newCollectionName, setNewCollectionName] = useState('')
  const [newCollectionDescription, setNewCollectionDescription] = useState('')

  useEffect(() => {
    loadLibraryData()
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

      const [libraryResponse, collectionsResponse] = await Promise.all([
        fetch(`/api/library?${params.toString()}`, { credentials: 'include' }),
        fetch('/api/collections', { credentials: 'include' })
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

  const searchOnlinePapers = async (query: string) => {
    if (!query.trim()) return

    try {
      setIsSearching(true)
      const response = await fetch(`/api/search-papers?q=${encodeURIComponent(query)}&online=true&limit=20`, {
        credentials: 'include'
      })
      
      if (response.ok) {
        const data: SearchPapersResponse = await response.json()
        setSearchResults(data.papers)
      }
    } catch (err) {
      console.error('Search error:', err)
    } finally {
      setIsSearching(false)
    }
  }

  const addPaperToLibrary = async (paperId: string, notes?: string) => {
    try {
      const response = await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ paperId, notes })
      })

      if (response.ok) {
        await loadLibraryData()
        setSearchResults(prev => prev.filter(p => p.id !== paperId))
      }
    } catch (err) {
      console.error('Error adding paper:', err)
    }
  }

  const removePaperFromLibrary = async (paperId: string) => {
    try {
      const response = await fetch(`/api/library?paperId=${paperId}`, {
        method: 'DELETE',
        credentials: 'include'
      })

      if (response.ok) {
        setLibraryPapers(prev => prev.filter(p => p.paper.id !== paperId))
      }
    } catch (err) {
      console.error('Error removing paper:', err)
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

  const handleUploadComplete = async (uploadedPapers: any[]) => {
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
    const isInLibrary = !isSearchResult

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
                  {actualPaper.authors?.map(a => a.name).join(', ')}
                </p>
              </div>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {isSearchResult ? (
                    <DropdownMenuItem onClick={() => addPaperToLibrary(actualPaper.id)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add to Library
                    </DropdownMenuItem>
                  ) : (
                    <>
                      <DropdownMenuItem onClick={() => handleNotesEdit(libraryPaper!)}>
                        <Edit3 className="h-4 w-4 mr-2" />
                        Edit Notes
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => removePaperFromLibrary(actualPaper.id)}
                        className="text-red-600"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Remove
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
    <div className={`max-w-7xl mx-auto p-6 space-y-6 ${className}`}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Library</h1>
          <p className="text-muted-foreground">
            Manage your research papers and collections
          </p>
        </div>
        
        <div className="flex gap-2">
          <Dialog open={showCollectionDialog} onOpenChange={setShowCollectionDialog}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <FolderPlus className="h-4 w-4 mr-2" />
                New Collection
              </Button>
            </DialogTrigger>
            <DialogContent>
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
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowCollectionDialog(false)}>
                    Cancel
                  </Button>
                  <Button onClick={createCollection} disabled={!newCollectionName.trim()}>
                    Create Collection
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Papers
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[80vh]">
              <DialogHeader>
                <DialogTitle>Search and Add Papers</DialogTitle>
                <DialogDescription>
                  Search for papers online and add them to your library
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4">
                <div className="flex gap-2">
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
                  <Button 
                    onClick={() => searchOnlinePapers(searchQuery)}
                    disabled={isSearching || !searchQuery.trim()}
                  >
                    {isSearching ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-96 overflow-y-auto">
                  {searchResults.length === 0 && !isSearching && searchQuery && (
                    <div className="col-span-full text-center py-8 text-muted-foreground">
                      <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No papers found for "{searchQuery}"</p>
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
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Your Library
              </CardTitle>
              <CardDescription>
                {libraryPapers.length} papers in your library
              </CardDescription>
            </div>
            
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search library..."
                  value={filters.search || ''}
                  onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                  className="pl-10 w-64"
                />
              </div>
              
              <Select 
                value={filters.sortBy} 
                onValueChange={(value: 'added_at' | 'title' | 'publication_date' | 'citation_count') => 
                  setFilters(prev => ({ ...prev, sortBy: value }))
                }
              >
                <SelectTrigger className="w-40">
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
              >
                {filters.sortOrder === 'asc' ? (
                  <SortAsc className="h-4 w-4" />
                ) : (
                  <SortDesc className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        
        <CardContent>
          <Tabs defaultValue="all" className="w-full">
            <TabsList>
              <TabsTrigger value="all">
                All Papers ({libraryPapers.length})
              </TabsTrigger>
              <TabsTrigger value="upload">
                <Upload className="h-4 w-4 mr-1" />
                Upload
              </TabsTrigger>
              {collections.map(collection => (
                <TabsTrigger key={collection.id} value={collection.id}>
                  <Folder className="h-4 w-4 mr-1" />
                  {collection.name} ({collection.paper_count || 0})
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="upload" className="mt-6">
              <FileUpload onUploadComplete={handleUploadComplete} />
            </TabsContent>

            <TabsContent value="all" className="mt-6">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  <span>Loading library...</span>
                </div>
              ) : filteredLibraryPapers.length === 0 ? (
                <div className="text-center py-12">
                  <BookOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <h3 className="text-lg font-medium mb-2">No papers in your library</h3>
                  <p className="text-muted-foreground mb-4">
                    Start building your research library by adding papers
                  </p>
                  <Button onClick={() => setShowAddDialog(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Your First Paper
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredLibraryPapers.map(paper => (
                    <PaperCard key={paper.id} paper={paper} />
                  ))}
                </div>
              )}
            </TabsContent>

            {collections.map(collection => (
              <TabsContent key={collection.id} value={collection.id} className="mt-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
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
                    <p>Collection management coming soon</p>
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