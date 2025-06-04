'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  Search, 
  BookOpen, 
  Download,
  FileText,
  ExternalLink,
  Users,
  Calendar,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  Filter,
  ArrowUpDown,
  Eye,
  Plus,
  X,
  Globe
} from 'lucide-react'
import { toast } from 'sonner'
import { LoadingSpinner } from '@/components/ui/loading-spinner'

interface RankedPaper {
  canonical_id: string
  title: string
  abstract: string
  year: number
  venue?: string
  doi?: string
  url?: string
  pdf_url?: string
  citationCount: number
  authors?: string[]
  source: 'openalex' | 'crossref' | 'semantic_scholar' | 'arxiv' | 'core'
  relevanceScore: number
  combinedScore: number
  bm25Score?: number
  authorityScore?: number
  recencyScore?: number
}

interface SearchOptions {
  limit?: number
  fromYear?: number
  toYear?: number
  openAccessOnly?: boolean
  maxResults?: number
  includePreprints?: boolean
  semanticWeight?: number
  authorityWeight?: number
  recencyWeight?: number
  sources?: Array<'openalex' | 'crossref' | 'semantic_scholar' | 'arxiv' | 'core'>
}

interface FetchSourcesResponse {
  success: boolean
  topic: string
  papers: RankedPaper[]
  count: number
  error?: string
}

interface PDFDownloadStatus {
  paperId: string
  hasPdf: boolean
  pdfUrl?: string
  doi?: string
  canDownload: boolean
  downloading?: boolean
  error?: string
}

interface FetchSourcesReviewProps {
  onPapersSelected: (papers: RankedPaper[]) => void
  className?: string
}

export default function FetchSourcesReview({ 
  onPapersSelected,
  className 
}: FetchSourcesReviewProps) {
  // Search state
  const [searchTopic, setSearchTopic] = useState('')
  const [searchOptions, setSearchOptions] = useState<SearchOptions>({
    maxResults: 25,
    fromYear: new Date().getFullYear() - 5, // Last 5 years by default
    openAccessOnly: false,
    sources: ['openalex', 'crossref', 'semantic_scholar']
  })
  
  // Results state
  const [papers, setPapers] = useState<RankedPaper[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedPaperIds, setSelectedPaperIds] = useState<Set<string>>(new Set())
  
  // PDF download state
  const [pdfStatus, setPdfStatus] = useState<Map<string, PDFDownloadStatus>>(new Map())
  const [batchDownloading, setBatchDownloading] = useState(false)
  
  // Filter state for results
  const [resultsFilter, setResultsFilter] = useState('')
  const [sortBy, setSortBy] = useState<'relevance' | 'citations' | 'year' | 'title'>('relevance')

  const formatAuthors = useCallback((authors?: string[]) => {
    if (!authors || authors.length === 0) return 'Unknown authors'
    if (authors.length === 1) return authors[0]
    if (authors.length === 2) return `${authors[0]} & ${authors[1]}`
    return `${authors[0]} et al.`
  }, [])

  const formatDate = useCallback((year?: number) => {
    return year ? year.toString() : 'Unknown year'
  }, [])

  // Filtered and sorted papers
  const filteredPapers = useMemo(() => {
    let filtered = [...papers]

    // Apply search filter
    if (resultsFilter) {
      const searchLower = resultsFilter.toLowerCase()
      filtered = filtered.filter(paper => 
        paper.title.toLowerCase().includes(searchLower) ||
        paper.abstract.toLowerCase().includes(searchLower) ||
        paper.authors?.some(author => 
          author.toLowerCase().includes(searchLower)
        ) ||
        paper.venue?.toLowerCase().includes(searchLower)
      )
    }

    // Apply sorting
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'relevance':
          return b.combinedScore - a.combinedScore
        case 'citations':
          return b.citationCount - a.citationCount
        case 'year':
          return b.year - a.year
        case 'title':
          return a.title.localeCompare(b.title)
        default:
          return 0
      }
    })

    return filtered
  }, [papers, resultsFilter, sortBy])

  // Search papers
  const searchPapers = useCallback(async () => {
    if (!searchTopic.trim()) {
      toast.error('Please enter a search topic')
      return
    }

    setLoading(true)
    setError(null)
    setPapers([])

    try {
      console.log('🔍 Searching for papers:', searchTopic)
      
      const response = await fetch('/api/fetch-sources', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          topic: searchTopic,
          options: searchOptions
        })
      })

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status} ${response.statusText}`)
      }

      const data: FetchSourcesResponse = await response.json()
      
      if (!data.success) {
        throw new Error(data.error || 'Search failed')
      }

      console.log(`✅ Found ${data.papers.length} papers`)
      setPapers(data.papers)
      
      // Initialize PDF status for papers with DOIs
      const initialPdfStatus = new Map<string, PDFDownloadStatus>()
      data.papers.forEach(paper => {
        initialPdfStatus.set(paper.canonical_id, {
          paperId: paper.canonical_id,
          hasPdf: !!paper.pdf_url,
          pdfUrl: paper.pdf_url,
          doi: paper.doi,
          canDownload: !!paper.doi && !paper.pdf_url
        })
      })
      setPdfStatus(initialPdfStatus)

      toast.success(`Found ${data.papers.length} papers for "${searchTopic}"`)

    } catch (error) {
      console.error('Search error:', error)
      const message = error instanceof Error ? error.message : 'Search failed'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [searchTopic, searchOptions])

  // Download PDF for a single paper
  const downloadPDF = useCallback(async (paper: RankedPaper) => {
    if (!paper.doi) {
      toast.error('No DOI available for PDF download')
      return
    }

    const currentStatus = pdfStatus.get(paper.canonical_id)
    if (currentStatus?.downloading) return

    // Update status to downloading
    setPdfStatus(prev => new Map(prev.set(paper.canonical_id, {
      ...currentStatus!,
      downloading: true,
      error: undefined
    })))

    try {
      console.log(`📄 Downloading PDF for: ${paper.title}`)
      
      const response = await fetch('/api/papers/download-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          paperId: paper.canonical_id,
          doi: paper.doi
        })
      })

      const result = await response.json()

      if (result.success && result.pdf_url) {
        // Update status to success
        setPdfStatus(prev => new Map(prev.set(paper.canonical_id, {
          paperId: paper.canonical_id,
          hasPdf: true,
          pdfUrl: result.pdf_url,
          doi: paper.doi,
          canDownload: false,
          downloading: false
        })))

        // Update paper in the list
        setPapers(prev => prev.map(p => 
          p.canonical_id === paper.canonical_id 
            ? { ...p, pdf_url: result.pdf_url }
            : p
        ))

        toast.success(`PDF downloaded for "${paper.title}"`)
      } else {
        throw new Error(result.error || 'Failed to download PDF')
      }

    } catch (error) {
      console.error('PDF download error:', error)
      const message = error instanceof Error ? error.message : 'Download failed'
      
      // Update status to error
      setPdfStatus(prev => new Map(prev.set(paper.canonical_id, {
        ...currentStatus!,
        downloading: false,
        error: message
      })))

      toast.error(`PDF download failed: ${message}`)
    }
  }, [pdfStatus])

  // Batch download PDFs
  const batchDownloadPDFs = useCallback(async () => {
    const downloadablePapers = papers.filter(paper => {
      const status = pdfStatus.get(paper.canonical_id)
      return status?.canDownload && paper.doi
    })

    if (downloadablePapers.length === 0) {
      toast.error('No papers available for PDF download')
      return
    }

    setBatchDownloading(true)

    try {
      console.log(`📦 Starting batch download for ${downloadablePapers.length} papers`)
      
      const response = await fetch('/api/papers/download-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          batch: downloadablePapers.map(paper => ({
            id: paper.canonical_id,
            doi: paper.doi
          }))
        })
      })

      const result = await response.json()
      
      if (result.success) {
        // Update PDF status based on results
        const newPdfStatus = new Map(pdfStatus)
        
        result.results.forEach(({ paperId, result: downloadResult }: any) => {
          if (downloadResult.success) {
            newPdfStatus.set(paperId, {
              paperId,
              hasPdf: true,
              pdfUrl: downloadResult.pdf_url,
              canDownload: false
            })
          } else {
            const current = newPdfStatus.get(paperId)
            if (current) {
              newPdfStatus.set(paperId, {
                ...current,
                error: downloadResult.error
              })
            }
          }
        })
        
        setPdfStatus(newPdfStatus)
        toast.success(result.message)
      } else {
        throw new Error(result.error || 'Batch download failed')
      }

    } catch (error) {
      console.error('Batch download error:', error)
      const message = error instanceof Error ? error.message : 'Batch download failed'
      toast.error(message)
    } finally {
      setBatchDownloading(false)
    }
  }, [papers, pdfStatus])

  // Handle paper selection
  const handlePaperSelection = useCallback((paperId: string, selected: boolean) => {
    setSelectedPaperIds(prev => {
      const newSet = new Set(prev)
      if (selected) {
        newSet.add(paperId)
      } else {
        newSet.delete(paperId)
      }
      return newSet
    })
  }, [])

  // Handle select all/none
  const handleSelectAll = useCallback(() => {
    setSelectedPaperIds(new Set(filteredPapers.map(p => p.canonical_id)))
  }, [filteredPapers])

  const handleSelectNone = useCallback(() => {
    setSelectedPaperIds(new Set())
  }, [])

  // Update parent component when selection changes
  useEffect(() => {
    const selectedPapers = papers.filter(p => selectedPaperIds.has(p.canonical_id))
    onPapersSelected(selectedPapers)
  }, [selectedPaperIds, papers, onPapersSelected])

  const downloadableCount = useMemo(() => {
    return papers.filter(paper => {
      const status = pdfStatus.get(paper.canonical_id)
      return status?.canDownload
    }).length
  }, [papers, pdfStatus])

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          Source Discovery & Review
          {papers.length > 0 && (
            <Badge variant="secondary" className="ml-auto">
              {selectedPaperIds.size} selected
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Search for academic papers across multiple databases and review sources for your research.
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-6">
        <Tabs defaultValue="search" className="w-full">
          <TabsList>
            <TabsTrigger value="search">Search</TabsTrigger>
            <TabsTrigger value="results" disabled={papers.length === 0}>
              Results ({papers.length})
            </TabsTrigger>
          </TabsList>

          {/* Search Tab */}
          <TabsContent value="search" className="space-y-4">
            <div className="space-y-4">
              <div>
                <Label htmlFor="search-topic">Research Topic</Label>
                <div className="flex gap-2">
                  <Input
                    id="search-topic"
                    placeholder="e.g., machine learning in healthcare, climate change adaptation..."
                    value={searchTopic}
                    onChange={(e) => setSearchTopic(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && searchPapers()}
                    className="flex-1"
                  />
                  <Button 
                    onClick={searchPapers} 
                    disabled={loading || !searchTopic.trim()}
                    className="min-w-[100px]"
                  >
                    {loading ? (
                      <LoadingSpinner size="sm" text="Searching..." />
                    ) : (
                      <>
                        <Search className="h-4 w-4 mr-2" />
                        Search
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Search Options */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <Label>Max Results</Label>
                  <Select 
                    value={searchOptions.maxResults?.toString() || '25'}
                    onValueChange={(value) => setSearchOptions(prev => ({ 
                      ...prev, 
                      maxResults: parseInt(value) 
                    }))}
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

                <div>
                  <Label>From Year</Label>
                  <Input
                    type="number"
                    placeholder="2020"
                    value={searchOptions.fromYear || ''}
                    onChange={(e) => setSearchOptions(prev => ({ 
                      ...prev, 
                      fromYear: e.target.value ? parseInt(e.target.value) : undefined 
                    }))}
                    min="1900"
                    max={new Date().getFullYear()}
                  />
                </div>

                <div>
                  <Label>To Year</Label>
                  <Input
                    type="number"
                    placeholder="2024"
                    value={searchOptions.toYear || ''}
                    onChange={(e) => setSearchOptions(prev => ({ 
                      ...prev, 
                      toYear: e.target.value ? parseInt(e.target.value) : undefined 
                    }))}
                    min="1900"
                    max={new Date().getFullYear()}
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="open-access"
                    checked={searchOptions.openAccessOnly || false}
                    onCheckedChange={(checked) => setSearchOptions(prev => ({ 
                      ...prev, 
                      openAccessOnly: !!checked 
                    }))}
                  />
                  <Label htmlFor="open-access" className="text-sm">
                    Open Access Only
                  </Label>
                </div>
              </div>

              {/* Source Selection */}
              <div>
                <Label className="text-sm font-medium">Data Sources</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {[
                    { id: 'openalex', name: 'OpenAlex', desc: '240M+ papers' },
                    { id: 'crossref', name: 'Crossref', desc: 'DOI metadata' },
                    { id: 'semantic_scholar', name: 'Semantic Scholar', desc: 'AI research' },
                    { id: 'arxiv', name: 'arXiv', desc: 'Preprints' },
                    { id: 'core', name: 'CORE', desc: 'Open access' }
                  ].map(source => (
                    <div key={source.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={source.id}
                        checked={searchOptions.sources?.includes(source.id as any) || false}
                        onCheckedChange={(checked) => {
                          setSearchOptions(prev => ({
                            ...prev,
                            sources: checked 
                              ? [...(prev.sources || []), source.id as any]
                              : (prev.sources || []).filter(s => s !== source.id)
                          }))
                        }}
                      />
                      <Label htmlFor={source.id} className="text-sm">
                        {source.name}
                        <span className="text-muted-foreground ml-1">({source.desc})</span>
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-md">
                  <AlertCircle className="h-4 w-4" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          </TabsContent>

          {/* Results Tab */}
          <TabsContent value="results" className="space-y-4">
            {papers.length > 0 && (
              <>
                {/* Results Controls */}
                <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={handleSelectAll}
                      disabled={selectedPaperIds.size === filteredPapers.length}
                    >
                      Select All
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={handleSelectNone}
                      disabled={selectedPaperIds.size === 0}
                    >
                      Select None
                    </Button>
                    {downloadableCount > 0 && (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={batchDownloadPDFs}
                        disabled={batchDownloading}
                      >
                        {batchDownloading ? (
                          <LoadingSpinner size="sm" text="Downloading..." />
                        ) : (
                          <>
                            <Download className="h-4 w-4 mr-2" />
                            Download PDFs ({downloadableCount})
                          </>
                        )}
                      </Button>
                    )}
                  </div>

                  <div className="flex gap-2 items-center">
                    <Input
                      placeholder="Filter results..."
                      value={resultsFilter}
                      onChange={(e) => setResultsFilter(e.target.value)}
                      className="w-48"
                    />
                    <Select value={sortBy} onValueChange={(value: any) => setSortBy(value)}>
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="relevance">Relevance</SelectItem>
                        <SelectItem value="citations">Citations</SelectItem>
                        <SelectItem value="year">Year</SelectItem>
                        <SelectItem value="title">Title</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Paper List */}
                <ScrollArea className="h-[600px]">
                  <div className="space-y-4">
                    {filteredPapers.map((paper, index) => {
                      const isSelected = selectedPaperIds.has(paper.canonical_id)
                      const pdfInfo = pdfStatus.get(paper.canonical_id)
                      
                      return (
                        <Card key={paper.canonical_id} className={`transition-colors ${
                          isSelected ? 'ring-2 ring-blue-500 bg-blue-50' : ''
                        }`}>
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={(checked) => 
                                  handlePaperSelection(paper.canonical_id, !!checked)
                                }
                                className="mt-1"
                              />
                              
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                  <h3 className="font-medium text-sm leading-5 line-clamp-2">
                                    {paper.title}
                                  </h3>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <Badge variant="outline" className="text-xs">
                                      {paper.source}
                                    </Badge>
                                    <Badge variant="secondary" className="text-xs">
                                      Rank #{index + 1}
                                    </Badge>
                                  </div>
                                </div>

                                <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                                  {paper.abstract}
                                </p>

                                <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-muted-foreground">
                                  <div className="flex items-center gap-1">
                                    <Users className="h-3 w-3" />
                                    {formatAuthors(paper.authors)}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <Calendar className="h-3 w-3" />
                                    {formatDate(paper.year)}
                                  </div>
                                  {paper.venue && (
                                    <div className="flex items-center gap-1">
                                      <BookOpen className="h-3 w-3" />
                                      {paper.venue}
                                    </div>
                                  )}
                                  <div className="flex items-center gap-1">
                                    <Globe className="h-3 w-3" />
                                    {paper.citationCount} citations
                                  </div>
                                </div>

                                <div className="flex items-center justify-between mt-3">
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="text-xs">
                                      Score: {paper.combinedScore.toFixed(2)}
                                    </Badge>
                                    {paper.doi && (
                                      <Badge variant="outline" className="text-xs">
                                        DOI: {paper.doi.slice(0, 20)}...
                                      </Badge>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-1">
                                    {paper.url && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        asChild
                                      >
                                        <a 
                                          href={paper.url} 
                                          target="_blank" 
                                          rel="noopener noreferrer"
                                          className="h-8 w-8 p-0"
                                        >
                                          <ExternalLink className="h-3 w-3" />
                                        </a>
                                      </Button>
                                    )}

                                    {/* PDF Status and Download */}
                                    {pdfInfo?.hasPdf ? (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        asChild
                                      >
                                        <a 
                                          href={pdfInfo.pdfUrl} 
                                          target="_blank" 
                                          rel="noopener noreferrer"
                                          className="h-8 w-8 p-0"
                                        >
                                          <FileText className="h-3 w-3 text-green-600" />
                                        </a>
                                      </Button>
                                    ) : pdfInfo?.canDownload ? (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => downloadPDF(paper)}
                                        disabled={pdfInfo.downloading}
                                        className="h-8 w-8 p-0"
                                      >
                                        {pdfInfo.downloading ? (
                                          <LoadingSpinner size="sm" className="h-3 w-3" />
                                        ) : (
                                          <Download className="h-3 w-3" />
                                        )}
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>

                                {pdfInfo?.error && (
                                  <div className="text-xs text-red-600 mt-2">
                                    PDF Error: {pdfInfo.error}
                                  </div>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                </ScrollArea>

                <div className="text-sm text-muted-foreground text-center">
                  Showing {filteredPapers.length} of {papers.length} papers
                  {selectedPaperIds.size > 0 && (
                    <span className="ml-2">• {selectedPaperIds.size} selected</span>
                  )}
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
} 