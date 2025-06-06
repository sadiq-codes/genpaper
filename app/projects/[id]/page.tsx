import { Metadata } from 'next'
import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PaperViewer from '@/components/PaperViewer'
import { Suspense } from 'react'
import { LoadingSpinner } from '@/components/ui/loading-spinner'

interface ProjectPageProps {
  params: Promise<{
    id: string
  }>
}

export async function generateMetadata({ params }: ProjectPageProps): Promise<Metadata> {
  const { id } = await params
  const supabase = await createClient()
  
  try {
    const { data: project } = await supabase
      .from('research_projects')
      .select('topic')
      .eq('id', id)
      .single()

    if (project) {
      return {
        title: `${project.topic} | Genpaper`,
        description: `Research paper: ${project.topic}`,
      }
    }
  } catch {
    // Fall back to default metadata
  }

  return {
    title: 'Research Paper | Genpaper',
    description: 'View your generated research paper',
  }
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login')
  }

  // Verify project exists and belongs to user
  const { data: project, error: projectError } = await supabase
    .from('research_projects')
    .select('id, user_id, topic, status')
    .eq('id', id)
    .single()

  if (projectError || !project) {
    notFound()
  }

  if (project.user_id !== user.id) {
    redirect('/history')
  }

  return (
    <div className="min-h-screen bg-background">
      <Suspense fallback={<ProjectViewerSkeleton />}>
        <PaperViewer projectId={id} />
      </Suspense>
    </div>
  )
}

function ProjectViewerSkeleton() {
  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="border rounded-lg p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2 flex-1">
            <div className="h-8 bg-muted rounded w-3/4 animate-pulse" />
            <div className="h-4 bg-muted rounded w-1/2 animate-pulse" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-6 bg-muted rounded w-20 animate-pulse" />
            <div className="h-8 bg-muted rounded w-24 animate-pulse" />
            <div className="h-8 bg-muted rounded w-20 animate-pulse" />
            <div className="h-8 bg-muted rounded w-28 animate-pulse" />
          </div>
        </div>
      </div>

      <div className="border rounded-lg p-6">
        <div className="space-y-4">
          <div className="h-6 bg-muted rounded w-1/3 animate-pulse" />
          <div className="space-y-2">
            <div className="h-4 bg-muted rounded w-full animate-pulse" />
            <div className="h-4 bg-muted rounded w-full animate-pulse" />
            <div className="h-4 bg-muted rounded w-3/4 animate-pulse" />
          </div>
          <div className="h-6 bg-muted rounded w-1/4 animate-pulse" />
          <div className="space-y-2">
            <div className="h-4 bg-muted rounded w-full animate-pulse" />
            <div className="h-4 bg-muted rounded w-5/6 animate-pulse" />
          </div>
        </div>
        
        <div className="flex items-center justify-center py-8">
          <LoadingSpinner text="Loading research paper..." />
        </div>
      </div>
    </div>
  )
} 