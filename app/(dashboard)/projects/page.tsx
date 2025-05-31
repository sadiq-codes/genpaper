"use client"

import { useState, useEffect, useCallback } from "react"
import { supabase } from '@/lib/supabase/client'
import { CreateProjectForm } from '@/app/(dashboard)/projects/CreateProjectForm'
import Link from 'next/link'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Zap,
  HelpCircle,
  MoreHorizontal,
  Plus,
  Search,
  Grid3X3,
  List,
  Sparkles,
  CheckCircle,
  AlertCircle,
  FileText,
  Edit3,
  Star,
  Users,
  Download,
  Share2,
  Eye,
  PenTool,
  BookOpen,
  Target,
  TrendingUp,
  X,
} from "lucide-react"
import { 
  fetchProjects, 
  toggleProjectStar, 
  updateProjectStatus, 
  exportProject, 
  shareProject,
  getProjectStats,
  fetchRecentActivities,
  fetchAITasks,
  addProjectActivity,
  simulateAITask,
  type Project,
  type ProjectStatus,
  type ProjectActivity,
  type AITask
} from '@/lib/projects'

const statusConfig = {
  "ai-drafting": {
    label: "AI Drafting",
    color: "bg-blue-100 text-blue-800",
    icon: Sparkles,
    description: "AI is actively generating content",
  },
  "literature-ready": {
    label: "Literature Ready",
    color: "bg-green-100 text-green-800",
    icon: BookOpen,
    description: "Ready for literature review",
  },
  "citations-needed": {
    label: "Citations Needed",
    color: "bg-yellow-100 text-yellow-800",
    icon: AlertCircle,
    description: "Requires additional citations",
  },
  draft: {
    label: "Draft",
    color: "bg-orange-100 text-orange-800",
    icon: Edit3,
    description: "In draft stage",
  },
  review: {
    label: "Under Review",
    color: "bg-purple-100 text-purple-800",
    icon: Eye,
    description: "Under review",
  },
  completed: {
    label: "Completed",
    color: "bg-gray-100 text-gray-800",
    icon: CheckCircle,
    description: "Project completed",
  },
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [searchQuery, setSearchQuery] = useState("")
  const [filterStatus, setFilterStatus] = useState("all")
  const [sortBy, setSortBy] = useState("modified")
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [stats, setStats] = useState({
    total: 0,
    aiDrafting: 0,
    completed: 0,
    citationsNeeded: 0
  })
  const [recentActivities, setRecentActivities] = useState<ProjectActivity[]>([])
  const [aiTasksByProject, setAITasksByProject] = useState<Record<string, number>>({})

  // Load projects and stats
  const loadData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      
      if (user) {
        const [projectsData, statsData, recentActivitiesData, aiTasksData] = await Promise.all([
          fetchProjects(user.id),
          getProjectStats(user.id),
          fetchRecentActivities(user.id),
          fetchAITasks(user.id)
        ])
        
        setProjects(projectsData)
        setStats(statsData)
        setRecentActivities(recentActivitiesData)
        
        // Count AI tasks per project
        const tasksByProject: Record<string, number> = {}
        aiTasksData.forEach(task => {
          const count = tasksByProject[task.project_id] || 0
          tasksByProject[task.project_id] = count + 1
        })
        setAITasksByProject(tasksByProject)
      }
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Project action handlers with activity tracking
  const handleToggleStar = async (projectId: string, currentStarred: boolean) => {
    try {
      await toggleProjectStar(projectId, !currentStarred)
      
      // Add activity
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await addProjectActivity(
          projectId, 
          user.id, 
          currentStarred ? 'unstarred_project' : 'starred_project',
          currentStarred ? 'Removed project from favorites' : 'Added project to favorites'
        )
      }
      
      await loadData() // Refresh data
    } catch (error) {
      console.error('Error toggling star:', error)
    }
  }

  const handleStatusChange = async (projectId: string, status: ProjectStatus) => {
    try {
      await updateProjectStatus(projectId, status)
      
      // Add activity
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await addProjectActivity(
          projectId, 
          user.id, 
          'status_changed',
          `Changed project status to ${status}`
        )
      }
      
      await loadData() // Refresh data
    } catch (error) {
      console.error('Error updating status:', error)
    }
  }

  const handleExport = async (projectId: string) => {
    try {
      await exportProject(projectId)
    } catch (error) {
      console.error('Error exporting project:', error)
    }
  }

  const handleShare = async (projectId: string) => {
    // For now, just log - you can implement a share modal later
    const email = prompt('Enter email to share with:')
    if (email) {
      try {
        await shareProject(projectId, email)
        console.log('Project shared with:', email)
      } catch (error) {
        console.error('Error sharing project:', error)
      }
    }
  }

  // Test function for AI tasks
  const handleSimulateAITask = async (projectId: string) => {
    try {
      await simulateAITask(projectId, 'content_generation')
      await loadData() // Refresh to show new AI task
    } catch (error) {
      console.error('Error simulating AI task:', error)
    }
  }

  const filteredProjects = projects.filter((project) => {
    const matchesSearch =
      project.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (project.description && project.description.toLowerCase().includes(searchQuery.toLowerCase()))

    const matchesFilter = filterStatus === "all" || project.status === filterStatus

    return matchesSearch && matchesFilter
  })

  const sortedProjects = [...filteredProjects].sort((a, b) => {
    switch (sortBy) {
      case "modified":
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      case "created":
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      case "title":
        return a.title.localeCompare(b.title)
      case "progress":
        return b.progress - a.progress
      default:
        return 0
    }
  })

  const getStatusInfo = (status: string) => statusConfig[status as keyof typeof statusConfig]

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading projects...</p>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Main Content */}
      <div className="flex-1 flex">
        {/* Projects Content */}
        <div className="flex-1 flex flex-col">
          {/* Controls Bar */}
          <div className="border-b border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    placeholder="Search projects..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 w-64 h-10 rounded-xl border-2 border-gray-200 focus:border-blue-400"
                  />
                </div>

                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="h-10 px-3 rounded-xl border-2 border-gray-200 focus:border-blue-400 bg-white text-sm"
                >
                  <option value="all">All Status</option>
                  <option value="ai-drafting">AI Drafting</option>
                  <option value="literature-ready">Literature Ready</option>
                  <option value="citations-needed">Citations Needed</option>
                  <option value="draft">Draft</option>
                  <option value="review">Under Review</option>
                  <option value="completed">Completed</option>
                </select>

                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="h-10 px-3 rounded-xl border-2 border-gray-200 focus:border-blue-400 bg-white text-sm"
                >
                  <option value="modified">Last Modified</option>
                  <option value="created">Date Created</option>
                  <option value="title">Title</option>
                  <option value="progress">Progress</option>
                </select>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-lg">
                  <Button
                    variant={viewMode === "grid" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => setViewMode("grid")}
                  >
                    <Grid3X3 className="w-4 h-4" />
                  </Button>
                  <Button
                    variant={viewMode === "list" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => setViewMode("list")}
                  >
                    <List className="w-4 h-4" />
                  </Button>
                </div>

                <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => setShowCreateModal(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  New Project
                </Button>
              </div>
            </div>
          </div>

          {/* Projects Display */}
          <div className="flex-1 p-6">
            {sortedProjects.length === 0 ? (
              /* Empty State */
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center max-w-md">
                  <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
                    <FileText className="w-12 h-12 text-gray-400" />
                  </div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">
                    {searchQuery || filterStatus !== "all" ? "No projects found" : "Start Your First Research Project"}
                  </h2>
                  <p className="text-gray-600 mb-8">
                    {searchQuery || filterStatus !== "all"
                      ? "Try adjusting your search or filter criteria"
                      : "Create your first research project and let AI help you write, research, and cite your way to success."}
                  </p>
                  <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => setShowCreateModal(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Create Your First Project
                  </Button>
                </div>
              </div>
            ) : viewMode === "grid" ? (
              /* Grid View */
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {sortedProjects.map((project) => {
                  const statusInfo = getStatusInfo(project.status)
                  return (
                    <Card
                      key={project.id}
                      className="group cursor-pointer hover:shadow-lg transition-all duration-200 border border-gray-200"
                    >
                      <CardContent className="p-6">
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="font-semibold text-lg text-gray-900 line-clamp-2">{project.title}</h3>
                              {project.starred && (
                                <Star 
                                  className="w-4 h-4 text-yellow-500 fill-current cursor-pointer" 
                                  onClick={() => handleToggleStar(project.id, project.starred)}
                                />
                              )}
                              {!project.starred && (
                                <Star 
                                  className="w-4 h-4 text-gray-400 cursor-pointer hover:text-yellow-500" 
                                  onClick={() => handleToggleStar(project.id, project.starred)}
                                />
                              )}
                            </div>
                            <p className="text-sm text-gray-600 line-clamp-2 mb-3">{project.description}</p>

                            <div className="flex items-center gap-2 mb-3">
                              <Badge className={statusInfo.color}>
                                <statusInfo.icon className="w-3 h-3 mr-1" />
                                {statusInfo.label}
                              </Badge>
                              {(aiTasksByProject[project.id] || 0) > 0 && (
                                <Badge className="bg-blue-100 text-blue-800">
                                  <Sparkles className="w-3 h-3 mr-1" />
                                  {aiTasksByProject[project.id]} AI tasks
                                </Badge>
                              )}
                            </div>
                          </div>

                          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button variant="ghost" size="icon" className="w-8 h-8">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-500">Progress</span>
                            <span className="font-medium">{project.progress}%</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${project.progress}%` }}
                            />
                          </div>

                          <div className="flex items-center justify-between text-sm text-gray-500">
                            <div className="flex items-center gap-4">
                              <span>{(project.wordCount || 0).toLocaleString()} words</span>
                              <span>{project.citations || 0} citations</span>
                              {(project.collaborators || 0) > 0 && (
                                <div className="flex items-center gap-1">
                                  <Users className="w-3 h-3" />
                                  <span>{project.collaborators}</span>
                                </div>
                              )}
                            </div>
                            <span>{project.lastModified}</span>
                          </div>

                          <div className="flex flex-wrap gap-1">
                            <Badge variant="secondary" className="text-xs">
                              {project.tags}
                            </Badge>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 mt-4 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Link href={`/projects/${project.id}`} className="flex-1">
                            <Button size="sm" className="bg-blue-600 hover:bg-blue-700 w-full">
                              <PenTool className="w-3 h-3 mr-1" />
                              Open
                            </Button>
                          </Link>
                          <Button size="sm" variant="outline" onClick={() => handleShare(project.id)}>
                            <Share2 className="w-3 h-3" />
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleExport(project.id)}>
                            <Download className="w-3 h-3" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            ) : (
              /* List View */
              <div className="space-y-3">
                {sortedProjects.map((project) => {
                  const statusInfo = getStatusInfo(project.status)
                  return (
                    <Card
                      key={project.id}
                      className="group cursor-pointer hover:shadow-md transition-shadow border border-gray-200"
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <h3 className="font-semibold text-gray-900">{project.title}</h3>
                              {project.starred && (
                                <Star 
                                  className="w-4 h-4 text-yellow-500 fill-current cursor-pointer" 
                                  onClick={() => handleToggleStar(project.id, project.starred)}
                                />
                              )}
                              {!project.starred && (
                                <Star 
                                  className="w-4 h-4 text-gray-400 cursor-pointer hover:text-yellow-500" 
                                  onClick={() => handleToggleStar(project.id, project.starred)}
                                />
                              )}
                              <Badge className={statusInfo.color}>
                                <statusInfo.icon className="w-3 h-3 mr-1" />
                                {statusInfo.label}
                              </Badge>
                              {(aiTasksByProject[project.id] || 0) > 0 && (
                                <Badge className="bg-blue-100 text-blue-800">
                                  <Sparkles className="w-3 h-3 mr-1" />
                                  {aiTasksByProject[project.id]} AI tasks
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-gray-600 mb-2">{project.description}</p>
                            <div className="flex items-center gap-6 text-sm text-gray-500">
                              <span>{(project.wordCount || 0).toLocaleString()} words</span>
                              <span>{project.citations || 0} citations</span>
                              <span>{project.progress}% complete</span>
                              {(project.collaborators || 0) > 0 && (
                                <div className="flex items-center gap-1">
                                  <Users className="w-3 h-3" />
                                  <span>{project.collaborators} collaborators</span>
                                </div>
                              )}
                              <span>Modified {project.lastModified}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Link href={`/projects/${project.id}`}>
                              <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
                                <PenTool className="w-3 h-3 mr-1" />
                                Open
                              </Button>
                            </Link>
                            <Button size="sm" variant="outline">
                              <Edit3 className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleShare(project.id)}>
                              <Share2 className="w-3 h-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="w-8 h-8">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar - Quick Stats & Actions */}
        <div className="w-80 border-l border-gray-200 bg-gray-50">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-white">
            <h3 className="font-semibold text-gray-900">Overview</h3>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="w-4 h-4 text-gray-500" />
            </Button>
          </div>

          <div className="p-4 space-y-4">
            {/* Quick Stats */}
            <div className="grid grid-cols-2 gap-3">
              <Card className="border border-gray-200">
                <CardContent className="p-3 text-center">
                  <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
                  <div className="text-xs text-gray-500">Total Projects</div>
                </CardContent>
              </Card>
              <Card className="border border-gray-200">
                <CardContent className="p-3 text-center">
                  <div className="text-2xl font-bold text-blue-600">{stats.aiDrafting}</div>
                  <div className="text-xs text-gray-500">AI Active</div>
                </CardContent>
              </Card>
              <Card className="border border-gray-200">
                <CardContent className="p-3 text-center">
                  <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
                  <div className="text-xs text-gray-500">Completed</div>
                </CardContent>
              </Card>
              <Card className="border border-gray-200">
                <CardContent className="p-3 text-center">
                  <div className="text-2xl font-bold text-orange-600">{stats.citationsNeeded}</div>
                  <div className="text-xs text-gray-500">Need Citations</div>
                </CardContent>
              </Card>
            </div>

            {/* Quick Actions */}
            <div className="space-y-3">
              <h4 className="font-semibold text-gray-900 text-sm">Quick Actions</h4>
              <Button className="w-full bg-blue-600 hover:bg-blue-700 justify-start" onClick={() => setShowCreateModal(true)}>
                <Plus className="w-4 h-4 mr-2" />
                New Project
              </Button>
              <Button variant="outline" className="w-full justify-start">
                <FileText className="w-4 h-4 mr-2" />
                Import Document
              </Button>
              <Button variant="outline" className="w-full justify-start">
                <Target className="w-4 h-4 mr-2" />
                Browse Templates
              </Button>
            </div>

            {/* Recent Activity */}
            <div className="space-y-3">
              <h4 className="font-semibold text-gray-900 text-sm">Recent Activity</h4>
              <div className="space-y-2">
                {recentActivities.length > 0 ? (
                  recentActivities.map((activity) => {
                    // Choose icon based on activity type
                    let ActivityIcon = Sparkles
                    let iconColor = "text-blue-600"
                    
                    switch (activity.activity_type) {
                      case 'project_created':
                        ActivityIcon = Plus
                        iconColor = "text-green-600"
                        break
                      case 'starred_project':
                        ActivityIcon = Star
                        iconColor = "text-yellow-600"
                        break
                      case 'status_changed':
                        ActivityIcon = CheckCircle
                        iconColor = "text-purple-600"
                        break
                      case 'ai_task_started':
                        ActivityIcon = Sparkles
                        iconColor = "text-blue-600"
                        break
                      default:
                        ActivityIcon = FileText
                        iconColor = "text-gray-600"
                    }
                    
                    return (
                      <div key={activity.id} className="p-2 bg-white rounded border border-gray-200">
                        <div className="flex items-center gap-2 mb-1">
                          <ActivityIcon className={`w-3 h-3 ${iconColor}`} />
                          <span className="text-xs font-medium text-gray-900">{activity.title}</span>
                        </div>
                        <p className="text-xs text-gray-600">{activity.description}</p>
                        <p className="text-xs text-gray-500">{activity.lastModified}</p>
                      </div>
                    )
                  })
                ) : (
                  <div className="p-3 text-center">
                    <p className="text-xs text-gray-500">No recent activity</p>
                    <p className="text-xs text-gray-400 mt-1">Start working on projects to see activity here</p>
                  </div>
                )}
              </div>
            </div>

            {/* AI Insights */}
            <div className="space-y-3">
              <h4 className="font-semibold text-gray-900 text-sm">AI Insights</h4>
              <Card className="border border-blue-200 bg-blue-50">
                <CardContent className="p-3">
                  <div className="flex items-start gap-2">
                    <TrendingUp className="w-4 h-4 text-blue-600 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-blue-900 mb-1">Productivity Tip</p>
                      <p className="text-xs text-blue-800">
                        You&apos;re 23% more productive when using AI drafting. Consider enabling it for your next project.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>

      {/* Create Project Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center">
          <Card className="w-full max-w-md mx-4">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Create New Project</h2>
                <Button variant="ghost" size="icon" onClick={() => setShowCreateModal(false)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <div className="space-y-4">
                <CreateProjectForm 
                  onSuccess={loadData}
                  onClose={() => setShowCreateModal(false)}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}