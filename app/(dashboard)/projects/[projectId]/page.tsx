import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ProjectWorkspace from './ProjectWorkspace'
import { ProjectWorkspaceErrorBoundary } from './components/ProjectWorkspaceErrorBoundary'

interface PageProps {
  params: Promise<{ projectId: string }>
}

export default async function ProjectPage({ params }: PageProps) {
  const { projectId } = await params
  const supabase = await createClient()

  // Check authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    redirect('/login')
  }

  // Fetch minimal project data
  const { data: project, error } = await supabase
    .from('projects')
    .select('id,title,status,created_at')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single()

  if (error || !project) {
    console.error('Error loading project:', error)
    redirect('/projects')
  }

  return (
    <ProjectWorkspaceErrorBoundary projectId={projectId} projectTitle={project.title}>
      <ProjectWorkspace
        projectId={projectId}
        initialProject={project}
      />
    </ProjectWorkspaceErrorBoundary>
  )
}
