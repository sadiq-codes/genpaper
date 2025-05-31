'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { QueryErrorBoundary } from '@/components/QueryErrorBoundary'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { 
  ArrowLeft, 
  FileText, 
  RefreshCw, 
  AlertTriangle,
  Home,
  Download,
  Save
} from 'lucide-react'
import { sectionKeys } from '@/lib/tanstack-query/hooks/useSections'
import { citationKeys } from '@/lib/tanstack-query/hooks/useCitations'
import { projectKeys } from '@/lib/tanstack-query/hooks/useProjects'

interface ProjectWorkspaceErrorBoundaryProps {
  children: React.ReactNode
  projectId: string
  projectTitle?: string
}

export function ProjectWorkspaceErrorBoundary({ 
  children, 
  projectId,
  projectTitle = 'Unknown Project'
}: ProjectWorkspaceErrorBoundaryProps) {
  const router = useRouter()

  // Define query keys for this project
  const queryKeys = [
    sectionKeys.byProject(projectId),
    citationKeys.byProject(projectId),
    projectKeys.byId(projectId),
    projectKeys.details(projectId)
  ]

  const handleGoToProjects = () => {
    router.push('/projects')
  }

  const handleReloadProject = () => {
    window.location.reload()
  }

  const handleGoHome = () => {
    router.push('/')
  }

  const handleExportData = () => {
    // In a real app, this would export the project data
    console.log('Exporting project data for recovery...')
    alert('Export functionality would be implemented here to help recover your work.')
  }

  const projectErrorFallback = (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center">
          <div className="mx-auto w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mb-4">
            <FileText className="w-8 h-8 text-orange-600" />
          </div>
          <CardTitle className="text-2xl text-gray-900">
            Project Workspace Error
          </CardTitle>
          <p className="text-gray-600 mt-2">
            We encountered an error while loading your project workspace for "{projectTitle}".
          </p>
        </CardHeader>
        
        <CardContent className="space-y-4">
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Your work is automatically saved. No data should be lost.
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button onClick={handleReloadProject} className="w-full">
              <RefreshCw className="w-4 h-4 mr-2" />
              Reload Project
            </Button>
            
            <Button 
              variant="outline" 
              onClick={handleGoToProjects}
              className="w-full"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Projects
            </Button>
            
            <Button 
              variant="outline" 
              onClick={handleExportData}
              className="w-full"
            >
              <Download className="w-4 h-4 mr-2" />
              Export Data
            </Button>
            
            <Button 
              variant="outline" 
              onClick={handleGoHome}
              className="w-full"
            >
              <Home className="w-4 h-4 mr-2" />
              Go Home
            </Button>
          </div>

          <div className="bg-blue-50 p-4 rounded-lg">
            <h4 className="font-semibold text-blue-900 mb-2">What you can do:</h4>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• Try reloading the project - this fixes most temporary issues</li>
              <li>• Go back to your projects list and try opening it again</li>
              <li>• Export your data as a backup before retrying</li>
              <li>• Contact support if the problem persists</li>
            </ul>
          </div>

          <p className="text-xs text-gray-500 text-center">
            Project ID: <code className="font-mono">{projectId}</code>
          </p>
        </CardContent>
      </Card>
    </div>
  )

  return (
    <ErrorBoundary
      fallback={projectErrorFallback}
      onError={(error, errorInfo) => {
        console.error('Project Workspace Error:', error, errorInfo)
        
        // Log project-specific context
        console.group('📄 Project Context')
        console.error('Project ID:', projectId)
        console.error('Project Title:', projectTitle)
        console.error('URL:', window.location.href)
        console.groupEnd()
      }}
      resetKeys={[projectId]}
    >
      <QueryErrorBoundary queryKeys={queryKeys}>
        {children}
      </QueryErrorBoundary>
    </ErrorBoundary>
  )
} 