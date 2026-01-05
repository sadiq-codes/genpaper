'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { 
  Search, 
  FileText, 
  AlertTriangle, 
  CheckCircle,
  Lightbulb,
  BookOpen,
  Loader2,
  RefreshCw,
  Download,
  PenLine
} from 'lucide-react'
import { toast } from 'sonner'

interface Paper {
  id: string
  title: string
  abstract?: string
  authors?: string[]
  publication_date?: string
}

interface Claim {
  id: string
  paper_id: string
  claim_text: string
  claim_type: string
  confidence: number
  evidence_quote?: string
}

interface Gap {
  id: string
  gap_type: 'unstudied' | 'contradiction' | 'limitation'
  description: string
  confidence: number
  supporting_paper_ids: string[]
}

interface Analysis {
  id: string
  analysis_type: string
  markdown_output: string
  structured_output: Record<string, unknown>
  created_at: string
}

interface ProjectData {
  id: string
  topic: string
  status: string
  analysis_status?: string
}

export function ResearchWorkspace() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string
  
  const [project, setProject] = useState<ProjectData | null>(null)
  const [papers, setPapers] = useState<Paper[]>([])
  const [claims, setClaims] = useState<Claim[]>([])
  const [gaps, setGaps] = useState<Gap[]>([])
  const [analyses, setAnalyses] = useState<Analysis[]>([])
  
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState(0)
  const [activeTab, setActiveTab] = useState('overview')

  // Load project data
  const loadProject = useCallback(async () => {
    try {
      setLoading(true)
      
      // Load project
      const projectRes = await fetch(`/api/projects/${projectId}`)
      const projectData = await projectRes.json()
      if (!projectRes.ok) throw new Error(projectData.error)
      setProject(projectData)

      // Load analysis data
      const analysisRes = await fetch(`/api/analysis?projectId=${projectId}`)
      if (analysisRes.ok) {
        const analysisData = await analysisRes.json()
        setGaps(analysisData.gaps || [])
        setAnalyses(analysisData.analyses || [])
        
        // Flatten claims from all papers
        const allClaims: Claim[] = []
        for (const paperId of Object.keys(analysisData.claims || {})) {
          allClaims.push(...(analysisData.claims[paperId] || []))
        }
        setClaims(allClaims)
      }

      // Load papers associated with project
      const papersRes = await fetch(`/api/library?projectId=${projectId}`)
      if (papersRes.ok) {
        const papersData = await papersRes.json()
        setPapers(papersData.papers || [])
      }
    } catch (err) {
      console.error('Failed to load project:', err)
      toast.error('Failed to load project')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (projectId) loadProject()
  }, [projectId, loadProject])

  // Run analysis
  const runAnalysis = async (type: 'claims' | 'gaps' | 'synthesis' | 'full') => {
    if (!project || papers.length === 0) {
      toast.error('Add papers to your project first')
      return
    }

    setAnalyzing(true)
    setAnalysisProgress(0)

    try {
      const progressInterval = setInterval(() => {
        setAnalysisProgress(p => Math.min(p + 10, 90))
      }, 1000)

      const response = await fetch('/api/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          paperIds: papers.map(p => p.id),
          topic: project.topic,
          analysisType: type
        })
      })

      clearInterval(progressInterval)
      setAnalysisProgress(100)

      if (!response.ok) {
        throw new Error('Analysis failed')
      }

      const result = await response.json()
      toast.success(`Analysis complete! ${type === 'full' ? 'All analyses' : type} finished.`)
      
      // Reload data
      await loadProject()
    } catch (err) {
      console.error('Analysis failed:', err)
      toast.error('Analysis failed')
    } finally {
      setAnalyzing(false)
      setAnalysisProgress(0)
    }
  }

  // Export analysis
  const exportAnalysis = () => {
    const latestSynthesis = analyses.find(a => a.analysis_type === 'synthesis')
    if (!latestSynthesis) {
      toast.error('No synthesis to export. Run analysis first.')
      return
    }

    const blob = new Blob([latestSynthesis.markdown_output], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${project?.topic.slice(0, 30).replace(/[^a-z0-9]/gi, '_')}_analysis.md`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Analysis exported!')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-200px)]">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Loading research workspace...</p>
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-200px)]">
        <Card className="w-96">
          <CardHeader>
            <CardTitle>Project Not Found</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">This project doesn't exist or you don't have access.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{project.topic}</h1>
          <p className="text-muted-foreground">
            {papers.length} papers • {claims.length} claims extracted • {gaps.length} gaps identified
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => loadProject()}
            disabled={analyzing}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button 
            variant="outline" 
            size="sm"
            onClick={exportAnalysis}
            disabled={analyses.length === 0}
          >
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button 
            variant="outline"
            onClick={() => router.push(`/editor/${projectId}`)}
          >
            <PenLine className="h-4 w-4 mr-2" />
            Open Editor
          </Button>
          <Button 
            onClick={() => runAnalysis('full')}
            disabled={analyzing || papers.length === 0}
          >
            {analyzing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Search className="h-4 w-4 mr-2" />
                Run Full Analysis
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Progress bar when analyzing */}
      {analyzing && (
        <div className="space-y-2">
          <Progress value={analysisProgress} />
          <p className="text-sm text-muted-foreground text-center">
            Analyzing papers... {analysisProgress}%
          </p>
        </div>
      )}

      {/* Main content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="papers">Papers ({papers.length})</TabsTrigger>
          <TabsTrigger value="claims">Claims ({claims.length})</TabsTrigger>
          <TabsTrigger value="gaps">Gaps ({gaps.length})</TabsTrigger>
          <TabsTrigger value="synthesis">Synthesis</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Papers
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{papers.length}</div>
                <p className="text-sm text-muted-foreground">Sources analyzed</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <CheckCircle className="h-5 w-5" />
                  Claims
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{claims.length}</div>
                <p className="text-sm text-muted-foreground">
                  {claims.filter(c => c.claim_type === 'finding').length} findings, {' '}
                  {claims.filter(c => c.claim_type === 'method').length} methods
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Research Gaps
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{gaps.length}</div>
                <p className="text-sm text-muted-foreground">
                  {gaps.filter(g => g.gap_type === 'unstudied').length} unstudied, {' '}
                  {gaps.filter(g => g.gap_type === 'contradiction').length} contradictions
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Quick actions */}
          {papers.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center">
                <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">Add Papers to Get Started</h3>
                <p className="text-muted-foreground mb-4">
                  Search for papers and add them to your project to begin analysis.
                </p>
                <Button onClick={() => setActiveTab('papers')}>
                  Add Papers
                </Button>
              </CardContent>
            </Card>
          )}

          {papers.length > 0 && claims.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center">
                <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">Ready to Analyze</h3>
                <p className="text-muted-foreground mb-4">
                  You have {papers.length} papers. Run analysis to extract claims and identify gaps.
                </p>
                <Button onClick={() => runAnalysis('full')} disabled={analyzing}>
                  Run Full Analysis
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Papers Tab */}
        <TabsContent value="papers">
          <Card>
            <CardHeader>
              <CardTitle>Source Papers</CardTitle>
              <CardDescription>Papers included in this research project</CardDescription>
            </CardHeader>
            <CardContent>
              {papers.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  No papers added yet. Go to Library to search and add papers.
                </p>
              ) : (
                <ScrollArea className="h-[400px]">
                  <div className="space-y-3">
                    {papers.map(paper => (
                      <div key={paper.id} className="p-3 border rounded-lg">
                        <h4 className="font-medium">{paper.title}</h4>
                        {paper.authors && (
                          <p className="text-sm text-muted-foreground">
                            {paper.authors.slice(0, 3).join(', ')}
                            {paper.authors.length > 3 && ' et al.'}
                          </p>
                        )}
                        <div className="flex gap-2 mt-2">
                          <Badge variant="secondary">
                            {claims.filter(c => c.paper_id === paper.id).length} claims
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Claims Tab */}
        <TabsContent value="claims">
          <Card>
            <CardHeader>
              <CardTitle>Extracted Claims</CardTitle>
              <CardDescription>Key claims extracted from source papers</CardDescription>
            </CardHeader>
            <CardContent>
              {claims.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-4">No claims extracted yet.</p>
                  <Button onClick={() => runAnalysis('claims')} disabled={analyzing}>
                    Extract Claims
                  </Button>
                </div>
              ) : (
                <ScrollArea className="h-[400px]">
                  <div className="space-y-3">
                    {claims.map(claim => (
                      <div key={claim.id} className="p-3 border rounded-lg">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm">{claim.claim_text}</p>
                          <Badge variant={
                            claim.claim_type === 'finding' ? 'default' :
                            claim.claim_type === 'method' ? 'secondary' :
                            claim.claim_type === 'limitation' ? 'destructive' :
                            'outline'
                          }>
                            {claim.claim_type}
                          </Badge>
                        </div>
                        {claim.evidence_quote && (
                          <p className="text-xs text-muted-foreground mt-2 italic">
                            "{claim.evidence_quote.slice(0, 150)}..."
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Gaps Tab */}
        <TabsContent value="gaps">
          <Card>
            <CardHeader>
              <CardTitle>Research Gaps</CardTitle>
              <CardDescription>Identified gaps, contradictions, and limitations</CardDescription>
            </CardHeader>
            <CardContent>
              {gaps.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-4">No gaps identified yet.</p>
                  <Button onClick={() => runAnalysis('gaps')} disabled={analyzing}>
                    Find Gaps
                  </Button>
                </div>
              ) : (
                <ScrollArea className="h-[400px]">
                  <div className="space-y-4">
                    {gaps.map(gap => (
                      <div key={gap.id} className="p-4 border rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          {gap.gap_type === 'unstudied' && <Lightbulb className="h-4 w-4 text-yellow-500" />}
                          {gap.gap_type === 'contradiction' && <AlertTriangle className="h-4 w-4 text-red-500" />}
                          {gap.gap_type === 'limitation' && <FileText className="h-4 w-4 text-orange-500" />}
                          <Badge variant={
                            gap.gap_type === 'unstudied' ? 'default' :
                            gap.gap_type === 'contradiction' ? 'destructive' :
                            'secondary'
                          }>
                            {gap.gap_type}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {(gap.confidence * 100).toFixed(0)}% confidence
                          </span>
                        </div>
                        <p className="text-sm">{gap.description}</p>
                        <p className="text-xs text-muted-foreground mt-2">
                          Based on {gap.supporting_paper_ids.length} papers
                        </p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Synthesis Tab */}
        <TabsContent value="synthesis">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Research Synthesis</CardTitle>
                  <CardDescription>AI-generated synthesis with verified citations</CardDescription>
                </div>
                <Button 
                  variant="outline" 
                  onClick={() => runAnalysis('synthesis')} 
                  disabled={analyzing || claims.length === 0}
                >
                  {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Regenerate'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {analyses.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-4">
                    No synthesis generated yet. Extract claims first, then generate synthesis.
                  </p>
                  <Button 
                    onClick={() => runAnalysis('synthesis')} 
                    disabled={analyzing || claims.length === 0}
                  >
                    Generate Synthesis
                  </Button>
                </div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div className="prose prose-sm max-w-none">
                    {analyses
                      .filter(a => a.analysis_type === 'synthesis')
                      .slice(0, 1)
                      .map(analysis => (
                        <div key={analysis.id} className="whitespace-pre-wrap">
                          {analysis.markdown_output}
                        </div>
                      ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
