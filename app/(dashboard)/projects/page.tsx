import { createClient } from '@/lib/supabase/server'
import { CreateProjectForm } from '@/app/(dashboard)/projects/CreateProjectForm'
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
    <div className="space-y-8">
      {/* Page Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Research Projects
          </h1>
          <p className="text-gray-600 max-w-2xl mx-auto">
            Create and manage your AI-powered research papers. Generate outlines, content, citations, and references with ease.
          </p>
        </div>
      </div>
      
      {/* Projects Grid */}
      {projects && projects.length > 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">
              Your Projects ({projects.length})
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="group block p-6 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-all duration-200 hover:shadow-md"
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="font-semibold text-gray-900 group-hover:text-blue-900 text-lg leading-tight">
                    {project.title}
                  </h3>
                  <svg className="w-5 h-5 text-gray-400 group-hover:text-blue-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
                <p className="text-sm text-gray-500">
                  Created {new Date(project.created_at).toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'short', 
                    day: 'numeric' 
                  })}
                </p>
                <div className="mt-4 text-xs text-blue-600 group-hover:text-blue-700 font-medium">
                  Open Project →
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <div className="text-gray-400 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No projects yet</h3>
          <p className="text-gray-500 mb-6">
            Get started by creating your first research project below.
          </p>
        </div>
      )}
      
      {/* Create Project Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Create New Project
          </h2>
          <p className="text-gray-600">
            Start a new research paper by providing a topic title.
          </p>
        </div>
        <CreateProjectForm />
      </div>
    </div>
  )
} 