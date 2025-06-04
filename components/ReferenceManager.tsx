'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { 
  Search, 
  Download, 
  Edit, 
  Trash2, 
  BarChart3,
  FileText,
  Calendar,
  ExternalLink,
  AlertCircle,
  RefreshCw,
  Library,
  Eye
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import CitationEditor from './CitationEditor'

interface Citation {
  id: string
  project_id: string
  key: string
  csl_json: Record<string, any>
  created_at: string
  updated_at: string
  project_title?: string
  usage_count?: number
}

interface CitationUsage {
  project_id: string
  project_title: string
  section: string
  context: string
  created_at: string
}

interface ReferenceManagerProps {
  className?: string
  userId?: string
}

type SortField = 'title' | 'author' | 'year' | 'created_at' | 'usage_count'
type SortDirection = 'asc' | 'desc'

export default function ReferenceManager({ className, userId }: ReferenceManagerProps) {
  const [citations, setCitations] = useState<Citation[]>([])
  const [filteredCitations, setFilteredCitations] = useState<Citation[]>([])
  const [selectedCitations, setSelectedCitations] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Search and filtering
  const [searchQuery, setSearchQuery] = useState('')
  const [yearFilter, setYearFilter] = useState<string>('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [projectFilter, setProjectFilter] = useState<string>('')
  
  // Sorting
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  
  // UI State
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showUsageDialog, setShowUsageDialog] = useState(false)
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [citationUsage, setCitationUsage] = useState<CitationUsage[]>([])
  
  // Stats
  const [stats, setStats] = useState({
    total: 0,
    byType: {} as Record<string, number>,
    byYear: {} as Record<string, number>,
    duplicates: 0,
    mostCited: null as Citation | null
  })

  // Load citations
  const loadCitations = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      
      const supabase = createClient()
      
      // Get citations with project information and usage counts
      const { data: citationsData, error: citationsError } = await supabase
        .from('citations')
        .select(`
          *,
          project:research_projects(topic),
          usage_count:citation_links(count)
        `)
        .order('created_at', { ascending: false })

      if (citationsError) throw citationsError

      // Transform data
      const transformedCitations = (citationsData || []).map((item: any) => ({
        ...item,
        project_title: item.project?.topic,
        usage_count: item.usage_count[0]?.count || 0
      }))

      setCitations(transformedCitations)
      
      // Calculate stats
      calculateStats(transformedCitations)
      
    } catch (err) {
      console.error('Error loading citations:', err)
      setError(err instanceof Error ? err.message : 'Failed to load citations')
    } finally {
      setLoading(false)
    }
  }, [])

  // Calculate statistics
  const calculateStats = (citationList: Citation[]) => {
    const byType: Record<string, number> = {}
    const byYear: Record<string, number> = {}
    let duplicates = 0
    let mostCited: Citation | null = null

    const titleSet = new Set<string>()
    
    citationList.forEach(citation => {
      const csl = citation.csl_json
      
      // Count by type
      const type = csl.type || 'unknown'
      byType[type] = (byType[type] || 0) + 1
      
      // Count by year
      const year = csl.issued?.['date-parts']?.[0]?.[0] || 'unknown'
      byYear[year] = (byYear[year] || 0) + 1
      
      // Check for duplicates by title
      const title = csl.title?.toLowerCase().trim()
      if (title && titleSet.has(title)) {
        duplicates++
      } else if (title) {
        titleSet.add(title)
      }
      
      // Track most cited
      if (!mostCited || (citation.usage_count || 0) > (mostCited.usage_count || 0)) {
        mostCited = citation
      }
    })

    setStats({
      total: citationList.length,
      byType,
      byYear,
      duplicates,
      mostCited
    })
  }

  // Load citation usage
  const loadCitationUsage = async (citationId: string) => {
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('citation_links')
        .select(`
          *,
          project:research_projects(topic)
        `)
        .eq('citation_id', citationId)
        .order('created_at', { ascending: false })

      if (error) throw error

      const usage = (data || []).map((item: any) => ({
        project_id: item.project_id,
        project_title: item.project?.topic || 'Unknown Project',
        section: item.section,
        context: item.context || '',
        created_at: item.created_at
      }))

      setCitationUsage(usage)
    } catch (err) {
      console.error('Error loading citation usage:', err)
    }
  }

  // Filter and sort citations
  useEffect(() => {
    let filtered = [...citations]

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(citation => {
        const csl = citation.csl_json
        return (
          csl.title?.toLowerCase().includes(query) ||
          csl.author?.some((author: any) => 
            author.family?.toLowerCase().includes(query) ||
            author.given?.toLowerCase().includes(query)
          ) ||
          csl.journal?.toLowerCase().includes(query) ||
          csl.DOI?.toLowerCase().includes(query)
        )
      })
    }

    // Apply year filter
    if (yearFilter && yearFilter !== 'all') {
      filtered = filtered.filter(citation => {
        const year = citation.csl_json.issued?.['date-parts']?.[0]?.[0]
        return year?.toString() === yearFilter
      })
    }

    // Apply type filter
    if (typeFilter && typeFilter !== 'all') {
      filtered = filtered.filter(citation => {
        return citation.csl_json.type === typeFilter
      })
    }

    // Apply project filter
    if (projectFilter && projectFilter !== 'all') {
      filtered = filtered.filter(citation => {
        return citation.project_id === projectFilter
      })
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let aValue: any, bValue: any

      switch (sortField) {
        case 'title':
          aValue = a.csl_json.title || ''
          bValue = b.csl_json.title || ''
          break
        case 'author':
          aValue = a.csl_json.author?.[0]?.family || ''
          bValue = b.csl_json.author?.[0]?.family || ''
          break
        case 'year':
          aValue = a.csl_json.issued?.['date-parts']?.[0]?.[0] || 0
          bValue = b.csl_json.issued?.['date-parts']?.[0]?.[0] || 0
          break
        case 'usage_count':
          aValue = a.usage_count || 0
          bValue = b.usage_count || 0
          break
        case 'created_at':
        default:
          aValue = new Date(a.created_at)
          bValue = new Date(b.created_at)
          break
      }

      if (sortDirection === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0
      }
    })

    setFilteredCitations(filtered)
  }, [citations, searchQuery, yearFilter, typeFilter, projectFilter, sortField, sortDirection])

  // Get unique values for filters
  const filterOptions = useMemo(() => {
    const years = new Set<string>()
    const types = new Set<string>()
    const projects = new Set<{ id: string, title: string }>()

    citations.forEach(citation => {
      const year = citation.csl_json.issued?.['date-parts']?.[0]?.[0]
      if (year) years.add(year.toString())
      
      const type = citation.csl_json.type
      if (type) types.add(type)
      
      if (citation.project_id && citation.project_title) {
        projects.add({ id: citation.project_id, title: citation.project_title })
      }
    })

    return {
      years: Array.from(years).sort().reverse(),
      types: Array.from(types).sort(),
      projects: Array.from(projects)
    }
  }, [citations])

  // Export citations
  const exportCitations = async (format: 'bibtex' | 'ris' | 'json') => {
    const citationsToExport = selectedCitations.size > 0 
      ? filteredCitations.filter(c => selectedCitations.has(c.id))
      : filteredCitations

    try {
      // Use citation-js to format
      const { Cite } = await import('citation-js')
      const cslData = citationsToExport.map(c => c.csl_json)
      const cite = new Cite(cslData)

      let output: string
      let filename: string
      let mimeType: string

      switch (format) {
        case 'bibtex':
          output = cite.format('bibliography', { format: 'text', template: 'bibtex' })
          filename = 'references.bib'
          mimeType = 'application/x-bibtex'
          break
        case 'ris':
          output = cite.format('bibliography', { format: 'text', template: 'ris' })
          filename = 'references.ris'
          mimeType = 'application/x-research-info-systems'
          break
        case 'json':
          output = JSON.stringify(cslData, null, 2)
          filename = 'references.json'
          mimeType = 'application/json'
          break
      }

      // Download file
      const blob = new Blob([output], { type: mimeType })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

    } catch (error) {
      console.error('Export failed:', error)
      setError('Failed to export citations')
    }
  }

  // Delete citations
  const deleteCitations = async (citationIds: string[]) => {
    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('citations')
        .delete()
        .in('id', citationIds)

      if (error) throw error

      // Update local state
      setCitations(prev => prev.filter(c => !citationIds.includes(c.id)))
      setSelectedCitations(new Set())
      
    } catch (error) {
      console.error('Delete failed:', error)
      setError('Failed to delete citations')
    }
  }

  // Bulk selection
  const toggleCitationSelection = (citationId: string) => {
    setSelectedCitations(prev => {
      const newSet = new Set(prev)
      if (newSet.has(citationId)) {
        newSet.delete(citationId)
      } else {
        newSet.add(citationId)
      }
      return newSet
    })
  }

  const selectAllVisible = () => {
    setSelectedCitations(new Set(filteredCitations.map(c => c.id)))
  }

  const clearSelection = () => {
    setSelectedCitations(new Set())
  }

  // Load data on mount
  useEffect(() => {
    loadCitations()
  }, [loadCitations])

  if (loading) {
    return (
      <div className={`flex items-center justify-center min-h-[400px] ${className}`}>
        <div className="text-center space-y-2">
          <Library className="h-8 w-8 animate-pulse mx-auto text-muted-foreground" />
          <p className="text-muted-foreground">Loading reference library...</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reference Manager</h1>
          <p className="text-muted-foreground">
            Manage your citation library across all projects
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAnalytics(!showAnalytics)}
          >
            <BarChart3 className="h-4 w-4 mr-2" />
            Analytics
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={loadCitations}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Analytics Panel */}
      {showAnalytics && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Citation Analytics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold">{stats.total}</div>
                <div className="text-sm text-muted-foreground">Total Citations</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">{Object.keys(stats.byType).length}</div>
                <div className="text-sm text-muted-foreground">Source Types</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">{stats.duplicates}</div>
                <div className="text-sm text-muted-foreground">Potential Duplicates</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">
                  {stats.mostCited?.usage_count || 0}
                </div>
                <div className="text-sm text-muted-foreground">Most Citations</div>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* By Type */}
              <div>
                <h4 className="font-medium mb-2">By Source Type</h4>
                <div className="space-y-1">
                  {Object.entries(stats.byType).map(([type, count]) => (
                    <div key={type} className="flex justify-between text-sm">
                      <span className="capitalize">{type}</span>
                      <span>{count}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* By Year */}
              <div>
                <h4 className="font-medium mb-2">By Publication Year</h4>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {Object.entries(stats.byYear)
                    .sort(([a], [b]) => b.localeCompare(a))
                    .slice(0, 10)
                    .map(([year, count]) => (
                    <div key={year} className="flex justify-between text-sm">
                      <span>{year}</span>
                      <span>{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search and Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4 items-center">
            {/* Search */}
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search citations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Filters */}
            <Select value={yearFilter} onValueChange={setYearFilter}>
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {filterOptions.years.map(year => (
                  <SelectItem key={year} value={year}>{year}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {filterOptions.types.map(type => (
                  <SelectItem key={type} value={type}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {filterOptions.projects.map(project => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Sort */}
            <Select 
              value={`${sortField}-${sortDirection}`} 
              onValueChange={(value) => {
                const [field, direction] = value.split('-')
                setSortField(field as SortField)
                setSortDirection(direction as SortDirection)
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="created_at-desc">Newest First</SelectItem>
                <SelectItem value="created_at-asc">Oldest First</SelectItem>
                <SelectItem value="title-asc">Title A-Z</SelectItem>
                <SelectItem value="title-desc">Title Z-A</SelectItem>
                <SelectItem value="author-asc">Author A-Z</SelectItem>
                <SelectItem value="author-desc">Author Z-A</SelectItem>
                <SelectItem value="year-desc">Year (Newest)</SelectItem>
                <SelectItem value="year-asc">Year (Oldest)</SelectItem>
                <SelectItem value="usage_count-desc">Most Used</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Actions */}
      {(selectedCitations.size > 0 || filteredCitations.length > 0) && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="text-sm text-muted-foreground">
                  {selectedCitations.size > 0 
                    ? `${selectedCitations.size} selected`
                    : `${filteredCitations.length} total`
                  }
                </div>
                
                {filteredCitations.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={selectAllVisible}
                      disabled={selectedCitations.size === filteredCitations.length}
                    >
                      Select All
                    </Button>
                    {selectedCitations.size > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={clearSelection}
                      >
                        Clear Selection
                      </Button>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportCitations('bibtex')}
                  disabled={filteredCitations.length === 0}
                >
                  <Download className="h-4 w-4 mr-2" />
                  BibTeX
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportCitations('ris')}
                  disabled={filteredCitations.length === 0}
                >
                  <Download className="h-4 w-4 mr-2" />
                  RIS
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportCitations('json')}
                  disabled={filteredCitations.length === 0}
                >
                  <Download className="h-4 w-4 mr-2" />
                  JSON
                </Button>
                
                {selectedCitations.size > 0 && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => deleteCitations(Array.from(selectedCitations))}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete ({selectedCitations.size})
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Citations List */}
      <div className="space-y-4">
        {filteredCitations.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center">
              <Library className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="font-medium">No citations found</p>
              <p className="text-sm text-muted-foreground">
                {searchQuery || yearFilter || typeFilter || projectFilter
                  ? 'Try adjusting your filters'
                  : 'Your citation library is empty'
                }
              </p>
            </CardContent>
          </Card>
        ) : (
          filteredCitations.map(citation => (
            <CitationCard
              key={citation.id}
              citation={citation}
              isSelected={selectedCitations.has(citation.id)}
              onToggleSelection={() => toggleCitationSelection(citation.id)}
              onViewUsage={() => {
                setSelectedCitation(citation)
                loadCitationUsage(citation.id)
                setShowUsageDialog(true)
              }}
              onEdit={() => {
                setSelectedCitation(citation)
                setShowEditDialog(true)
              }}
            />
          ))
        )}
      </div>

      {/* Usage Dialog */}
      <Dialog open={showUsageDialog} onOpenChange={setShowUsageDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Citation Usage</DialogTitle>
            <DialogDescription>
              Where this citation is used across your projects
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {selectedCitation && (
              <div className="p-4 bg-muted rounded-lg">
                <h4 className="font-medium">{selectedCitation.csl_json.title}</h4>
                <p className="text-sm text-muted-foreground">
                  {selectedCitation.csl_json.author?.map((a: any) => a.family).join(', ')}
                </p>
              </div>
            )}
            
            <ScrollArea className="h-[300px]">
              <div className="space-y-3">
                {citationUsage.map((usage, index) => (
                  <div key={index} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <h5 className="font-medium text-sm">{usage.project_title}</h5>
                      <Badge variant="secondary">{usage.section}</Badge>
                    </div>
                    {usage.context && (
                      <p className="text-xs text-muted-foreground mb-2">
                        "{usage.context}"
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Added {format(new Date(usage.created_at), 'PPP')}
                    </p>
                  </div>
                ))}
                
                {citationUsage.length === 0 && (
                  <p className="text-center text-muted-foreground py-4">
                    This citation hasn't been used in any projects yet
                  </p>
                )}
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>

      {/* Citation Editor Dialog */}
      <CitationEditor
        citation={selectedCitation}
        isOpen={showEditDialog}
        onClose={() => {
          setShowEditDialog(false)
          setSelectedCitation(null)
        }}
        onSave={(updatedCitation) => {
          // Update local state
          setCitations(prev => prev.map(c => 
            c.id === updatedCitation.id ? updatedCitation : c
          ))
          setShowEditDialog(false)
          setSelectedCitation(null)
        }}
      />
    </div>
  )
}

// Citation Card Component
interface CitationCardProps {
  citation: Citation
  isSelected: boolean
  onToggleSelection: () => void
  onViewUsage: () => void
  onEdit: () => void
}

function CitationCard({ citation, isSelected, onToggleSelection, onViewUsage, onEdit }: CitationCardProps) {
  const csl = citation.csl_json

  return (
    <Card className={`transition-all ${isSelected ? 'ring-2 ring-blue-500' : ''}`}>
      <CardContent className="pt-4">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelection}
            className="mt-1"
          />
          
          <div className="flex-1 space-y-2">
            <div className="flex items-start justify-between">
              <h3 className="font-medium leading-tight">
                {csl.title || 'Untitled'}
              </h3>
              <div className="flex items-center gap-1 ml-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onViewUsage}
                  className="h-8 w-8 p-0"
                >
                  <Eye className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onEdit}
                  className="h-8 w-8 p-0"
                >
                  <Edit className="h-4 w-4" />
                </Button>
              </div>
            </div>
            
            <div className="text-sm text-muted-foreground">
              {csl.author?.map((author: any) => 
                `${author.given || ''} ${author.family || ''}`.trim()
              ).join(', ') || 'Unknown authors'}
            </div>
            
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              {csl.issued?.['date-parts']?.[0]?.[0] && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {csl.issued['date-parts'][0][0]}
                </span>
              )}
              
              {csl.type && (
                <Badge variant="secondary" className="text-xs">
                  {csl.type}
                </Badge>
              )}
              
              {(citation.usage_count || 0) > 0 && (
                <span className="flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  Used {citation.usage_count} time{citation.usage_count !== 1 ? 's' : ''}
                </span>
              )}
              
              {citation.project_title && (
                <span className="flex items-center gap-1">
                  <Library className="h-3 w-3" />
                  {citation.project_title}
                </span>
              )}
            </div>
            
            {csl.journal && (
              <p className="text-sm italic">{csl.journal}</p>
            )}
            
            {csl.DOI && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">DOI:</span>
                <a
                  href={`https://doi.org/${csl.DOI}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                >
                  {csl.DOI}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
} 