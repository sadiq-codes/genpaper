'use client'

import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { 
  FileText, 
  Download, 
  Share2, 
  BookOpen, 
  ExternalLink,
  Clock,
  User,
  Calendar,
  Quote,
  Copy,
  Check,
  Eye,
  BookMarked,
  MoreVertical
} from 'lucide-react'
import { format } from 'date-fns'
import ReactMarkdown from 'react-markdown'
import type { 
  ResearchProject, 
  ResearchProjectVersion, 
  ProjectCitation, 
  Paper 
} from '@/types/simplified'

interface PaperViewerProps {
  projectId: string
  className?: string
}

interface CitationPreview {
  citation: ProjectCitation
  isOpen: boolean
  position?: { x: number; y: number }
}

export default function PaperViewer({ projectId, className }: PaperViewerProps) {
  const [project, setProject] = useState<ResearchProject | null>(null)
  const [latestVersion, setLatestVersion] = useState<ResearchProjectVersion | null>(null)
  const [citations, setCitations] = useState<ProjectCitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedCitation, setSelectedCitation] = useState<CitationPreview | null>(null)
  const [copiedText, setCopiedText] = useState<string | null>(null)
  const [showReferences, setShowReferences] = useState(false)

  useEffect(() => {
    loadProject()
  }, [projectId])

  const loadProject = async () => {
    try {
      setLoading(true)
      const response = await fetch(
        `/api/projects/${projectId}?includeCitations=true&includeVersions=false`,
        { credentials: 'include' }
      )
      
      if (!response.ok) {
        throw new Error('Failed to load project')
      }

      const data = await response.json()
      setProject(data)
      setLatestVersion(data.latest_version)
      setCitations(data.citations || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project')
    } finally {
      setLoading(false)
    }
  }

  const citationMap = useMemo(() => {
    const map = new Map<string, ProjectCitation>()
    citations.forEach(citation => {
      map.set(citation.citation_text, citation)
    })
    return map
  }, [citations])

  const handleCitationClick = (citationText: string, event: React.MouseEvent) => {
    const citation = citationMap.get(citationText)
    if (!citation) return

    const rect = event.currentTarget.getBoundingClientRect()
    setSelectedCitation({
      citation,
      isOpen: true,
      position: {
        x: rect.left + rect.width / 2,
        y: rect.top - 10
      }
    })
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedText(text)
      setTimeout(() => setCopiedText(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
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
      } catch (err) {
        // Fall back to copying URL
        copyToClipboard(window.location.href)
      }
    } else {
      copyToClipboard(window.location.href)
    }
  }

  // Custom markdown renderer with citation handling
  const MarkdownRenderer = ({ content }: { content: string }) => {
    return (
      <ReactMarkdown
        className="prose prose-lg max-w-none"
        components={{
          p: ({ children }) => {
            if (!children) return <p />
            
            // Convert children to string and process citations
            const processChildren = (nodes: React.ReactNode): React.ReactNode => {
              if (typeof nodes === 'string') {
                // Look for citation patterns like [AuthorYear] or (Author, Year)
                const citationRegex = /\[([\w\s]+\d{4})\]|\(([\w\s]+,\s*\d{4})\)/g
                const parts = nodes.split(citationRegex)
                
                return parts.map((part, index) => {
                  if (!part) return null
                  
                  // Check if this part matches a citation pattern
                  const citationMatch = part.match(/[\w\s]+\d{4}/)
                  if (citationMatch && citationMap.has(`[${part}]`)) {
                    return (
                      <TooltipProvider key={index}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                              onClick={(e) => handleCitationClick(`[${part}]`, e)}
                            >
                              [{part}]
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Click to view citation details</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )
                  }
                  
                  return part
                })
              }
              
              return nodes
            }

            return <p className="mb-4 leading-relaxed">{processChildren(children)}</p>
          },
          h1: ({ children }) => (
            <h1 className="text-3xl font-bold mb-6 text-gray-900 border-b pb-2">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-2xl font-semibold mb-4 mt-8 text-gray-800">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-xl font-medium mb-3 mt-6 text-gray-700">
              {children}
            </h3>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-blue-500 pl-4 italic my-4 text-gray-600">
              {children}
            </blockquote>
          ),
          code: ({ children }) => (
            <code className="bg-gray-100 px-1 py-0.5 rounded text-sm font-mono">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="bg-gray-100 p-4 rounded-lg overflow-x-auto my-4">
              {children}
            </pre>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    )
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
                  {citations.length} citations
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
                    References ({citations.length})
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
                      {citations.map((citation, index) => (
                        <Card key={citation.id}>
                          <CardContent className="pt-4">
                            <div className="space-y-2">
                              <h4 className="font-medium text-sm leading-tight">
                                {citation.paper?.title}
                              </h4>
                              <p className="text-xs text-muted-foreground">
                                {citation.paper?.authors?.map(a => a.name).join(', ')}
                              </p>
                              {citation.paper?.venue && (
                                <Badge variant="secondary" className="text-xs">
                                  {citation.paper.venue}
                                </Badge>
                              )}
                              <div className="flex items-center gap-2 pt-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => copyToClipboard(citation.citation_text)}
                                >
                                  {copiedText === citation.citation_text ? (
                                    <Check className="h-3 w-3" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                </Button>
                                {citation.paper?.url && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => window.open(citation.paper?.url, '_blank')}
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

      {/* Paper Content */}
      <Card>
        <CardContent className="pt-6">
          <div className="max-w-4xl mx-auto">
            <MarkdownRenderer content={latestVersion.content} />
          </div>
        </CardContent>
      </Card>

      {/* Citation Preview Popover */}
      {selectedCitation && (
        <Popover 
          open={selectedCitation.isOpen} 
          onOpenChange={(open) => !open && setSelectedCitation(null)}
        >
          <PopoverContent className="w-80">
            <div className="space-y-3">
              <div className="space-y-1">
                <h4 className="font-medium text-sm leading-tight">
                  {selectedCitation.citation.paper?.title}
                </h4>
                <p className="text-xs text-muted-foreground">
                  {selectedCitation.citation.paper?.authors?.map(a => a.name).join(', ')}
                </p>
              </div>
              
              {selectedCitation.citation.paper?.abstract && (
                <p className="text-xs leading-relaxed">
                  {selectedCitation.citation.paper.abstract.substring(0, 200)}...
                </p>
              )}
              
              <div className="flex items-center gap-2">
                {selectedCitation.citation.paper?.venue && (
                  <Badge variant="secondary" className="text-xs">
                    {selectedCitation.citation.paper.venue}
                  </Badge>
                )}
                {selectedCitation.citation.paper?.publication_date && (
                  <span className="text-xs text-muted-foreground">
                    {new Date(selectedCitation.citation.paper.publication_date).getFullYear()}
                  </span>
                )}
              </div>
              
              <div className="flex justify-between pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(selectedCitation.citation.citation_text)}
                >
                  <Copy className="h-3 w-3 mr-1" />
                  Copy Citation
                </Button>
                
                {selectedCitation.citation.paper?.url && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => window.open(selectedCitation.citation.paper?.url, '_blank')}
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    View Paper
                  </Button>
                )}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
} 