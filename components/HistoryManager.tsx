'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { 
  History, 
  Search, 
  Edit3, 
  Trash2, 
  MoreVertical,
  Calendar,
  FileText,
  Quote,
  Download,
  Share2,
  SortAsc,
  SortDesc,
  Plus,
} from 'lucide-react'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import { format } from 'date-fns'
import type { ResearchProjectWithLatestVersion } from '@/types/simplified'

interface HistoryManagerProps {
  className?: string
}

export default function HistoryManager({ className }: HistoryManagerProps) {
  const router = useRouter()
  
  const [projects, setProjects] = useState<ResearchProjectWithLatestVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Filters and search
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'created_at' | 'topic' | 'status'>('created_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  
  // UI state
  const [selectedProject, setSelectedProject] = useState<ResearchProjectWithLatestVersion | null>(null)
  const [deletingProject, setDeletingProject] = useState<string | null>(null)

  useEffect(() => {
    loadProjects()
  }, [])

  const loadProjects = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/projects', { credentials: 'include' })
      if (response.ok) {
        const data = await response.json()
        setProjects(data.projects || [])
      } else {
        console.error('Failed to load projects:', response.status)
        setError('Failed to load projects')
      }
    } catch (error) {
      console.error('Error loading projects:', error)
      setError('Failed to load projects')
    } finally {
      setLoading(false)
    }
  }

  const deleteProject = async (projectId: string) => {
    try {
      setDeletingProject(projectId)
      const response = await fetch(`/api/projects?projectId=${projectId}`, {
        method: 'DELETE',
        credentials: 'include'
      })
      
      if (response.ok) {
        setProjects(prev => prev.filter(p => p.id !== projectId))
      } else {
        console.error('Failed to delete project')
      }
    } catch (error) {
      console.error('Error deleting project:', error)
    } finally {
      setDeletingProject(null)
    }
  }

  const viewProject = (projectId: string) => {
    router.push(`/generate/editor?projectId=${projectId}`)
  }

  const downloadProject = async (project: ResearchProjectWithLatestVersion) => {
    if (!project.latest_version?.content) return

    const blob = new Blob([project.latest_version.content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${project.topic.replace(/[^a-zA-Z0-9]/g, '_')}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const shareProject = async (project: ResearchProjectWithLatestVersion) => {
    const shareData = {
      title: project.topic,
      text: `Research paper: ${project.topic}`,
      url: `${window.location.origin}/projects/${project.id}`
    }

    if (navigator.share) {
      try {
        await navigator.share(shareData)
      } catch {
        // Fall back to copying URL
        navigator.clipboard.writeText(shareData.url)
      }
    } else {
      navigator.clipboard.writeText(shareData.url)
    }
  }

  // Filter and sort projects
  const filteredProjects = projects
    .filter(project => {
      const matchesSearch = searchQuery === '' || 
        project.topic.toLowerCase().includes(searchQuery.toLowerCase())
      
      const matchesStatus = statusFilter === 'all' || project.status === statusFilter
      
      return matchesSearch && matchesStatus
    })
    .sort((a, b) => {
      let comparison = 0
      
      switch (sortBy) {
        case 'topic':
          comparison = a.topic.localeCompare(b.topic)
          break
        case 'status':
          comparison = a.status.localeCompare(b.status)
          break
        case 'created_at':
        default:
          comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          break
      }
      
      return sortOrder === 'desc' ? -comparison : comparison
    })

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'complete':
        return 'default'
      case 'generating':
        return 'secondary'
      case 'failed':
        return 'destructive'
      default:
        return 'outline'
    }
  }

  const ProjectCard = ({ project }: { project: ResearchProjectWithLatestVersion }) => (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="pt-6">
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex-1 space-y-2">
              <h3 className="font-medium text-lg leading-tight line-clamp-2">
                {project.topic}
              </h3>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {format(new Date(project.created_at), 'PP')}
                </span>
                {project.latest_version?.word_count && (
                  <span className="flex items-center gap-1">
                    <FileText className="h-4 w-4" />
                    {project.latest_version.word_count} words
                  </span>
                )}
                {project.citation_count && (
                  <span className="flex items-center gap-1">
                    <Quote className="h-4 w-4" />
                    {project.citation_count} citations
                  </span>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Badge variant={getStatusColor(project.status)}>
                {project.status}
              </Badge>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => viewProject(project.id)}>
                    <Edit3 className="h-4 w-4 mr-2" />
                    Edit Paper
                  </DropdownMenuItem>
                  {project.status === 'complete' && project.latest_version?.content && (
                    <>
                      <DropdownMenuItem onClick={() => router.push(`/projects/${project.id}`)}>
                        <FileText className="h-4 w-4 mr-2" />
                        View Only
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => downloadProject(project)}>
                        <Download className="h-4 w-4 mr-2" />
                        Download
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => shareProject(project)}>
                        <Share2 className="h-4 w-4 mr-2" />
                        Share
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuItem 
                    onClick={() => deleteProject(project.id)}
                    className="text-red-600"
                    disabled={deletingProject === project.id}
                  >
                    {deletingProject === project.id ? (
                      <LoadingSpinner size="sm" text="Delete" />
                    ) : (
                      <>
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </>
                    )}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {project.status === 'complete' && project.completed_at && (
            <div className="text-xs text-muted-foreground">
              Completed {format(new Date(project.completed_at), 'PPp')}
            </div>
          )}

          {project.status === 'generating' && (
            <div className="flex items-center gap-2 text-sm text-blue-600">
              <LoadingSpinner size="sm" text="Paper generation in progress..." />
            </div>
          )}

          {project.status === 'failed' && (
            <div className="text-sm text-red-600">
              Generation failed. You can try again with a new paper.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )

  if (loading) {
    return (
      <div className={`max-w-6xl mx-auto p-6 space-y-6 ${className}`}>
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner text="Loading project history..." />
        </div>
      </div>
    )
  }

  return (
    <div className={`max-w-6xl mx-auto p-6 space-y-6 ${className}`}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <History className="h-8 w-8" />
            Project History
          </h1>
          <p className="text-muted-foreground">
            View and manage your research paper generation history
          </p>
        </div>
        
        <Button onClick={() => router.push('/generate')}>
          <Plus className="h-4 w-4 mr-2" />
          Generate New Paper
        </Button>
      </div>

      {/* Filters and Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative flex-1 min-w-64">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="complete">Complete</SelectItem>
                <SelectItem value="generating">Generating</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={sortBy} onValueChange={(value: 'created_at' | 'topic' | 'status') => setSortBy(value)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="created_at">Date Created</SelectItem>
                <SelectItem value="topic">Topic</SelectItem>
                <SelectItem value="status">Status</SelectItem>
              </SelectContent>
            </Select>
            
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            >
              {sortOrder === 'asc' ? (
                <SortAsc className="h-4 w-4" />
              ) : (
                <SortDesc className="h-4 w-4" />
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Projects List */}
      {error ? (
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-red-600">Failed to load projects: {error}</p>
            <Button variant="outline" onClick={loadProjects} className="mt-4">
              Try Again
            </Button>
          </CardContent>
        </Card>
      ) : filteredProjects.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center py-12">
            <History className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-medium mb-2">
              {searchQuery || statusFilter !== 'all' ? 'No projects found' : 'No projects yet'}
            </h3>
            <p className="text-muted-foreground mb-4">
              {searchQuery || statusFilter !== 'all' 
                ? 'Try adjusting your search or filters'
                : 'Start by generating your first research paper'
              }
            </p>
            {!searchQuery && statusFilter === 'all' && (
              <Button onClick={() => router.push('/generate')}>
                <Plus className="h-4 w-4 mr-2" />
                Generate Your First Paper
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredProjects.map(project => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}

      {/* Project Details Dialog */}
      {selectedProject && (
        <Dialog open={!!selectedProject} onOpenChange={() => setSelectedProject(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{selectedProject.topic}</DialogTitle>
              <DialogDescription>
                Project created on {format(new Date(selectedProject.created_at), 'PPP')}
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Badge variant={getStatusColor(selectedProject.status)}>
                  {selectedProject.status}
                </Badge>
                {selectedProject.latest_version?.word_count && (
                  <span className="text-sm text-muted-foreground">
                    {selectedProject.latest_version.word_count} words
                  </span>
                )}
              </div>
              
              <div className="flex gap-2">
                <Button onClick={() => viewProject(selectedProject.id)}>
                  <Edit3 className="h-4 w-4 mr-2" />
                  Edit Paper
                </Button>
                {selectedProject.status === 'complete' && (
                  <>
                    <Button variant="outline" onClick={() => downloadProject(selectedProject)}>
                      <Download className="h-4 w-4 mr-2" />
                      Download
                    </Button>
                    <Button variant="outline" onClick={() => shareProject(selectedProject)}>
                      <Share2 className="h-4 w-4 mr-2" />
                      Share
                    </Button>
                  </>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
} 