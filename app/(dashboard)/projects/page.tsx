import { createClient } from '@/lib/supabase/server'
import { CreateProjectForm } from './CreateProjectForm'
import Link from 'next/link'

export default async function ProjectsPage() {
  const supabase = await createClient()
  
  // Get current user
  const { data: { user } } = await supabase.auth.getUser()
  
  // Fetch user's projects
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, title, created_at')
    .eq('user_id', user?.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching projects:', error)
  }

  return (
    <div className="py-8">
      <div className="bg-white rounded-lg shadow p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">
          Welcome to Projects
        </h1>
        <p className="text-gray-600 mb-6">
          This is where you&apos;ll manage your research projects.
        </p>
        
        {/* Projects List */}
        {projects && projects.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Your Projects
            </h2>
            <div className="space-y-3">
              {projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="block p-4 border border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-50 transition-colors"
                >
                  <h3 className="font-medium text-gray-900">{project.title}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Created: {new Date(project.created_at).toLocaleDateString()}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}
        
        {/* Create Project Form */}
        <div className="border-t pt-6">
          <CreateProjectForm />
        </div>
      </div>
    </div>
  )
} 