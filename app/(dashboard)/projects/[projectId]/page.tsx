import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { generateAndSaveOutline, generatePlaceholderReferences } from './actions'
import { IntroductionGenerator } from './IntroductionGenerator'
import { PaperEditor } from './components/PaperEditor'
import { CitationViewer } from './components/CitationViewer'
import { ReferenceViewer } from './components/ReferenceViewer'
import { FullPaperGenerator } from './components/FullPaperGenerator'

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
    <div className="space-y-8">
      {/* Project Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              {project.title}
            </h1>
            <p className="text-sm text-gray-500 flex items-center">
              <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3a2 2 0 012-2h4a2 2 0 012 2v4m-8 0h8M8 7H7a2 2 0 00-2 2v8a2 2 0 002 2h10a2 2 0 002-2V9a2 2 0 00-2-2h-1" />
              </svg>
              Created {new Date(project.created_at).toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              })}
            </p>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-gray-200">
          <p className="text-gray-600">
            AI-powered research paper workspace for &quot;{project.title}&quot;. Generate outlines, content, citations, and references.
          </p>
        </div>
      </div>
      
      {/* Actions Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">
          Generate Content
        </h2>
        <div className="space-y-6">
          {/* Basic Generation Actions */}
          <div className="grid gap-4 md:grid-cols-2">
            <form action={handleGenerateOutline}>
              <button 
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-lg font-medium transition-colors flex items-center justify-center space-x-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>Generate Outline</span>
              </button>
            </form>
            
            <IntroductionGenerator 
              projectId={projectId}
              projectTitle={projectTitle}
              outline={project.outline}
            />
          </div>

          {/* Full Paper Generation */}
          <div className="border-t border-gray-200 pt-6">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Full-Length Document Generation
              </h3>
              <p className="text-sm text-gray-600">
                Generate a complete research paper with all sections including Introduction, Literature Review, Methodology, Results, Discussion, and Conclusion.
              </p>
            </div>
            <FullPaperGenerator 
              projectId={projectId}
              projectTitle={projectTitle}
              outline={project.outline}
            />
          </div>
        </div>
      </div>
      
      <PaperEditor 
        outline={project.outline}
        content={project.content}
      />
      
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-3">
          Citations Needed
        </h3>
        <CitationViewer citations_identified={project.citations_identified} />
      </div>
      
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          References
        </h3>
        <form action={handleGenerateReferences} className="mb-4">
          <button 
            type="submit"
            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            Generate Placeholder References
          </button>
        </form>
        <ReferenceViewer references_list={project.references_list} />
      </div>
    </div>
  )
} 