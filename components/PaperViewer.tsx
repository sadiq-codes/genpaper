'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { 
  FileText, 
  Download, 
  Share2, 
  BookOpen, 
  ExternalLink,
  Clock,
  Calendar,
  Quote,
  Copy,
  Check
} from 'lucide-react'
import { format } from 'date-fns'
import CitationRenderer from '@/components/CitationRenderer'
import type { 
  ResearchProject, 
  ResearchProjectVersion,
  PaperWithAuthors
} from '@/types/simplified'

interface PaperViewerProps {
  projectId: string
  className?: string
}

export default function PaperViewer({ projectId, className }: PaperViewerProps) {
  const [project, setProject] = useState<ResearchProject | null>(null)
  const [latestVersion, setLatestVersion] = useState<ResearchProjectVersion | null>(null)
  const [papers, setPapers] = useState<PaperWithAuthors[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedText, setCopiedText] = useState<string | null>(null)
  const [showReferences, setShowReferences] = useState(false)
  
  // Fix copy button race condition
  const copyTimer = useRef<NodeJS.Timeout | undefined>(undefined)

  // Calculate cited papers count
  const citedPapersCount = useMemo(() => {
    if (!latestVersion?.content) return 0
    const citations = latestVersion.content.match(/\[CITE:\s*([a-f0-9-]{36}|[A-Za-z0-9_]+)\]/g)
    return new Set(citations?.map(cite => cite.match(/\[CITE:\s*([a-f0-9-]{36}|[A-Za-z0-9_]+)\]/)?.[1]).filter(Boolean)).size
  }, [latestVersion?.content])

  const loadProject = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch(
        `/api/projects/${projectId}?includeCitations=true&includePapers=true&includeVersions=false`,
        { credentials: 'include' }
      )
      
      if (!response.ok) {
        throw new Error('Failed to load project')
      }

      const data = await response.json()
      console.log('🔍 API Response:', {
        project: !!data.project || !!data.id,
        latest_version: !!data.latest_version,
        papers: data.papers?.length || 0,
        citations: data.citations?.length || 0
      })
      console.log('📄 Papers data:', data.papers)
      
      setProject(data)
      setLatestVersion(data.latest_version)
      setPapers(data.papers || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    loadProject()
  }, [projectId, loadProject])
  
  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (copyTimer.current) {
        clearTimeout(copyTimer.current)
      }
    }
  }, [])

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedText(text)
      
      // Clear existing timer and set new one
      if (copyTimer.current) {
        clearTimeout(copyTimer.current)
      }
      copyTimer.current = setTimeout(() => setCopiedText(null), 2000)
    } catch {
      // Silently fail
    }
  }

  const downloadPaper = () => {
    if (!latestVersion?.content || !project) return

    const blob = new Blob([latestVersion.content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${project.topic.replace(/[^a-zA-Z0-9]/g, '_')}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const sharePaper = async () => {
    if (!project) return

    const shareData = {
      title: project.topic,
      text: `Research paper: ${project.topic}`,
      url: window.location.href
    }

    if (navigator.share) {
      try {
        await navigator.share(shareData)
      } catch {
        // Fall back to copying URL
        copyToClipboard(window.location.href)
      }
    } else {
      copyToClipboard(window.location.href)
    }
  }

  if (loading) {
    return (
      <div className={`flex items-center justify-center min-h-[400px] ${className}`}>
        <div className="text-center space-y-2">
          <FileText className="h-8 w-8 animate-pulse mx-auto text-muted-foreground" />
          <p className="text-muted-foreground">Loading paper...</p>
        </div>
      </div>
    )
  }

  if (error || !project || !latestVersion) {
    return (
      <div className={`flex items-center justify-center min-h-[400px] ${className}`}>
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <FileText className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="font-medium">Unable to load paper</p>
            <p className="text-sm text-muted-foreground mt-1">
              {error || 'Paper not found or still generating'}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className={`max-w-5xl mx-auto p-6 space-y-6 ${className}`}>
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="space-y-2 flex-1">
              <CardTitle className="text-2xl leading-tight">
                {project.topic}
              </CardTitle>
              <CardDescription className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {format(new Date(project.created_at), 'PPP')}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  {latestVersion.word_count || 0} words
                </span>
                <span className="flex items-center gap-1">
                  <Quote className="h-4 w-4" />
                  {citedPapersCount} cited
                </span>
              </CardDescription>
            </div>
            
            <div className="flex items-center gap-2">
              <Badge variant={project.status === 'complete' ? 'default' : 'secondary'}>
                {project.status}
              </Badge>
              
              <Button variant="outline" size="sm" onClick={downloadPaper}>
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
              
              <Button variant="outline" size="sm" onClick={sharePaper}>
                <Share2 className="h-4 w-4 mr-2" />
                Share
              </Button>

              <Sheet open={showReferences} onOpenChange={setShowReferences}>
                <SheetTrigger asChild>
                  <Button variant="outline" size="sm">
                    <BookOpen className="h-4 w-4 mr-2" />
                    References ({citedPapersCount})
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-[400px] sm:w-[540px]">
                  <SheetHeader>
                    <SheetTitle>References</SheetTitle>
                    <SheetDescription>
                      Papers cited in this research
                    </SheetDescription>
                  </SheetHeader>
                  <ScrollArea className="h-[calc(100vh-120px)] mt-6">
                    <div className="space-y-4">
                      {papers.map((paper) => (
                        <Card key={paper.id}>
                          <CardContent className="pt-4">
                            <div className="space-y-2">
                              <h4 className="font-medium text-sm leading-tight">
                                {paper.title}
                              </h4>
                              <p className="text-xs text-muted-foreground">
                                {paper.author_names?.join(', ')}
                              </p>
                              {paper.venue && (
                                <Badge variant="secondary" className="text-xs">
                                  {paper.venue}
                                </Badge>
                              )}
                              <div className="flex items-center gap-2 pt-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => copyToClipboard(paper.title || 'Untitled')}
                                >
                                  {copiedText === (paper.title || 'Untitled') ? (
                                    <Check className="h-3 w-3" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                </Button>
                                {paper.url && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => window.open(paper.url, '_blank')}
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </ScrollArea>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Paper Content with Citation Formatting */}
      <Card>
        <CardContent className="pt-6">
          <div className="max-w-4xl mx-auto">
            <CitationRenderer 
              content={latestVersion.content || ''}
              papers={papers}
              projectId={projectId}
              initialStyle="apa"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
} 