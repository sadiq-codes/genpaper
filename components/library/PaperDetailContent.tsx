'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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

// Processing status label
function ProcessingStatusLabel({ status, chunkCount }: { status: string | null; chunkCount: number }) {
  if (status === 'full_text_ready' && chunkCount > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] text-success/70 uppercase tracking-wide font-medium">
        <CheckCircle className="h-2.5 w-2.5" />
        Full Text Ready
      </span>
    )
  }
  if (status === 'abstract_ready' && chunkCount > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] text-info/70 uppercase tracking-wide font-medium">
        <CheckCircle className="h-2.5 w-2.5" />
        Abstract Ready
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] text-destructive/70 uppercase tracking-wide font-medium">
        <AlertCircle className="h-2.5 w-2.5" />
        Failed
      </span>
    )
  }
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] text-muted-foreground/50 uppercase tracking-wide font-medium">
        <Clock className="h-2.5 w-2.5" />
        Pending
      </span>
    )
  }
  return null
}

// Paper metadata helpers
function formatPaperType(raw?: string): string | null {
  if (!raw) return null
  const map: Record<string, string> = {
    'article': 'Article', 'journal-article': 'Article', 'conference-paper': 'Conference',
    'preprint': 'Preprint', 'review': 'Review', 'book-chapter': 'Book Chapter',
    'book': 'Book', 'dissertation': 'Dissertation', 'editorial': 'Editorial',
  }
  return map[raw.toLowerCase()] || raw.charAt(0).toUpperCase() + raw.slice(1)
}



// Source label
function SourceLabel({ source, ownerId }: { source: string | null; ownerId: string | null }) {
  return (
    <span className="text-[9px] text-muted-foreground/40 uppercase tracking-wide font-medium">
      {source === 'upload' || ownerId ? 'Uploaded PDF' : 'From search'}
    </span>
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
    <div className="space-y-8">
      {/* Back Button */}
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground/50 hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Library
      </button>

      {/* Main Paper Info */}
      <div className="space-y-4">
        <h1 className="font-instrument text-2xl tracking-tight leading-snug">{paper.title}</h1>

        <p className="text-[13px] text-muted-foreground/60">{formatAuthors(paper.authors)}</p>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-3">
          <SourceLabel source={paper.source} ownerId={paper.owner_id} />
          <ProcessingStatusLabel status={paper.processing_status} chunkCount={chunkCount} />
          {paper.venue && (
            <span className="text-[11px] text-muted-foreground/50 font-instrument italic">{paper.venue}</span>
          )}
          {paper.publication_date && (
            <span className="text-[11px] text-muted-foreground/40">{getYear(paper.publication_date)}</span>
          )}
          {paper.citation_count !== null && paper.citation_count > 0 && (
            <span className="text-[11px] text-muted-foreground/40">{paper.citation_count.toLocaleString()} citations</span>
          )}
        </div>

        {/* Type / OA / Fields badges */}
        {paper.metadata && (() => {
          const paperType = formatPaperType(paper.metadata?.paper_type as string | undefined)
          const fields = (paper.metadata?.fields_of_study as string[] | undefined)?.slice(0, 4)
          const keywords = (paper.metadata?.keywords as string[] | undefined)?.slice(0, 4)
          const tags = fields?.length ? fields : keywords
          const hasBadges = paperType || tags?.length
          if (!hasBadges) return null
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              {paperType && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted/50 text-muted-foreground">
                  {paperType}
                </span>
              )}
              {tags?.map((tag) => (
                <span key={tag} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] bg-foreground/5 text-muted-foreground">
                  {tag}
                </span>
              ))}
            </div>
          )
        })()}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {hasPdf && (
            <>
              <button
                className="h-8 px-4 text-xs font-medium rounded-full bg-foreground/80 text-background hover:bg-foreground/70 transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
                onClick={handleViewPdf}
                disabled={isLoadingPdf}
              >
                {isLoadingPdf ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
                View PDF
              </button>
              <button
                className="h-8 px-4 text-xs rounded-full border border-border/40 text-muted-foreground hover:text-foreground hover:border-border transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
                onClick={handleDownloadPdf}
                disabled={isLoadingPdf}
              >
                {isLoadingPdf ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                Download
              </button>
            </>
          )}
          
          {paper.doi && (
            <button
              className="h-8 px-4 text-xs rounded-full border border-border/40 text-muted-foreground hover:text-foreground hover:border-border transition-colors inline-flex items-center gap-1.5"
              onClick={() => window.open(`https://doi.org/${paper.doi}`, '_blank')}
            >
              <ExternalLink className="h-3 w-3" />
              DOI
            </button>
          )}

          {!isInLibrary && (
            <button
              className="h-8 px-4 text-xs font-medium rounded-full bg-foreground/80 text-background hover:bg-foreground/70 transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
              onClick={() => addMutation.mutate()}
              disabled={addMutation.isPending}
            >
              {addMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Add to Library
            </button>
          )}
        </div>
      </div>

      {/* Abstract */}
      {paper.abstract && (
        <div className="pt-6 border-t border-border/20">
          <h2 className="font-instrument text-base tracking-tight mb-3">Abstract</h2>
          <p className="text-[13px] text-muted-foreground/60 leading-[1.7] whitespace-pre-wrap">
            {paper.abstract.replace(/<[^>]*>/g, '').trim()}
          </p>
        </div>
      )}

      {/* Paper Details */}
      <div className="pt-6 border-t border-border/20">
        <h2 className="font-instrument text-base tracking-tight mb-4">Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {paper.doi && (
            <div>
              <p className="text-[11px] text-muted-foreground/40 uppercase tracking-wide font-medium mb-1">DOI</p>
              <a
                href={`https://doi.org/${paper.doi}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] text-foreground/70 hover:text-foreground transition-colors inline-flex items-center gap-1"
              >
                {paper.doi}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
          )}
          {paper.publication_date && (
            <div>
              <p className="text-[11px] text-muted-foreground/40 uppercase tracking-wide font-medium mb-1">Published</p>
              <p className="text-[13px] text-foreground/70">{formatDate(paper.publication_date)}</p>
            </div>
          )}
          {paper.venue && (
            <div>
              <p className="text-[11px] text-muted-foreground/40 uppercase tracking-wide font-medium mb-1">Venue</p>
              <p className="text-[13px] text-foreground/70 font-instrument italic">{paper.venue}</p>
            </div>
          )}
          {libraryEntry && (
            <div>
              <p className="text-[11px] text-muted-foreground/40 uppercase tracking-wide font-medium mb-1">Added</p>
              <p className="text-[13px] text-foreground/70">{formatDate(libraryEntry.added_at)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Projects Using This Paper */}
      {projectCitations.length > 0 && (
        <div className="pt-6 border-t border-border/20">
          <h2 className="font-instrument text-base tracking-tight mb-1">
            Used in {projectCitations.length} project{projectCitations.length !== 1 ? 's' : ''}
          </h2>
          <p className="text-[11px] text-muted-foreground/40 mb-4">This paper is cited in the following projects</p>
          <div className="space-y-2">
            {projectCitations.map((citation) => (
              citation.research_projects && (
                <Link
                  key={citation.id}
                  href={`/editor/${citation.research_projects.id}`}
                  className="block px-4 py-3 rounded-xl border border-border/50 hover:border-border/80 hover:bg-muted/40 transition-all"
                >
                  <p className="font-instrument text-[13px] tracking-tight line-clamp-1">
                    {citation.research_projects.topic}
                  </p>
                  <p className="text-[10px] text-muted-foreground/40 mt-1">
                    Added {formatDate(citation.created_at)}
                    {citation.reason && ` · ${citation.reason}`}
                  </p>
                </Link>
              )
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {isInLibrary && (
        <div className="pt-6 border-t border-border/20">
          <h2 className="font-instrument text-base tracking-tight mb-1">Your Notes</h2>
          <p className="text-[11px] text-muted-foreground/40 mb-3">Add private notes about this paper</p>
          <Textarea
            placeholder="Add notes about this paper..."
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value)
              setIsNotesEdited(true)
            }}
            rows={4}
            className="rounded-xl border-border/60 placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:border-accent/50 transition-colors"
          />
          {isNotesEdited && (
            <div className="flex justify-end mt-3">
              <button
                className="h-8 px-4 text-xs font-medium rounded-full bg-foreground/80 text-background hover:bg-foreground/70 transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
                onClick={() => saveNotesMutation.mutate()}
                disabled={saveNotesMutation.isPending}
              >
                {saveNotesMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                Save Notes
              </button>
            </div>
          )}
        </div>
      )}

      {/* Remove */}
      {isInLibrary && (
        <div className="pt-6 border-t border-border/20">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium text-foreground/70">Remove from library</p>
              <p className="text-[11px] text-muted-foreground/40">
                The paper will still be available in any projects where it&apos;s cited.
              </p>
            </div>
            <button
              className="h-7 px-3 text-[11px] rounded-full text-destructive/60 hover:text-destructive border border-destructive/20 hover:border-destructive/40 transition-colors inline-flex items-center gap-1"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="h-3 w-3" />
              Remove
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-instrument text-lg tracking-tight">Remove from library?</DialogTitle>
            <DialogDescription className="text-[13px] text-muted-foreground/60">
              This will remove &quot;{paper.title}&quot; from your library. The paper will still be
              available in any projects where it&apos;s been cited.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <button
              className="h-9 px-4 text-sm rounded-full border border-border/40 hover:bg-muted transition-colors"
              onClick={() => setShowDeleteDialog(false)}
            >
              Cancel
            </button>
            <button
              className="h-9 px-4 text-sm rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
              onClick={() => removeMutation.mutate()}
              disabled={removeMutation.isPending}
            >
              {removeMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Remove
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
