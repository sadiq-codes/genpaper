'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  Users,
  ExternalLink,
  Download,
  FileText,
  Eye,
  Trash2,
  Plus,
  Loader2,
  CheckCircle,
  AlertCircle,
  Clock,
  Quote,
  FolderOpen,
  Upload,
  Search,
  Save,
  Link as LinkIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface Paper {
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
  created_at: string
  owner_id: string | null
  metadata: Record<string, unknown> | null
}

interface LibraryEntry {
  id: string
  notes: string | null
  added_at: string
}

interface ProjectCitation {
  id: string
  reason: string | null
  created_at: string
  research_projects: {
    id: string
    topic: string
    created_at: string
  } | null
}

interface PaperDetailContentProps {
  paper: Paper
  libraryEntry: LibraryEntry | null
  projectCitations: ProjectCitation[]
  chunkCount: number
  userId: string
}

// Format authors for display
function formatAuthors(authors: string[]): string {
  if (!authors || authors.length === 0) return 'Unknown authors'
  return authors.join(', ')
}

// Format date
function formatDate(dateString: string | null): string {
  if (!dateString) return 'Unknown date'
  try {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return 'Unknown date'
  }
}

// Get year from date
function getYear(dateString: string | null): string {
  if (!dateString) return ''
  try {
    return new Date(dateString).getFullYear().toString()
  } catch {
    return ''
  }
}

// Processing status badge
function ProcessingStatusBadge({ status, chunkCount }: { status: string | null; chunkCount: number }) {
  if (status === 'processed' && chunkCount > 0) {
    return (
      <Badge variant="default" className="bg-green-500/10 text-green-600 border-green-500/20">
        <CheckCircle className="h-3 w-3 mr-1" />
        Processed ({chunkCount} chunks)
      </Badge>
    )
  }
  if (status === 'processing') {
    return (
      <Badge variant="secondary">
        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
        Processing
      </Badge>
    )
  }
  if (status === 'failed') {
    return (
      <Badge variant="destructive">
        <AlertCircle className="h-3 w-3 mr-1" />
        Failed
      </Badge>
    )
  }
  if (status === 'pending') {
    return (
      <Badge variant="secondary">
        <Clock className="h-3 w-3 mr-1" />
        Pending
      </Badge>
    )
  }
  return null
}

// Source badge - standardized labels: "Uploaded" and "From Search"
function SourceBadge({ source, ownerId }: { source: string | null; ownerId: string | null }) {
  if (source === 'upload' || ownerId) {
    return (
      <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20">
        <Upload className="h-3 w-3 mr-1" />
        Uploaded
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
      <Search className="h-3 w-3 mr-1" />
      From Search
    </Badge>
  )
}

// API functions
async function updateNotes(paperId: string, notes: string): Promise<void> {
  const response = await fetch(`/api/library/notes`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paperId, notes }),
  })
  if (!response.ok) throw new Error('Failed to update notes')
}

async function removeFromLibrary(paperId: string): Promise<void> {
  const response = await fetch(`/api/library?paperId=${paperId}`, {
    method: 'DELETE',
  })
  if (!response.ok) throw new Error('Failed to remove from library')
}

async function addToLibrary(paperId: string): Promise<void> {
  const response = await fetch('/api/library', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paperId }),
  })
  if (!response.ok) throw new Error('Failed to add to library')
}

async function getSignedPdfUrl(paperId: string): Promise<string> {
  const response = await fetch(`/api/papers/${paperId}/pdf-url`)
  if (!response.ok) throw new Error('Failed to get PDF URL')
  const data = await response.json()
  return data.url
}

export function PaperDetailContent({
  paper,
  libraryEntry,
  projectCitations,
  chunkCount,
  userId,
}: PaperDetailContentProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  
  const [notes, setNotes] = useState(libraryEntry?.notes || '')
  const [isNotesEdited, setIsNotesEdited] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isLoadingPdf, setIsLoadingPdf] = useState(false)

  // Mutations
  const saveNotesMutation = useMutation({
    mutationFn: () => updateNotes(paper.id, notes),
    onSuccess: () => {
      toast.success('Notes saved')
      setIsNotesEdited(false)
      queryClient.invalidateQueries({ queryKey: ['library'] })
    },
    onError: () => toast.error('Failed to save notes'),
  })

  const removeMutation = useMutation({
    mutationFn: () => removeFromLibrary(paper.id),
    onSuccess: () => {
      toast.success('Paper removed from library')
      queryClient.invalidateQueries({ queryKey: ['library'] })
      router.push('/library')
    },
    onError: () => toast.error('Failed to remove paper'),
  })

  const addMutation = useMutation({
    mutationFn: () => addToLibrary(paper.id),
    onSuccess: () => {
      toast.success('Paper added to library')
      queryClient.invalidateQueries({ queryKey: ['library'] })
      router.refresh()
    },
    onError: () => toast.error('Failed to add paper'),
  })

  // Handle PDF view/download
  const handleViewPdf = async () => {
    if (!paper.pdf_url) {
      toast.error('No PDF available')
      return
    }

    setIsLoadingPdf(true)
    try {
      const signedUrl = await getSignedPdfUrl(paper.id)
      const newWindow = window.open(signedUrl, '_blank')
      
      // Check if popup was blocked
      if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
        toast.error('Popup blocked. Please allow popups for this site.')
      }
    } catch (error) {
      // Fallback to direct URL
      console.warn('Failed to get signed URL, falling back to direct URL:', error)
      toast.info('Opening PDF directly...')
      const newWindow = window.open(paper.pdf_url, '_blank')
      
      if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
        toast.error('Popup blocked. Please allow popups for this site.')
      }
    } finally {
      setIsLoadingPdf(false)
    }
  }

  const handleDownloadPdf = async () => {
    if (!paper.pdf_url) {
      toast.error('No PDF available')
      return
    }

    setIsLoadingPdf(true)
    try {
      const signedUrl = await getSignedPdfUrl(paper.id)
      const link = document.createElement('a')
      link.href = signedUrl
      link.download = `${paper.title.slice(0, 50)}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      toast.success('Download started')
    } catch (error) {
      console.warn('Failed to download PDF:', error)
      // Try fallback download
      try {
        const link = document.createElement('a')
        link.href = paper.pdf_url
        link.download = `${paper.title.slice(0, 50)}.pdf`
        link.target = '_blank'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        toast.info('Opening PDF in new tab for download...')
      } catch {
        toast.error('Failed to download PDF. Try right-clicking "View PDF" and selecting "Save As".')
      }
    } finally {
      setIsLoadingPdf(false)
    }
  }

  const isInLibrary = !!libraryEntry
  const isOwnUpload = paper.owner_id === userId
  const hasPdf = !!paper.pdf_url

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2">
        <ArrowLeft className="h-4 w-4" />
        Back to Library
      </Button>

      {/* Main Paper Info */}
      <div className="space-y-4">
        {/* Title */}
        <h1 className="text-2xl font-bold leading-tight">{paper.title}</h1>

        {/* Authors */}
        <div className="flex items-start gap-2 text-muted-foreground">
          <Users className="h-4 w-4 mt-1 flex-shrink-0" />
          <p className="text-sm">{formatAuthors(paper.authors)}</p>
        </div>

        {/* Meta badges */}
        <div className="flex flex-wrap items-center gap-2">
          <SourceBadge source={paper.source} ownerId={paper.owner_id} />
          <ProcessingStatusBadge status={paper.processing_status} chunkCount={chunkCount} />
          
          {paper.venue && (
            <Badge variant="secondary">
              <BookOpen className="h-3 w-3 mr-1" />
              {paper.venue}
            </Badge>
          )}
          
          {paper.publication_date && (
            <Badge variant="outline">
              <Calendar className="h-3 w-3 mr-1" />
              {getYear(paper.publication_date)}
            </Badge>
          )}
          
          {paper.citation_count !== null && paper.citation_count > 0 && (
            <Badge variant="outline">
              <Quote className="h-3 w-3 mr-1" />
              {paper.citation_count.toLocaleString()} citations
            </Badge>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2">
          {hasPdf && (
            <>
              <Button onClick={handleViewPdf} disabled={isLoadingPdf}>
                {isLoadingPdf ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Eye className="h-4 w-4 mr-2" />
                )}
                View PDF
              </Button>
              <Button variant="outline" onClick={handleDownloadPdf} disabled={isLoadingPdf}>
                {isLoadingPdf ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Download
              </Button>
            </>
          )}
          
          {paper.doi && (
            <Button
              variant="outline"
              onClick={() => window.open(`https://doi.org/${paper.doi}`, '_blank')}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              View on DOI
            </Button>
          )}

          {!isInLibrary && (
            <Button
              variant="default"
              onClick={() => addMutation.mutate()}
              disabled={addMutation.isPending}
            >
              {addMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Add to Library
            </Button>
          )}
        </div>
      </div>

      <Separator />

      {/* Abstract */}
      {paper.abstract && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Abstract</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {paper.abstract}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Paper Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            {paper.doi && (
              <div>
                <p className="text-muted-foreground mb-1">DOI</p>
                <a
                  href={`https://doi.org/${paper.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline flex items-center gap-1"
                >
                  {paper.doi}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
            
            {paper.publication_date && (
              <div>
                <p className="text-muted-foreground mb-1">Published</p>
                <p>{formatDate(paper.publication_date)}</p>
              </div>
            )}
            
            {paper.venue && (
              <div>
                <p className="text-muted-foreground mb-1">Journal/Venue</p>
                <p>{paper.venue}</p>
              </div>
            )}
            
            {libraryEntry && (
              <div>
                <p className="text-muted-foreground mb-1">Added to Library</p>
                <p>{formatDate(libraryEntry.added_at)}</p>
              </div>
            )}
            
            <div>
              <p className="text-muted-foreground mb-1">Source</p>
              <p>{isOwnUpload ? 'Uploaded by you' : 'Found via search'}</p>
            </div>
            
            <div>
              <p className="text-muted-foreground mb-1">Processing Status</p>
              <p className="capitalize">{paper.processing_status || 'Unknown'}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Projects Using This Paper */}
      {projectCitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FolderOpen className="h-5 w-5" />
              Used in {projectCitations.length} Project{projectCitations.length !== 1 ? 's' : ''}
            </CardTitle>
            <CardDescription>
              This paper is cited in the following projects
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {projectCitations.map((citation) => (
                citation.research_projects && (
                  <Link
                    key={citation.id}
                    href={`/editor/${citation.research_projects.id}`}
                    className="block p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <p className="font-medium text-sm line-clamp-1">
                      {citation.research_projects.topic}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Added {formatDate(citation.created_at)}
                      {citation.reason && ` · ${citation.reason}`}
                    </p>
                  </Link>
                )
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notes (only if in library) */}
      {isInLibrary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Your Notes</CardTitle>
            <CardDescription>
              Add private notes about this paper
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              placeholder="Add notes about this paper..."
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value)
                setIsNotesEdited(true)
              }}
              rows={4}
            />
            {isNotesEdited && (
              <div className="flex justify-end">
                <Button
                  onClick={() => saveNotesMutation.mutate()}
                  disabled={saveNotesMutation.isPending}
                >
                  {saveNotesMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Save Notes
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Danger Zone */}
      {isInLibrary && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-lg text-destructive">Danger Zone</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">Remove from Library</p>
                <p className="text-xs text-muted-foreground">
                  The paper will still be available in any projects where it&apos;s cited.
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Remove
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove from library?</DialogTitle>
            <DialogDescription>
              This will remove &quot;{paper.title}&quot; from your library. The paper will still be
              available in any projects where it&apos;s been cited.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => removeMutation.mutate()}
              disabled={removeMutation.isPending}
            >
              {removeMutation.isPending ? (
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
