import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { generateAndSaveOutline, generatePlaceholderReferences } from './actions'
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
    // First try to fetch without citations_identified to see if that's the issue
    const result = await supabase
      .from('projects')
      .select('id, title, outline, content, created_at')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()
    
    if (result.error) {
      console.error('Primary fetch error:', result.error)
      throw result.error
    }

    // If basic fetch works, try to get citations_identified separately
    let citationsIdentified = []
    try {
      const citationsResult = await supabase
        .from('projects')
        .select('citations_identified')
        .eq('id', projectId)
        .eq('user_id', user.id)
        .single()
      
      if (citationsResult.data?.citations_identified) {
        citationsIdentified = citationsResult.data.citations_identified
      }
    } catch (citationsError) {
      console.error('Citations fetch error (non-fatal):', citationsError)
      // Continue without citations if this fails
    }

    // Try to get references_list separately
    let referencesList = []
    try {
      const referencesResult = await supabase
        .from('projects')
        .select('references_list')
        .eq('id', projectId)
        .eq('user_id', user.id)
        .single()
      
      if (referencesResult.data?.references_list) {
        referencesList = referencesResult.data.references_list
      }
    } catch (referencesError) {
      console.error('References fetch error (non-fatal):', referencesError)
      // Continue without references if this fails
    }

    project = { ...result.data, citations_identified: citationsIdentified, references_list: referencesList }
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
      
      project = { ...fallbackResult.data, outline: null, content: null, citations_identified: [], references_list: [] }
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

  // Create a wrapper action for generating placeholder references
  async function handleGenerateReferences() {
    'use server'
    const result = await generatePlaceholderReferences(projectId)
    
    if (result.error) {
      console.error('Failed to generate references:', result.error)
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
              projectId={projectId}
              projectTitle={projectTitle}
              outline={project.outline}
            />
            
            {project.content && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Saved Content
                </h3>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <div className="text-sm text-gray-800 whitespace-pre-wrap font-sans">
                    {project.content}
                  </div>
                </div>
              </div>
            )}
            
            {project.citations_identified && project.citations_identified.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Citations Needed
                </h3>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <p className="text-sm text-yellow-800 mb-3">
                    The following concepts require citations in your research paper:
                  </p>
                  <ul className="list-disc list-inside space-y-1">
                    {project.citations_identified.map((citation: string, index: number) => (
                      <li key={index} className="text-sm text-yellow-700">
                        {citation}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-yellow-600 mt-3">
                    Total: {project.citations_identified.length} citation{project.citations_identified.length !== 1 ? 's' : ''} needed
                  </p>
                </div>
              </div>
            )}
            
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                References
              </h3>
              <form action={handleGenerateReferences}>
                <button 
                  type="submit"
                  className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  Generate Placeholder References
                </button>
              </form>
              
              {project.references_list && project.references_list.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Generated References:</h4>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <ol className="space-y-2">
                      {project.references_list.map((reference: string, index: number) => (
                        <li key={index} className="text-sm text-gray-800">
                          {reference}
                        </li>
                      ))}
                    </ol>
                    <p className="text-xs text-gray-600 mt-3">
                      Total: {project.references_list.length} reference{project.references_list.length !== 1 ? 's' : ''} generated
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
} 