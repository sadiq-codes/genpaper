'use client'

import { useState, useCallback, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Trash2, Loader2, GripVertical } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

// CSL Types
interface CSLAuthor {
  family: string
  given: string
  literal?: string
}

interface CSLItem {
  id?: string
  type: string
  title: string
  author: CSLAuthor[]
  'container-title'?: string
  issued?: {
    'date-parts': number[][]
  }
  DOI?: string
  URL?: string
  volume?: string
  issue?: string
  page?: string
  publisher?: string
}

// Extended CSL data type that includes common lowercase variants
type CSLData = CSLItem & { doi?: string; url?: string }

const PUBLICATION_TYPES = [
  { value: 'article-journal', label: 'Journal Article' },
  { value: 'article', label: 'Article' },
  { value: 'book', label: 'Book' },
  { value: 'chapter', label: 'Book Chapter' },
  { value: 'paper-conference', label: 'Conference Paper' },
  { value: 'thesis', label: 'Thesis' },
  { value: 'report', label: 'Report' },
  { value: 'webpage', label: 'Webpage' },
  { value: 'manuscript', label: 'Manuscript' },
]

interface CitationEditModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  paperId: string
  projectId: string
  initialData?: CSLItem | null
  onSave: (cslJson: CSLItem) => Promise<void>
}

// API function
async function fetchCitationData(paperId: string, projectId: string): Promise<CSLData | null> {
  const res = await fetch(`/api/citations/${paperId}?projectId=${projectId}`)
  if (!res.ok) {
    if (res.status === 404) return null
    throw new Error('Failed to fetch citation data')
  }
  const data = await res.json()
  return data.data?.csl_json || null
}

export function CitationEditModal({
  open,
  onOpenChange,
  paperId,
  projectId,
  initialData,
  onSave,
}: CitationEditModalProps) {
  // Form state
  const [title, setTitle] = useState('')
  const [authors, setAuthors] = useState<CSLAuthor[]>([{ family: '', given: '' }])
  const [year, setYear] = useState<string>('')
  const [journal, setJournal] = useState('')
  const [doi, setDoi] = useState('')
  const [url, setUrl] = useState('')
  const [volume, setVolume] = useState('')
  const [issue, setIssue] = useState('')
  const [pages, setPages] = useState('')
  const [publisher, setPublisher] = useState('')
  const [pubType, setPubType] = useState('article-journal')

  // Fetch citation data with React Query
  const { data: citationData, isLoading: isFetching } = useQuery({
    queryKey: ['citation', paperId, projectId],
    queryFn: () => fetchCitationData(paperId, projectId),
    enabled: open && !initialData && !!paperId && !!projectId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: onSave,
    onSuccess: () => {
      toast.success('Citation updated successfully')
      onOpenChange(false)
    },
    onError: (err) => {
      console.error('Failed to save citation:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to save citation')
    },
  })

  // Populate form from CSL data
  const populateForm = useCallback((csl: CSLData) => {
    setTitle(csl.title || '')
    setAuthors(
      csl.author?.length > 0 
        ? csl.author.map((a: CSLAuthor) => ({ family: a.family || '', given: a.given || '' }))
        : [{ family: '', given: '' }]
    )
    const yearValue = csl.issued?.['date-parts']?.[0]?.[0]
    setYear(yearValue ? String(yearValue) : '')
    setJournal(csl['container-title'] || '')
    // Handle both uppercase DOI (CSL standard) and lowercase doi (common variation)
    setDoi(csl.DOI || csl.doi || '')
    setUrl(csl.URL || csl.url || '')
    setVolume(csl.volume || '')
    setIssue(csl.issue || '')
    setPages(csl.page || '')
    setPublisher(csl.publisher || '')
    setPubType(csl.type || 'article-journal')
  }, [])

  // Load data when modal opens or data changes
  useEffect(() => {
    if (!open) return

    if (initialData) {
      populateForm(initialData)
    } else if (citationData) {
      populateForm(citationData)
    }
  }, [open, initialData, citationData, populateForm])

  // Author management
  const addAuthor = useCallback(() => {
    setAuthors(prev => [...prev, { family: '', given: '' }])
  }, [])

  const removeAuthor = useCallback((index: number) => {
    setAuthors(prev => {
      if (prev.length <= 1) return prev
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  const updateAuthor = useCallback((index: number, field: 'family' | 'given', value: string) => {
    setAuthors(prev => prev.map((author, i) => 
      i === index ? { ...author, [field]: value } : author
    ))
  }, [])

  // Form validation
  const validateForm = (): string | null => {
    if (!title.trim()) {
      return 'Title is required'
    }
    const validAuthors = authors.filter(a => a.family.trim())
    if (validAuthors.length === 0) {
      return 'At least one author with a family name is required'
    }
    if (year && (isNaN(Number(year)) || Number(year) < 1000 || Number(year) > 2100)) {
      return 'Please enter a valid year (1000-2100)'
    }
    return null
  }

  // Handle save
  const handleSave = async () => {
    const error = validateForm()
    if (error) {
      toast.error(error)
      return
    }

    // Build CSL JSON
    const cslJson: CSLItem = {
      id: paperId,
      type: pubType,
      title: title.trim(),
      author: authors
        .filter(a => a.family.trim())
        .map(a => ({
          family: a.family.trim(),
          given: a.given.trim(),
        })),
    }

    // Add optional fields if present
    if (journal.trim()) {
      cslJson['container-title'] = journal.trim()
    }
    if (year) {
      cslJson.issued = { 'date-parts': [[Number(year)]] }
    }
    if (doi.trim()) {
      cslJson.DOI = doi.trim()
    }
    if (url.trim()) {
      cslJson.URL = url.trim()
    }
    if (volume.trim()) {
      cslJson.volume = volume.trim()
    }
    if (issue.trim()) {
      cslJson.issue = issue.trim()
    }
    if (pages.trim()) {
      cslJson.page = pages.trim()
    }
    if (publisher.trim()) {
      cslJson.publisher = publisher.trim()
    }

    saveMutation.mutate(cslJson)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Citation Metadata</DialogTitle>
          <DialogDescription>
            Update the citation information for this reference. Changes only affect this project.
          </DialogDescription>
        </DialogHeader>

        {isFetching ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span className="text-muted-foreground">Loading citation data...</span>
          </div>
        ) : (
          <div className="space-y-6 py-4">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter the paper title"
              />
            </div>

            {/* Publication Type */}
            <div className="space-y-2">
              <Label htmlFor="type">Publication Type</Label>
              <Select value={pubType} onValueChange={setPubType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PUBLICATION_TYPES.map(type => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Authors */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Authors *</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addAuthor}
                  className="h-7 text-xs"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Author
                </Button>
              </div>
              <div className="space-y-2">
                {authors.map((author, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <GripVertical className="h-4 w-4 text-muted-foreground/50 cursor-grab" />
                    <Input
                      placeholder="Family name"
                      value={author.family}
                      onChange={(e) => updateAuthor(index, 'family', e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      placeholder="Given name(s)"
                      value={author.given}
                      onChange={(e) => updateAuthor(index, 'given', e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeAuthor(index)}
                      disabled={authors.length <= 1}
                      className={cn(
                        "h-8 w-8 shrink-0",
                        authors.length <= 1 && "opacity-30"
                      )}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Enter family name (surname) and given name(s) separately for proper formatting.
              </p>
            </div>

            {/* Year and Journal in a row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="year">Year</Label>
                <Input
                  id="year"
                  type="number"
                  min="1000"
                  max="2100"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="e.g., 2024"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="journal">Journal / Venue</Label>
                <Input
                  id="journal"
                  value={journal}
                  onChange={(e) => setJournal(e.target.value)}
                  placeholder="e.g., Nature, ICML 2024"
                />
              </div>
            </div>

            {/* Volume, Issue, Pages in a row */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="volume">Volume</Label>
                <Input
                  id="volume"
                  value={volume}
                  onChange={(e) => setVolume(e.target.value)}
                  placeholder="e.g., 42"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="issue">Issue</Label>
                <Input
                  id="issue"
                  value={issue}
                  onChange={(e) => setIssue(e.target.value)}
                  placeholder="e.g., 3"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pages">Pages</Label>
                <Input
                  id="pages"
                  value={pages}
                  onChange={(e) => setPages(e.target.value)}
                  placeholder="e.g., 123-145"
                />
              </div>
            </div>

            {/* DOI and URL */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="doi">DOI</Label>
                <Input
                  id="doi"
                  value={doi}
                  onChange={(e) => setDoi(e.target.value)}
                  placeholder="e.g., 10.1234/example"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="url">URL</Label>
                <Input
                  id="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://..."
                />
              </div>
            </div>

            {/* Publisher (for books) */}
            {(pubType === 'book' || pubType === 'chapter' || pubType === 'thesis' || pubType === 'report') && (
              <div className="space-y-2">
                <Label htmlFor="publisher">Publisher</Label>
                <Input
                  id="publisher"
                  value={publisher}
                  onChange={(e) => setPublisher(e.target.value)}
                  placeholder="e.g., Oxford University Press"
                />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saveMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending || isFetching}>
            {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
