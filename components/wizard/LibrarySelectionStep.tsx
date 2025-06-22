'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { WizardState } from '../GenerationWizard'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import { 
  Search, 
  BookOpen, 
  Pin, 
  PinOff,
  Calendar,
  Users,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  Info
} from 'lucide-react'
import type { LibraryPaper, Author } from '@/types/simplified'

interface LibrarySelectionStepProps {
  state: WizardState
  onUpdate: (updates: Partial<WizardState>) => void
}

interface LibraryResponse {
  papers: LibraryPaper[]
  total: number
}

export default function LibrarySelectionStep({ state, onUpdate }: LibrarySelectionStepProps) {
  const [libraryPapers, setLibraryPapers] = useState<LibraryPaper[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPaperIds, setSelectedPaperIds] = useState<Set<string>>(
    new Set(state.selectedPapers)
  )

  // Filtered papers based on search
  const filteredPapers = libraryPapers.filter(lp => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      lp.paper.title.toLowerCase().includes(query) ||
      lp.paper.abstract?.toLowerCase().includes(query) ||
      lp.paper.authors?.some(author => 
        author.name.toLowerCase().includes(query)
      ) ||
      lp.paper.venue?.toLowerCase().includes(query) ||
      lp.notes?.toLowerCase().includes(query)
    )
  })

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

  useEffect(() => {
    loadLibraryPapers()
  }, [loadLibraryPapers])

  const handlePaperToggle = useCallback((paperId: string) => {
    setSelectedPaperIds(prev => {
      const newSelection = new Set(prev)
      if (newSelection.has(paperId)) {
        newSelection.delete(paperId)
      } else {
        newSelection.add(paperId)
      }
      
      // Update wizard state
      onUpdate({ 
        selectedPapers: Array.from(newSelection),
        useLibraryOnly: newSelection.size > 0 && state.useLibraryOnly
      })
      
      return newSelection
    })
  }, [onUpdate, state.useLibraryOnly])

  const handleSelectAll = useCallback(() => {
    const allIds = filteredPapers.map(lp => lp.paper.id)
    setSelectedPaperIds(new Set(allIds))
    onUpdate({ 
      selectedPapers: allIds,
      useLibraryOnly: true
    })
  }, [filteredPapers, onUpdate])

  const handleClearAll = useCallback(() => {
    setSelectedPaperIds(new Set())
    onUpdate({ 
      selectedPapers: [],
      useLibraryOnly: false
    })
  }, [onUpdate])

  const handleLibraryOnlyToggle = useCallback((checked: boolean) => {
    onUpdate({ useLibraryOnly: checked })
  }, [onUpdate])

  const formatAuthors = useCallback((authors: Author[]) => {
    if (!authors || authors.length === 0) return 'Unknown authors'
    if (authors.length === 1) return authors[0].name
    if (authors.length === 2) return `${authors[0].name} & ${authors[1].name}`
    return `${authors[0].name} et al.`
  }, [])

  const formatDate = useCallback((dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short'
    })
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingSpinner text="Loading your library..." />
      </div>
    )
  }

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <div>
              <p className="text-sm font-medium text-red-800">
                Failed to load library
              </p>
              <p className="text-xs text-red-700">
                {error}
              </p>
            </div>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={loadLibraryPapers}
            className="mt-2"
          >
            Try Again
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {/* Ultra Compact Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">
            Select Papers from Your Library
          </Label>
          <Badge variant="outline" className="text-xs h-4 px-1.5">
            Optional
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Choose papers to focus the AI's research, or enable library-only mode.
        </p>
        
        {/* Inline Library Only Toggle - More Compact */}
        <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs">
          <Switch
            id="library-only"
            checked={state.useLibraryOnly}
            onCheckedChange={handleLibraryOnlyToggle}
            className="scale-75"
          />
          <Label htmlFor="library-only" className="text-blue-800 font-medium flex-1">
            Use only my library papers ({selectedPaperIds.size} selected)
          </Label>
          <Info className="h-3 w-3 text-blue-600" />
        </div>
      </div>

      {libraryPapers.length === 0 ? (
        <div className="text-center py-4 p-3 bg-muted/30 rounded-lg">
          <BookOpen className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground mb-2">
            No papers in your library yet
          </p>
          <Button variant="outline" size="sm" asChild>
            <a href="/library" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3 w-3 mr-2" />
              Manage Library
            </a>
          </Button>
        </div>
      ) : (
        <>
          {/* Ultra Compact Search and Actions */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                placeholder="Search library..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-7 h-7 text-xs"
              />
            </div>
            
            <Button
              variant="outline"
              size="sm"
              onClick={handleSelectAll}
              disabled={filteredPapers.length === 0}
              className="text-xs px-2 h-7"
            >
              All ({filteredPapers.length})
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearAll}
              disabled={selectedPaperIds.size === 0}
              className="text-xs px-2 h-7"
            >
              Clear
            </Button>
          </div>

          {/* Ultra Compact Selected Summary */}
          {selectedPaperIds.size > 0 && (
            <div className="flex items-center gap-2 p-1.5 bg-green-50 border border-green-200 rounded text-xs">
              <CheckCircle2 className="h-3 w-3 text-green-600" />
              <span className="text-green-700 font-medium">
                {selectedPaperIds.size} papers selected
              </span>
            </div>
          )}

          {/* Ultra Compact Papers List */}
          <div className="border rounded-lg overflow-hidden">
            <div className="p-2 border-b bg-muted/30">
              <div className="flex items-center gap-2 text-xs font-medium">
                <BookOpen className="h-3 w-3" />
                Your Library ({filteredPapers.length} papers)
              </div>
            </div>
            <ScrollArea className="h-[280px]">
              <div className="p-1">
                {filteredPapers.map((libraryPaper) => {
                  const { paper } = libraryPaper
                  const isSelected = selectedPaperIds.has(paper.id)
                  
                  return (
                    <div
                      key={paper.id}
                      className={`p-2 rounded border transition-all cursor-pointer mb-1 ${
                        isSelected 
                          ? 'border-primary bg-primary/5 shadow-sm' 
                          : 'border-transparent hover:border-primary/30 hover:bg-muted/30'
                      }`}
                      onClick={() => handlePaperToggle(paper.id)}
                    >
                      <div className="flex items-start gap-2">
                        <button
                          className={`mt-0.5 p-0.5 rounded transition-colors ${
                            isSelected 
                              ? 'text-primary' 
                              : 'text-muted-foreground hover:text-primary'
                          }`}
                          onClick={(e) => {
                            e.stopPropagation()
                            handlePaperToggle(paper.id)
                          }}
                        >
                          {isSelected ? (
                            <Pin className="h-3 w-3" />
                          ) : (
                            <PinOff className="h-3 w-3" />
                          )}
                        </button>
                        
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-xs leading-tight mb-1 line-clamp-2">
                            {paper.title}
                          </h4>
                          
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                            <span className="flex items-center gap-1 truncate">
                              <Users className="h-2 w-2" />
                              {formatAuthors(paper.authors || [])}
                            </span>
                            
                            {paper.publication_date && (
                              <>
                                <span>•</span>
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-2 w-2" />
                                  {formatDate(paper.publication_date)}
                                </span>
                              </>
                            )}
                          </div>

                          <div className="flex items-center gap-1 flex-wrap">
                            {paper.venue && (
                              <Badge variant="outline" className="text-xs h-3 px-1">
                                {paper.venue.length > 20 ? paper.venue.substring(0, 20) + '...' : paper.venue}
                              </Badge>
                            )}
                          </div>
                          
                          {libraryPaper.notes && (
                            <div className="mt-1 p-1 bg-muted/50 rounded text-xs line-clamp-1">
                              <strong>Note:</strong> {libraryPaper.notes}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </div>
        </>
      )}
    </div>
  )
} 