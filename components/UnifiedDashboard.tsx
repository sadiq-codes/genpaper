'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { 
  BookOpen, 
  Plus,
  FolderOpen,
  Search,
  Filter,
  Grid3X3,
  List
} from 'lucide-react'
import LibraryManager from './LibraryManager'
import HistoryManager from './HistoryManager'

type DashboardView = 'projects' | 'library'
type ProjectsView = 'grid' | 'list'

export default function UnifiedDashboard() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [activeView, setActiveView] = useState<DashboardView>('projects')
  const [projectsView, setProjectsView] = useState<ProjectsView>('grid')
  
  // Get initial view from URL params
  useEffect(() => {
    const tab = searchParams.get('tab')
    
    if (tab === 'sources' || tab === 'library') {
      setActiveView('library')
    } else {
      setActiveView('projects') // Default to projects view
    }
  }, [searchParams])

  // Update URL when view changes
  const handleViewChange = (view: DashboardView, projectId?: string) => {
    setActiveView(view)
    const params = new URLSearchParams()
    
    if (view === 'library') {
      params.set('tab', 'sources')
    }
    
    if (projectId) {
      params.set('projectId', projectId)
    }
    
    const queryString = params.toString()
    router.replace(`/dashboard${queryString ? `?${queryString}` : ''}`)
  }

  const navigation = [
    {
      id: 'projects' as const,
      label: 'Projects',
      icon: FolderOpen,
      description: 'Your research work',
      primary: true
    },
    {
      id: 'library' as const,
      label: 'Library',
      icon: BookOpen,
      description: 'Research sources',
      primary: false
    }
  ]

  const renderProjectsView = () => (
    <div className="space-y-6">
      {/* Projects Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight">Your Research Projects</h2>
          <p className="text-muted-foreground">
            Continue working on existing papers or start a new research project
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          {/* View Toggle */}
          <div className="flex items-center border rounded-lg p-1">
            <Button
              variant={projectsView === 'grid' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setProjectsView('grid')}
              className="h-7 px-2"
            >
              <Grid3X3 className="h-4 w-4" />
            </Button>
            <Button
              variant={projectsView === 'list' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setProjectsView('list')}
              className="h-7 px-2"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
          
          <Button 
            onClick={() => router.push('/generate')}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        </div>
      </div>

      {/* Simplified Actions - Just New Project */}
      <div className="flex justify-center">
        <Card className="cursor-pointer hover:bg-muted/50 transition-colors border-2 border-dashed border-primary/30" onClick={() => router.push('/generate')}>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-primary/10 rounded-lg">
                <Plus className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">Start New Research Paper</CardTitle>
                <CardDescription>Generate a comprehensive academic paper from your research topic</CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>
      </div>

      <Separator />

      {/* Projects List - Use the HistoryManager but with better UX */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Recent Projects</h3>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Filter className="h-4 w-4 mr-2" />
              Filter
            </Button>
            <Button variant="outline" size="sm">
              <Search className="h-4 w-4 mr-2" />
              Search
            </Button>
          </div>
        </div>
        
                        {/* Enhanced Projects List with better loading UX */}
        <HistoryManager />
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        {/* Vertical Sidebar Navigation */}
        <div className="w-64 border-r bg-muted/30 p-6">
          <div className="space-y-1">
            <h1 className="text-xl font-bold mb-6">Dashboard</h1>
            
            {navigation.map((item) => {
              const Icon = item.icon
              const isActive = activeView === item.id
              return (
                <Button
                  key={item.id}
                  variant={isActive ? 'default' : 'ghost'}
                  className={`w-full justify-start gap-3 h-12 ${item.primary ? 'text-base font-medium' : ''}`}
                  onClick={() => handleViewChange(item.id)}
                >
                  <Icon className="h-5 w-5" />
                  <div className="text-left">
                    <div className="font-medium">{item.label}</div>
                    {item.primary && (
                      <div className="text-xs text-muted-foreground">{item.description}</div>
                    )}
                  </div>
                </Button>
              )
            })}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1">
          <div className="max-w-6xl mx-auto p-6">
            {activeView === 'projects' && renderProjectsView()}
            
            {activeView === 'library' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold">Research Library</h2>
                    <p className="text-muted-foreground">Manage your research sources and references</p>
                  </div>
                  <Button variant="outline" onClick={() => handleViewChange('projects')}>
                    <FolderOpen className="h-4 w-4 mr-2" />
                    Back to Projects
                  </Button>
                </div>
                <LibraryManager />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
} 