'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { 
  Sheet, 
  SheetContent, 
  SheetDescription, 
  SheetHeader, 
  SheetTitle 
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { 
  ExternalLink, 
  FileText, 
  Calendar, 
  Users, 
  BookOpen,
  Copy,
  CheckCircle2
} from 'lucide-react'
import type { PaperWithAuthors } from '@/types/simplified'
import type { CSLItem } from '@/lib/utils/csl'

interface CitationDrawerProps {
  paper: PaperWithAuthors | CSLItem | DatabaseCitation | null
  isOpen: boolean
  onClose: () => void
}

interface DatabaseCitation {
  id: string
  key: string
  csl_json: Record<string, unknown>
}

export default function CitationDrawer({ paper, isOpen, onClose }: CitationDrawerProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null)

  if (!paper) return null

  // Determine if this is a database citation (CSL format) or a regular paper
  const isCSLPaper = 'type' in paper && paper.type
  const isDatabaseCitation = 'csl_json' in paper

  // Extract metadata based on paper type
  const getMetadata = () => {
    if (isDatabaseCitation) {
      const csl = (paper as DatabaseCitation).csl_json as unknown as CSLItem
      return {
        title: csl.title || 'Untitled',
        authors: csl.author?.map(a => `${a.given || ''} ${a.family || ''}`.trim()) || [],
        year: csl.issued?.['date-parts']?.[0]?.[0] || null,
        venue: csl['container-title'] || csl.publisher || 'Unknown',
        doi: csl.DOI || null,
        url: csl.URL || null,
        abstract: csl.abstract || null,
        citationCount: null,
        source: 'database'
      }
    } else if (isCSLPaper) {
      const csl = paper as CSLItem
      return {
        title: csl.title || 'Untitled',
        authors: csl.author?.map(a => `${a.given || ''} ${a.family || ''}`.trim()) || [],
        year: csl.issued?.['date-parts']?.[0]?.[0] || null,
        venue: csl['container-title'] || csl.publisher || 'Unknown',
        doi: csl.DOI || null,
        url: csl.URL || null,
        abstract: csl.abstract || null,
        citationCount: null,
        source: 'csl'
      }
    } else {
      const p = paper as PaperWithAuthors
      return {
        title: p.title || 'Untitled',
        authors: p.author_names || [],
        year: p.publication_date ? new Date(p.publication_date).getFullYear() : null,
        venue: p.venue || 'Unknown',
        doi: p.doi || null,
        url: p.url || p.pdf_url || null,
        abstract: p.abstract || null,
        citationCount: p.citation_count || null,
        source: p.source || 'unknown'
      }
    }
  }

  const metadata = getMetadata()

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  const formatAuthors = (authors: string[]) => {
    if (authors.length === 0) return 'Unknown authors'
    if (authors.length === 1) return authors[0]
    if (authors.length === 2) return `${authors[0]} and ${authors[1]}`
    if (authors.length <= 3) return `${authors.slice(0, -1).join(', ')}, and ${authors[authors.length - 1]}`
    return `${authors.slice(0, 3).join(', ')}, et al.`
  }

  const generateCitation = () => {
    const authorStr = formatAuthors(metadata.authors)
    const year = metadata.year ? ` (${metadata.year})` : ''
    return `${authorStr}${year}. ${metadata.title}. ${metadata.venue}.`
  }

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:w-[600px] sm:max-w-none">
        <SheetHeader className="space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <SheetTitle className="text-xl leading-tight pr-4">
                {metadata.title}
              </SheetTitle>
              <SheetDescription className="mt-2 text-base">
                Citation details and metadata
              </SheetDescription>
            </div>
            <Badge variant="outline" className="mt-1">
              {metadata.source}
            </Badge>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Authors */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium">Authors</h3>
            </div>
            <div className="pl-6">
              {metadata.authors.length > 0 ? (
                <div className="space-y-1">
                  {metadata.authors.map((author, idx) => (
                    <div key={idx} className="text-sm text-muted-foreground">
                      {author}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">No authors listed</p>
              )}
            </div>
          </div>

          <Separator />

          {/* Publication Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Year */}
            {metadata.year && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <h3 className="font-medium">Year</h3>
                </div>
                <p className="pl-6 text-sm">{metadata.year}</p>
              </div>
            )}

            {/* Venue */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-muted-foreground" />
                <h3 className="font-medium">Venue</h3>
              </div>
              <p className="pl-6 text-sm">{metadata.venue}</p>
            </div>

            {/* Citation Count */}
            {metadata.citationCount !== null && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <h3 className="font-medium">Citations</h3>
                </div>
                <p className="pl-6 text-sm">{metadata.citationCount.toLocaleString()}</p>
              </div>
            )}
          </div>

          <Separator />

          {/* DOI and Links */}
          <div className="space-y-4">
            <h3 className="font-medium">Identifiers & Links</h3>
            
            {metadata.doi && (
              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <div>
                  <div className="font-medium text-sm">DOI</div>
                  <div className="text-sm text-muted-foreground font-mono">
                    {metadata.doi}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(metadata.doi!, 'doi')}
                  >
                    {copiedField === 'doi' ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                  >
                    <a 
                      href={`https://doi.org/${metadata.doi}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </Button>
                </div>
              </div>
            )}

            {metadata.url && (
              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <div className="flex-1 mr-3">
                  <div className="font-medium text-sm">Paper URL</div>
                  <div className="text-sm text-muted-foreground truncate">
                    {metadata.url}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(metadata.url!, 'url')}
                  >
                    {copiedField === 'url' ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                  >
                    <a 
                      href={metadata.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Abstract */}
          {metadata.abstract && (
            <>
              <Separator />
              <div className="space-y-2">
                <h3 className="font-medium">Abstract</h3>
                <div className="text-sm text-muted-foreground leading-relaxed p-3 bg-muted rounded-lg">
                  {metadata.abstract}
                </div>
              </div>
            </>
          )}

          <Separator />

          {/* Citation Text */}
          <div className="space-y-2">
            <h3 className="font-medium">Generated Citation</h3>
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-sm leading-relaxed">{generateCitation()}</p>
              <div className="mt-2 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(generateCitation(), 'citation')}
                >
                  {copiedField === 'citation' ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-2" />
                      Copy Citation
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
} 