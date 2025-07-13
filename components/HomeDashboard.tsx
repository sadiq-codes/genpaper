'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { 
  Home, 
  BookOpen, 
  Settings, 
  Upload,
  FileText,
  Clock,
  CheckCircle,
  AlertCircle,
  MoreHorizontal,
  Menu,
  X,
  Sparkles,
  LogOut,
  FolderOpen,
  ArrowRight,
  Zap,
  Target,
  Lightbulb
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import type { ResearchProjectWithLatestVersion, PaperStatus } from '@/types/simplified'
import { LoadingSpinner } from '@/components/ui/loading-spinner'

interface GenerationState {
  topic: string
  paperType: 'researchArticle' | 'literatureReview' | 'capstoneProject' | 'mastersThesis' | 'phdDissertation'
  selectedPapers: string[]
}

interface GenerationProgress {
  stage: 'idle' | 'creating' | 'generating' | 'complete' | 'error'
  progress: number
  message: string
  projectId?: string
  error?: string
}

// Helper function to determine paper type from generation config
const getPaperType = (project: ResearchProjectWithLatestVersion): string => {
  const paperType = project.generation_config?.paper_settings?.paperType
  switch (paperType) {
    case 'researchArticle': return 'Research Article'
    case 'literatureReview': return 'Literature Review'
    case 'capstoneProject': return 'Capstone Project'
    case 'mastersThesis': return 'Master\'s Thesis'
    case 'phdDissertation': return 'PhD Dissertation'
    default: return 'Research Article'
  }
}

// Helper function to get appropriate icon for paper type
const getPaperIcon = (project: ResearchProjectWithLatestVersion): string => {
  const paperType = project.generation_config?.paper_settings?.paperType
  switch (paperType) {
    case 'researchArticle': return '📊'
    case 'literatureReview': return '📚'
    case 'capstoneProject': return '🎓'
    case 'mastersThesis': return '📖'
    case 'phdDissertation': return '📄'
    default: return '📊'
  }
}

// Helper function to format last modified date
const formatLastModified = (dateString: string): string => {
  const date = new Date(dateString)
  const now = new Date()
  const diffInMs = now.getTime() - date.getTime()
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24))
  const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60))
  const diffInMinutes = Math.floor(diffInMs / (1000 * 60))

  if (diffInDays > 0) {
    return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`
  } else if (diffInHours > 0) {
    return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`
  } else if (diffInMinutes > 0) {
    return `${diffInMinutes} minute${diffInMinutes > 1 ? 's' : ''} ago`
  } else {
    return 'Just now'
  }
}

const QUICK_PROMPTS = [
  'Write a literature review about',
  'Research article on the effects of',
  'Analysis of recent developments in',
  'Comparative study of',
  'Impact of technology on'
]

const PAPER_TYPES = [
  {
    id: 'researchArticle',
    title: 'Research Article',
    description: 'Traditional academic paper (8-12 pages)',
    popular: true
  },
  {
    id: 'literatureReview',
    title: 'Literature Review', 
    description: 'Comprehensive analysis of existing research (10-15 pages)'
  },
  {
    id: 'capstoneProject',
    title: 'Capstone Project',
    description: 'Final-year project proposal (6-10 pages)'
  },
  {
    id: 'mastersThesis',
    title: "Master's Thesis",
    description: 'Multi-chapter research document (20-30 pages)'
  },
  {
    id: 'phdDissertation',
    title: 'PhD Dissertation',
    description: 'Extensive research document (40-60 pages)'
  }
]

export default function HomeDashboard() {
  const router = useRouter()
  const abortControllerRef = useRef<AbortController | null>(null)
  
  // User and UI state
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState<ResearchProjectWithLatestVersion[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [currentRoute, setCurrentRoute] = useState('home')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Generation state
  const [generationState, setGenerationState] = useState<GenerationState>({
    topic: '',
    paperType: 'researchArticle',
    selectedPapers: []
  })
  
  const [progress, setProgress] = useState<GenerationProgress>({
    stage: 'idle',
    progress: 0,
    message: ''
  })
  
  const supabase = createClient()

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
      setLoading(false)
      
      // Load projects after user is authenticated
      if (user) {
        await loadProjects()
      }
    }
    getUser()
  }, [supabase.auth])

  const loadProjects = async () => {
    setProjectsLoading(true)
    setProjectsError(null)
    
    try {
      const response = await fetch('/api/projects?limit=6', { 
        credentials: 'include' 
      })
      
      if (!response.ok) {
        throw new Error(`Failed to load projects: ${response.status}`)
      }
      
      const data = await response.json()
      setProjects(data.projects || [])
    } catch (error) {
      console.error('Error loading projects:', error)
      setProjectsError(error instanceof Error ? error.message : 'Failed to load projects')
    } finally {
      setProjectsLoading(false)
    }
  }



  // Validation
  const isValidTopic = generationState.topic.trim().length > 10
  const canGenerate = isValidTopic && progress.stage === 'idle'

  const updateGenerationState = useCallback((updates: Partial<GenerationState>) => {
    setGenerationState(prev => ({ ...prev, ...updates }))
  }, [])

  // Handle quick prompt selection
  const handleQuickPrompt = useCallback((prompt: string) => {
    updateGenerationState({ topic: `${prompt} ` })
    // Focus textarea
    setTimeout(() => {
      const textarea = document.getElementById('topic-input') as HTMLTextAreaElement
      if (textarea) {
        textarea.focus()
        textarea.setSelectionRange(textarea.value.length, textarea.value.length)
      }
    }, 50)
  }, [updateGenerationState])

  // Streamlined generation - create project and start generation immediately
  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return

    // Abort any existing generation
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    try {
      // Step 1: Create project immediately (optimistic)
      setProgress({
        stage: 'creating',
        progress: 10,
        message: 'Creating your research project...'
      })

      const createResponse = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: abortControllerRef.current.signal,
        body: JSON.stringify({
          topic: generationState.topic.trim(),
          paperType: generationState.paperType,
          selectedPapers: generationState.selectedPapers
        })
      })

      if (!createResponse.ok) {
        throw new Error('Failed to create project')
      }

      const { project } = await createResponse.json()
      const projectId = project.id

      setProgress({
        stage: 'creating',
        progress: 25,
        message: 'Project created! Starting AI generation...',
        projectId
      })

      // Step 2: Start streaming generation immediately
      setProgress({
        stage: 'generating',
        progress: 30,
        message: 'Analyzing your topic and finding relevant sources...',
        projectId
      })

      const generateResponse = await fetch('/api/generate/unified', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: abortControllerRef.current.signal,
        body: JSON.stringify({
          projectId,
          topic: generationState.topic.trim(),
          paperType: generationState.paperType,
          selectedPapers: generationState.selectedPapers,
          stream: true
        })
      })

      if (!generateResponse.ok) {
        throw new Error('Failed to start generation')
      }

      // Step 3: Stream progress updates
      const reader = generateResponse.body?.getReader()
      if (!reader) throw new Error('No response stream')

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = new TextDecoder().decode(value)
        const lines = chunk.split('\n').filter(line => line.trim())

        for (const line of lines) {
          try {
            const data = JSON.parse(line)

            if (data.type === 'progress') {
              setProgress({
                stage: 'generating',
                progress: Math.min(30 + (data.progress * 0.6), 90), // 30-90% range
                message: data.message || 'Generating content...',
                projectId
              })
            } else if (data.type === 'complete') {
              setProgress({
                stage: 'complete',
                progress: 100,
                message: 'Paper generated successfully! Opening editor...',
                projectId
              })

              // Refresh projects list
              await loadProjects()

              // Navigate to project editor after short delay
              setTimeout(() => {
                router.push(`/projects/${projectId}`)
              }, 1500)
              return
            } else if (data.type === 'error') {
              throw new Error(data.message || 'Generation failed')
            }
          } catch (parseError) {
            console.warn('Failed to parse progress data:', parseError)
          }
        }
      }
    } catch (error) {
      console.error('Generation failed:', error)
      setProgress({
        stage: 'error',
        progress: 0,
        message: 'Generation failed. Please try again.',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }, [canGenerate, generationState, loadProjects, router])

  // Cancel generation
  const handleCancelGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    setProgress({
      stage: 'idle',
      progress: 0,
      message: ''
    })
  }, [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const getStatusBadge = (status: PaperStatus) => {
    switch (status) {
      case 'complete':
        return <Badge className="bg-green-100 text-green-700 border-green-200"><CheckCircle className="w-3 h-3 mr-1"/> Complete</Badge>
      case 'generating':
        return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200"><Clock className="w-3 h-3 mr-1"/> Generating</Badge>
      case 'failed':
        return <Badge className="bg-red-100 text-red-700 border-red-200"><AlertCircle className="w-3 h-3 mr-1"/> Failed</Badge>
      default:
        return null
    }
  }

  if (loading) {
    return (
      <LoadingSpinner size="lg" text="Loading dashboard..." fullScreen />
    )
  }

  if (!user) {
    router.push('/login')
    return null
  }

  return (
    <div className="flex h-screen bg-white font-['Inter',system-ui,sans-serif]">
      {/* Mobile Top Bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Sparkles className="h-6 w-6 text-gray-900" />
          <span className="text-lg font-semibold text-gray-900">GenPaper</span>
        </div>
        <div className="flex items-center space-x-2">
          {/* User Menu Mobile */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-gray-900 text-white text-sm">
                    {user?.email?.charAt(0).toUpperCase() || 'U'}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end">
              <div className="flex items-center justify-start gap-2 p-2">
                <div className="flex flex-col space-y-1 leading-none">
                  <p className="font-medium text-sm">{user?.email}</p>
                  <p className="text-xs text-muted-foreground">Researcher</p>
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <button className="w-full cursor-pointer" onClick={() => router.push('/settings')}>
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </button>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <button className="w-full cursor-pointer" onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </button>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Mobile Menu Toggle */}
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden"
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div 
          className="lg:hidden fixed inset-0 z-30 bg-black bg-opacity-50"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* SIDEBAR - Responsive */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-40
        w-60 bg-gray-50 border-r border-gray-200 
        transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 flex flex-col
      `}>
        {/* Desktop Logo */}
        <div className="hidden lg:block px-6 py-4 border-b border-gray-200">
          <div className="flex items-center space-x-2">
            <Sparkles className="h-6 w-6 text-gray-900" />
            <span className="text-lg font-semibold text-gray-900">GenPaper</span>
          </div>
        </div>



        {/* Navigation - Simplified */}
        <nav className="flex-1 px-4 mt-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Quick Actions
          </div>
          <div className="space-y-1">
            <button
              onClick={() => {
                setCurrentRoute('home')
                setSidebarOpen(false)
              }}
              className="w-full flex items-center px-3 py-2 text-sm rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <FileText className="w-4 h-4 mr-3" />
              New Project
            </button>
          </div>
        </nav>

        {/* Plan Widget */}
        <div className="px-4 py-6 border-t border-gray-200">
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-xs text-gray-600 mb-2">Free Plan</div>
            <div className="text-sm font-medium text-gray-900 mb-1">3 / 10 projects</div>
            <div className="w-full bg-gray-200 rounded-full h-1.5 mb-3">
              <div className="bg-gray-600 h-1.5 rounded-full" style={{ width: '30%' }}></div>
            </div>
            <Button size="sm" variant="outline" className="w-full text-xs border-gray-300">
              Upgrade Plan
            </Button>
          </div>
        </div>

        {/* Desktop User Menu */}
        <div className="hidden lg:block px-4 py-3 border-t border-gray-200">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full justify-start p-2">
                <Avatar className="h-8 w-8 mr-3">
                  <AvatarFallback className="bg-gray-900 text-white text-sm">
                    {user?.email?.charAt(0).toUpperCase() || 'U'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left">
                  <div className="text-sm font-medium truncate">{user?.email}</div>
                  <div className="text-xs text-gray-500">Researcher</div>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end">
              <DropdownMenuItem asChild>
                <button className="w-full cursor-pointer" onClick={() => router.push('/settings')}>
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </button>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <button className="w-full cursor-pointer" onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </button>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* MAIN CONTENT - Responsive */}
      <main className="flex-1 overflow-y-auto pt-16 lg:pt-0">
        {/* Tab Navigation */}
        <div className="border-b border-gray-200 bg-white sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-6">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setCurrentRoute('home')}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  currentRoute === 'home'
                    ? 'border-gray-900 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Home className="w-4 h-4 mr-2 inline" />
                Home
              </button>
              <button
                onClick={() => setCurrentRoute('projects')}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  currentRoute === 'projects'
                    ? 'border-gray-900 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <FolderOpen className="w-4 h-4 mr-2 inline" />
                Projects
              </button>
              <button
                onClick={() => setCurrentRoute('library')}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  currentRoute === 'library'
                    ? 'border-gray-900 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <BookOpen className="w-4 h-4 mr-2 inline" />
                Library
              </button>
            </nav>
          </div>
        </div>

        {/* Tab Content */}
        {currentRoute === 'home' && (
          <>
            {/* Generation Interface */}
            <section className="max-w-2xl mx-auto mt-12 px-6">
              {progress.stage === 'idle' ? (
                <>
                  <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                    Hi {user?.user_metadata?.first_name || user?.email?.split('@')[0]}, what would you like to write?
                  </h2>

                  {/* Topic Input */}
                  <div className="space-y-4 mb-8">
                    <div className="relative">
                      <textarea
                        id="topic-input"
                        rows={3}
                        value={generationState.topic}
                        onChange={(e) => updateGenerationState({ topic: e.target.value })}
                        placeholder="Describe your research topic, question, or area of interest..."
                        className="w-full p-4 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent resize-none shadow-sm"
                      />
                      <div className="absolute bottom-3 right-3 text-xs text-gray-400">
                        {generationState.topic.length}/500
                      </div>
                    </div>

                    {/* Controls */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <select
                          value={generationState.paperType}
                          onChange={(e) => updateGenerationState({ paperType: e.target.value as any })}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent"
                        >
                          {PAPER_TYPES.map(type => (
                            <option key={type.id} value={type.id}>
                              {type.title}
                              {type.popular && ' ⭐'}
                            </option>
                          ))}
                        </select>
                        
                        <Button variant="outline" size="sm" className="border-gray-300">
                          <Upload className="w-4 h-4 mr-2" />
                          Add Sources
                        </Button>
                      </div>

                      <Button 
                        onClick={handleGenerate}
                        disabled={!canGenerate}
                        className="bg-gray-900 hover:bg-gray-800 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Sparkles className="w-4 h-4 mr-2" />
                        Generate Paper
                      </Button>
                    </div>

                    {/* Quick Prompts */}
                    <div className="space-y-2">
                      <div className="text-sm text-gray-500 mb-2">Quick starts:</div>
                      <div className="flex flex-wrap gap-2">
                        {QUICK_PROMPTS.map(prompt => (
                          <button
                            key={prompt}
                            onClick={() => handleQuickPrompt(prompt)}
                            className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-full text-sm text-gray-700 transition-colors"
                          >
                            {prompt}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Validation message */}
                    {generationState.topic.trim().length > 0 && generationState.topic.trim().length <= 10 && (
                      <div className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-3">
                        <Lightbulb className="w-4 h-4 inline mr-2" />
                        Please provide a more detailed description (at least 10 characters)
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {/* Generation Progress */}
                  <div className="text-center space-y-6">
                    <div className="space-y-2">
                      <h2 className="text-2xl font-semibold text-gray-900">
                        {progress.stage === 'creating' && 'Creating Project'}
                        {progress.stage === 'generating' && 'Generating Paper'}
                        {progress.stage === 'complete' && 'Complete!'}
                        {progress.stage === 'error' && 'Generation Failed'}
                      </h2>
                      <p className="text-gray-600">{progress.message}</p>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full max-w-md mx-auto">
                      <Progress value={progress.progress} className="h-3" />
                      <div className="text-sm text-gray-500 mt-2">{progress.progress}%</div>
                    </div>

                    {/* Status Icons */}
                    <div className="flex justify-center space-x-8">
                      <div className={`flex flex-col items-center space-y-2 ${
                        progress.stage === 'creating' ? 'text-blue-600' : 
                        progress.progress >= 25 ? 'text-green-600' : 'text-gray-400'
                      }`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          progress.progress >= 25 ? 'bg-green-100' : 'bg-gray-100'
                        }`}>
                          {progress.progress >= 25 ? <CheckCircle className="w-5 h-5" /> : <Target className="w-5 h-5" />}
                        </div>
                        <span className="text-xs">Project</span>
                      </div>

                      <div className={`flex flex-col items-center space-y-2 ${
                        progress.stage === 'generating' ? 'text-blue-600' : 
                        progress.progress >= 90 ? 'text-green-600' : 'text-gray-400'
                      }`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          progress.progress >= 90 ? 'bg-green-100' : 'bg-gray-100'
                        }`}>
                          {progress.progress >= 90 ? <CheckCircle className="w-5 h-5" /> : <Zap className="w-5 h-5" />}
                        </div>
                        <span className="text-xs">Generate</span>
                      </div>

                      <div className={`flex flex-col items-center space-y-2 ${
                        progress.stage === 'complete' ? 'text-green-600' : 'text-gray-400'
                      }`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          progress.stage === 'complete' ? 'bg-green-100' : 'bg-gray-100'
                        }`}>
                          <ArrowRight className="w-5 h-5" />
                        </div>
                        <span className="text-xs">Edit</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex justify-center space-x-4">
                      {progress.stage === 'error' ? (
                        <>
                          <Button variant="outline" onClick={() => setProgress({ stage: 'idle', progress: 0, message: '' })}>
                            Try Again
                          </Button>
                          <Button onClick={handleGenerate} disabled={!canGenerate}>
                            Retry Generation
                          </Button>
                        </>
                      ) : progress.stage !== 'complete' ? (
                        <Button variant="outline" onClick={handleCancelGeneration}>
                          Cancel
                        </Button>
                      ) : (
                        progress.projectId && (
                          <Button onClick={() => router.push(`/projects/${progress.projectId}`)}>
                            Open Project
                          </Button>
                        )
                      )}
                    </div>

                    {/* Error Details */}
                    {progress.stage === 'error' && progress.error && (
                      <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 max-w-md mx-auto">
                        <AlertCircle className="w-4 h-4 inline mr-2" />
                        {progress.error}
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>

        {/* Projects Section */}
        <section className="max-w-6xl mx-auto mt-16 px-6 pb-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">Your Projects</h2>
            <Button variant="outline" size="sm" onClick={() => setCurrentRoute('projects')}>
              View All
            </Button>
          </div>

          {/* Projects Grid */}
          {projectsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map(i => (
                <Card key={i} className="border border-gray-200 rounded-lg">
                  <CardHeader className="pb-3">
                    <div className="animate-pulse">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-gray-200 rounded"></div>
                        <div className="flex-1">
                          <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                          <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="animate-pulse">
                      <div className="flex items-center justify-between">
                        <div className="h-6 bg-gray-200 rounded w-20"></div>
                        <div className="h-3 bg-gray-200 rounded w-16"></div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : projectsError ? (
            <div className="text-center py-12">
              <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Failed to load projects</h3>
              <p className="text-gray-500 mb-4">{projectsError}</p>
              <Button onClick={loadProjects} variant="outline">
                Try Again
              </Button>
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No projects yet</h3>
              <p className="text-gray-500 mb-4">Create your first research paper to get started</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {projects.map(project => (
                <Card 
                  key={project.id}
                  className="border border-gray-200 rounded-lg hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => router.push(`/projects/${project.id}`)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="text-2xl">{getPaperIcon(project)}</div>
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-base font-medium text-gray-900 truncate">
                            {project.topic}
                          </CardTitle>
                          <CardDescription className="text-sm text-gray-500">
                            {getPaperType(project)}
                          </CardDescription>
                        </div>
                      </div>
                      <button 
                        className="p-1 hover:bg-gray-100 rounded-full"
                        onClick={(e) => {
                          e.stopPropagation()
                          // TODO: Open context menu
                        }}
                      >
                        <MoreHorizontal className="w-4 h-4 text-gray-400" />
                      </button>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        {getStatusBadge(project.status)}
                        <Badge variant="outline" className="text-xs">
                          🔒 Private
                        </Badge>
                      </div>
                      <span className="text-xs text-gray-500">
                        {formatLastModified(project.created_at)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
          </>
        )}

        {/* Projects Tab */}
        {currentRoute === 'projects' && (
          <section className="max-w-6xl mx-auto mt-12 px-6 pb-12">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-semibold text-gray-900">All Projects</h2>
              <Button onClick={() => setCurrentRoute('home')} className="bg-gray-900 hover:bg-gray-800 text-white">
                <FileText className="w-4 h-4 mr-2" />
                New Project
              </Button>
            </div>

            {/* Projects Grid - All Projects */}
            {projectsLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3, 4, 5, 6].map(i => (
                  <Card key={i} className="border border-gray-200 rounded-lg">
                    <CardHeader className="pb-3">
                      <div className="animate-pulse">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 bg-gray-200 rounded"></div>
                          <div className="flex-1">
                            <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                            <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="animate-pulse">
                        <div className="flex items-center justify-between">
                          <div className="h-6 bg-gray-200 rounded w-20"></div>
                          <div className="h-3 bg-gray-200 rounded w-16"></div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : projectsError ? (
              <div className="text-center py-12">
                <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">Failed to load projects</h3>
                <p className="text-gray-500 mb-4">{projectsError}</p>
                <Button onClick={loadProjects} variant="outline">
                  Try Again
                </Button>
              </div>
            ) : projects.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No projects yet</h3>
                <p className="text-gray-500 mb-4">Create your first research paper to get started</p>
                <Button onClick={() => setCurrentRoute('home')} className="bg-gray-900 hover:bg-gray-800 text-white">
                  Create First Project
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {projects.map(project => (
                  <Card 
                    key={project.id}
                    className="border border-gray-200 rounded-lg hover:shadow-md transition-shadow cursor-pointer"
                    onClick={() => router.push(`/projects/${project.id}`)}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center space-x-3">
                          <div className="text-2xl">{getPaperIcon(project)}</div>
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-base font-medium text-gray-900 truncate">
                              {project.topic}
                            </CardTitle>
                            <CardDescription className="text-sm text-gray-500">
                              {getPaperType(project)}
                            </CardDescription>
                          </div>
                        </div>
                        <button 
                          className="p-1 hover:bg-gray-100 rounded-full"
                          onClick={(e) => {
                            e.stopPropagation()
                            // TODO: Open context menu
                          }}
                        >
                          <MoreHorizontal className="w-4 h-4 text-gray-400" />
                        </button>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          {getStatusBadge(project.status)}
                          <Badge variant="outline" className="text-xs">
                            🔒 Private
                          </Badge>
                        </div>
                        <span className="text-xs text-gray-500">
                          {formatLastModified(project.created_at)}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Library Tab */}
        {currentRoute === 'library' && (
          <section className="max-w-6xl mx-auto mt-12 px-6 pb-12">
            <div className="text-center py-12">
              <BookOpen className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Library Coming Soon</h3>
              <p className="text-gray-500 mb-4">Manage your research sources and papers from one place</p>
            </div>
          </section>
        )}
      </main>
    </div>
  )
} 