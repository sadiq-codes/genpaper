'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { 
  BookOpen, 
  FileText, 
  Info, 
  Users,
  ExternalLink,
  ArrowLeft
} from 'lucide-react'
import BlockEditor from './BlockEditor'
import Link from 'next/link'

interface LibraryPaper {
  id: string
  title: string
  authors?: { name: string }[]
  abstract?: string
  publication_date?: string
  venue?: string
}

export default function EnhancedBlockEditor() {
  const searchParams = useSearchParams()
  const [contextData, setContextData] = useState({
    topic: '',
    paperType: '',
    selectedPapers: [] as string[],
    mode: 'free' as 'guided' | 'free'
  })
  const [libraryPapers, setLibraryPapers] = useState<LibraryPaper[]>([])
  const [isLoadingContext, setIsLoadingContext] = useState(true)
  const [projectData, setProjectData] = useState<any>(null)
  const [existingContent, setExistingContent] = useState<string>('')
  const [loadError, setLoadError] = useState<string | null>(null)

  // Extract context from URL parameters
  useEffect(() => {
    const projectId = searchParams.get('projectId')
    const topic = searchParams.get('topic') || ''
    const paperType = searchParams.get('paperType') || ''
    const selectedPapers = searchParams.get('selectedPapers')?.split(',').filter(Boolean) || []
    const mode = (searchParams.get('mode') as 'guided' | 'free') || 'free'

    if (projectId) {
      // Load existing project
      loadProject(projectId)
    } else {
      // New project from wizard
      setContextData({ topic, paperType, selectedPapers, mode })
      setIsLoadingContext(false)

      // Load selected library papers if any
      if (selectedPapers.length > 0) {
        loadSelectedPapers(selectedPapers)
      }
    }
  }, [searchParams])

  const loadProject = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        credentials: 'include'
      })
      
      if (response.ok) {
        const data = await response.json()
        const project = data.project
        
        setProjectData(project)
        setContextData({
          topic: project.topic,
          paperType: project.config?.paper_settings?.paperType || 'researchArticle',
          selectedPapers: project.config?.library_papers_used || [],
          mode: 'free'
        })
        
        // Load the latest version content
        if (project.latest_version?.content) {
          setExistingContent(project.latest_version.content)
        }
        
        // Load library papers if any
        if (project.config?.library_papers_used?.length > 0) {
          loadSelectedPapers(project.config.library_papers_used)
        }
      }
    } catch (error) {
      console.error('Failed to load project:', error)
      setLoadError('Failed to load project. Please try again later.')
    } finally {
      setIsLoadingContext(false)
    }
  }

  const loadSelectedPapers = async (paperIds: string[]) => {
    try {
      const response = await fetch('/api/library/papers', {
        credentials: 'include'
      })
      
      if (response.ok) {
        const data = await response.json()
        const allPapers = data.papers || []
        const selectedPapersData = allPapers
          .filter((lp: any) => paperIds.includes(lp.paper.id))
          .map((lp: any) => lp.paper)
        
        setLibraryPapers(selectedPapersData)
      }
    } catch (error) {
      console.error('Failed to load library papers:', error)
      setLoadError('Failed to load library papers. Please try again later.')
    }
  }

  const formatPaperType = (paperType: string) => {
    return paperType.replace(/([A-Z])/g, ' $1').toLowerCase().trim()
  }

  const formatAuthors = (authors?: { name: string }[]) => {
    if (!authors || authors.length === 0) return 'Unknown authors'
    if (authors.length === 1) return authors[0].name
    if (authors.length === 2) return `${authors[0].name} & ${authors[1].name}`
    return `${authors[0].name} et al.`
  }

  const generateInitialContent = () => {
    // If we have existing content from a loaded project, use that
    if (existingContent) {
      return existingContent
    }
    
    if (!contextData.topic) {
      return `
        <h1>Research Paper Title</h1>
        <p>Start writing your paper here. Use slash commands for AI assistance:</p>
        <ul>
          <li><strong>/write</strong> - Generate new content</li>
          <li><strong>/rewrite</strong> - Improve selected text</li>
          <li><strong>/cite</strong> - Add citations</li>
          <li><strong>/outline</strong> - Create section outline</li>
        </ul>
        <h2>Introduction</h2>
        <p>Begin your introduction here...</p>
      `
    }

    return `
      <h1>${contextData.topic}</h1>
      <p><em>Research paper on: ${contextData.topic}</em></p>
      
      <h2>Abstract</h2>
      <p>Start by writing an abstract that summarizes your research. Use <strong>/write</strong> to generate content with AI assistance.</p>
      
      <h2>Introduction</h2>
      <p>Begin your introduction here. Use <strong>/cite</strong> to add citations from your selected papers.</p>
      
      <h2>Literature Review</h2>
      <p>Review relevant literature on your topic.</p>
      
      <h2>Methodology</h2>
      <p>Describe your research methods and approach.</p>
      
      <h2>Results</h2>
      <p>Present your findings here.</p>
      
      <h2>Discussion</h2>
      <p>Analyze and interpret your results.</p>
      
      <h2>Conclusion</h2>
      <p>Summarize your work and suggest future directions.</p>
      
      <h2>References</h2>
      <p>References will be automatically formatted when you use citations.</p>
    `
  }

  if (isLoadingContext) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-muted rounded w-64" />
          <div className="h-32 bg-muted rounded" />
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <Card>
          <CardContent className="p-6 text-center">
            <div className="text-red-600 mb-4">{loadError}</div>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto p-4">
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {/* Sidebar with Context - Collapsible on mobile */}
        {(contextData.topic || contextData.selectedPapers.length > 0) && (
          <div className="xl:col-span-1 space-y-3">
            {/* Navigation */}
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" asChild>
                <Link href={projectData ? "/history" : "/generate"} className="flex items-center gap-1">
                  <ArrowLeft className="h-3 w-3" />
                  {projectData ? "Back to History" : "Back"}
                </Link>
              </Button>
              <Badge variant="outline" className="text-xs">
                {contextData.mode === 'guided' ? 'Guided' : 'Free'} Mode
              </Badge>
            </div>

            {/* Compact Research Context */}
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="h-4 w-4" />
                  <h3 className="text-sm font-medium">Research Context</h3>
                  {projectData && (
                    <Badge variant="secondary" className="text-xs h-4">
                      Editing
                    </Badge>
                  )}
                </div>

                {contextData.topic && (
                  <div className="mb-3">
                    <div className="text-xs text-muted-foreground mb-1">Topic:</div>
                    <div className="text-xs font-medium p-2 bg-muted rounded line-clamp-3">
                      {contextData.topic}
                    </div>
                  </div>
                )}

                {contextData.paperType && (
                  <div className="mb-3">
                    <div className="text-xs text-muted-foreground mb-1">Type:</div>
                    <Badge variant="outline" className="text-xs h-5">
                      {formatPaperType(contextData.paperType)}
                    </Badge>
                  </div>
                )}

                {libraryPapers.length > 0 && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-2">
                      Papers ({libraryPapers.length}):
                    </div>
                    <ScrollArea className="h-32">
                      <div className="space-y-2">
                        {libraryPapers.map((paper) => (
                          <div key={paper.id} className="p-2 bg-muted rounded text-xs">
                            <div className="font-medium line-clamp-2 mb-1">
                              {paper.title}
                            </div>
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Users className="h-2.5 w-2.5" />
                              <span className="line-clamp-1">{formatAuthors(paper.authors)}</span>
                              {paper.publication_date && (
                                <span>({new Date(paper.publication_date).getFullYear()})</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Compact AI Commands Help */}
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <BookOpen className="h-4 w-4" />
                  <h3 className="text-sm font-medium">AI Commands</h3>
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  <div><strong>/write</strong> - Generate content</div>
                  <div><strong>/cite</strong> - Add citations</div>
                  <div><strong>/rewrite</strong> - Improve text</div>
                  <div><strong>/outline</strong> - Create outline</div>
                </div>
                <Button variant="outline" size="sm" className="w-full mt-2 text-xs h-7" asChild>
                  <a href="/library" target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Manage Library
                  </a>
                </Button>
              </CardContent>
            </Card>

            {/* Guided Mode Tips */}
            {contextData.mode === 'guided' && (
              <div className="p-2 bg-blue-50 border border-blue-200 rounded text-xs">
                <div className="flex items-center gap-1 mb-1">
                  <Info className="h-3 w-3 text-blue-600" />
                  <span className="font-medium text-blue-800">Guided Mode</span>
                </div>
                <div className="text-blue-700">
                  Use slash commands to build your paper step by step with AI assistance.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Main Editor */}
        <div className={`${(contextData.topic || contextData.selectedPapers.length > 0) ? 'xl:col-span-3' : 'xl:col-span-4'}`}>
          <BlockEditor 
            initialContent={generateInitialContent()}
            documentId={projectData?.id || (contextData.topic ? `draft-${Date.now()}` : undefined)}
          />
        </div>
      </div>
    </div>
  )
} 