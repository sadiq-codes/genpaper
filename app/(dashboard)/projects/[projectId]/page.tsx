import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { generateAndSaveOutline } from './actions'
import { IntroductionGenerator } from './IntroductionGenerator'

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const supabase = await createClient()
  
  // Get current user
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    notFound()
  }
  
  // Fetch project details
  let project, error;
  try {
    const result = await supabase
      .from('projects')
      .select('id, title, outline, content, created_at')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()
    
    project = result.data
    error = result.error
  } catch (fetchError) {
    console.error('Error fetching project:', fetchError)
    // Try to fetch without potentially problematic fields
    try {
      const fallbackResult = await supabase
        .from('projects')
        .select('id, title, created_at')
        .eq('id', projectId)
        .eq('user_id', user.id)
        .single()
      
      project = { ...fallbackResult.data, outline: null, content: null }
      error = fallbackResult.error
    } catch (fallbackError) {
      console.error('Fallback fetch also failed:', fallbackError)
      notFound()
    }
  }
  
  if (error || !project) {
    console.error('Error fetching project:', error)
    notFound()
  }

  // Capture the project title for use in the server action
  const projectTitle = project.title

  // Create a wrapper action for form submission that doesn't return a value
  async function handleGenerateOutline() {
    'use server'
    const result = await generateAndSaveOutline(projectId, projectTitle)
    
    if (result.error) {
      console.error('Failed to generate outline:', result.error)
      // In a real app, you might want to handle this error more gracefully
      // For now, we'll just log it as the task focuses on basic functionality
    }
  }

  return (
    <div className="py-8">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            {project.title}
          </h1>
          <p className="text-sm text-gray-500">
            Created: {new Date(project.created_at).toLocaleDateString()}
          </p>
        </div>
        
        <div className="border-t pt-4">
          <p className="text-gray-600 mb-6">
            Project workspace for &quot;{project.title}&quot;. This is where you&apos;ll generate and manage your research paper content.
          </p>
          
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Research Paper Outline
              </h3>
              <form action={handleGenerateOutline}>
                <button 
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  Generate Outline
                </button>
              </form>
              
              {project.outline && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Generated Outline:</h4>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <pre className="text-sm text-gray-800 whitespace-pre-wrap font-sans">
                      {project.outline}
                    </pre>
                  </div>
                </div>
              )}
            </div>
            
            <IntroductionGenerator 
              projectTitle={projectTitle}
              outline={project.outline}
            />
          </div>
        </div>
      </div>
    </div>
  )
} 