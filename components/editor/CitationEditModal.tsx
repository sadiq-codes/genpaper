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

  // Track if form has been populated with initial data
  const [hasPopulatedInitial, setHasPopulatedInitial] = useState(false)
  
  // Fetch citation data with React Query (for additional fields like volume, issue, pages)
  // Fetch even if initialData exists to get full CSL JSON with extra fields
  const { data: citationData, isLoading: isFetching } = useQuery({
    queryKey: ['citation', paperId, projectId],
    queryFn: () => fetchCitationData(paperId, projectId),
    enabled: open && !!paperId && !!projectId,
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

  // Reset populated flag when modal closes
  useEffect(() => {
    if (!open) {
      setHasPopulatedInitial(false)
    }
  }, [open])

  // Load initial data immediately when modal opens (instant form display)
  useEffect(() => {
    if (!open || hasPopulatedInitial) return

    if (initialData) {
      populateForm(initialData)
      setHasPopulatedInitial(true)
    }
  }, [open, initialData, hasPopulatedInitial, populateForm])

  // Merge additional CSL fields when they load (without overwriting existing values)
  useEffect(() => {
    if (!open || !citationData) return

    // If no initial data was provided, populate entire form from CSL
    if (!initialData) {
      populateForm(citationData)
      setHasPopulatedInitial(true)
      return
    }

    // If we had initial data, only merge in fields that are empty in the form
    // This adds volume, issue, pages, etc. from CSL without overwriting user input
    if (hasPopulatedInitial) {
      // Only update empty fields with CSL data
      if (!volume && citationData.volume) setVolume(citationData.volume)
      if (!issue && citationData.issue) setIssue(citationData.issue)
      if (!pages && citationData.page) setPages(citationData.page)
      if (!publisher && citationData.publisher) setPublisher(citationData.publisher)
      if (!url && (citationData.URL || citationData.url)) setUrl(citationData.URL || citationData.url || '')
      // Don't overwrite DOI, title, authors, year, journal as those came from initialData
    }
  }, [open, citationData, initialData, hasPopulatedInitial, populateForm, volume, issue, pages, publisher, url])

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
      <DialogContent 
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="font-instrument text-lg tracking-tight">Edit Citation Metadata</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Update the citation information for this reference. Changes only affect this project.
          </DialogDescription>
        </DialogHeader>

        {/* Only show loading if we have no initial data AND we're fetching */}
        {isFetching && !initialData && !hasPopulatedInitial ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin mr-2 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Loading citation data...</span>
          </div>
        ) : (
          <div className="space-y-5 py-4">
            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="title" className="text-xs">Title *</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter the paper title"
              />
            </div>

            {/* Publication Type */}
            <div className="space-y-1.5">
              <Label htmlFor="pub-type" className="text-xs">Publication Type</Label>
              <Select value={pubType} onValueChange={setPubType}>
                <SelectTrigger id="pub-type">
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
            <fieldset className="space-y-2">
              <div className="flex items-center justify-between">
                <legend className="text-xs font-medium">Authors *</legend>
                <button
                  type="button"
                  onClick={addAuthor}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-border/40 text-[11px] text-muted-foreground hover:text-foreground hover:border-border/60 transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  Add Author
                </button>
              </div>
              <div className="space-y-2">
                {authors.map((author, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <GripVertical className="h-3.5 w-3.5 text-muted-foreground cursor-grab shrink-0" />
                    <Input
                      id={`author-family-${index}`}
                      name={`author-family-${index}`}
                      placeholder="Family name"
                      aria-label={`Author ${index + 1} family name`}
                      value={author.family}
                      onChange={(e) => updateAuthor(index, 'family', e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      id={`author-given-${index}`}
                      name={`author-given-${index}`}
                      placeholder="Given name(s)"
                      aria-label={`Author ${index + 1} given name`}
                      value={author.given}
                      onChange={(e) => updateAuthor(index, 'given', e.target.value)}
                      className="flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => removeAuthor(index)}
                      disabled={authors.length <= 1}
                      aria-label={`Remove author ${index + 1}`}
                      className={cn(
                        "h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0",
                        authors.length <= 1 && "opacity-30 pointer-events-none"
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Enter family name (surname) and given name(s) separately for proper formatting.
              </p>
            </fieldset>

            {/* Year and Journal in a row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="year" className="text-xs">Year</Label>
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
              <div className="space-y-1.5">
                <Label htmlFor="journal" className="text-xs">Journal / Venue</Label>
                <Input
                  id="journal"
                  value={journal}
                  onChange={(e) => setJournal(e.target.value)}
                  placeholder="e.g., Nature, ICML 2024"
                />
              </div>
            </div>

            {/* Volume, Issue, Pages in a row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="volume" className="text-xs">Volume</Label>
                <Input
                  id="volume"
                  value={volume}
                  onChange={(e) => setVolume(e.target.value)}
                  placeholder="e.g., 42"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="issue" className="text-xs">Issue</Label>
                <Input
                  id="issue"
                  value={issue}
                  onChange={(e) => setIssue(e.target.value)}
                  placeholder="e.g., 3"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pages" className="text-xs">Pages</Label>
                <Input
                  id="pages"
                  value={pages}
                  onChange={(e) => setPages(e.target.value)}
                  placeholder="e.g., 123-145"
                />
              </div>
            </div>

            {/* DOI and URL */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="doi" className="text-xs">DOI</Label>
                <Input
                  id="doi"
                  value={doi}
                  onChange={(e) => setDoi(e.target.value)}
                  placeholder="e.g., 10.1234/example"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="url" className="text-xs">URL</Label>
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
              <div className="space-y-1.5">
                <Label htmlFor="publisher" className="text-xs">Publisher</Label>
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

        <DialogFooter className="gap-2">
          <button
            onClick={() => onOpenChange(false)}
            disabled={saveMutation.isPending}
            className="h-9 px-4 rounded-full border border-border/40 text-xs text-muted-foreground hover:text-foreground hover:border-border/60 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending || isFetching}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-foreground/80 text-background text-xs font-medium hover:bg-foreground transition-colors disabled:opacity-50"
          >
            {saveMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save Changes
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
