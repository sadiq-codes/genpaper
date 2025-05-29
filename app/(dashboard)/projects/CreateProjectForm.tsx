'use client'

import { useState } from 'react'
import { createProject } from './actions'

export function CreateProjectForm() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  async function handleSubmit(formData: FormData) {
    setIsSubmitting(true)
    setMessage(null)

    try {
      const result = await createProject(formData)
      
      if (result.success) {
        setMessage({ type: 'success', text: 'Project created successfully!' })
        // Clear the form
        const form = document.querySelector('form') as HTMLFormElement
        form?.reset()
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to create project' })
      }
    } catch (error) {
      console.error('Project creation error:', error)
      setMessage({ type: 'error', text: 'An unexpected error occurred' })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div>
      {message && (
        <div className={`mb-6 p-4 rounded-lg flex items-start space-x-3 ${
          message.type === 'success' 
            ? 'bg-green-50 text-green-800 border border-green-200' 
            : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          <div className="flex-shrink-0">
            {message.type === 'success' ? (
              <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </div>
          <div className="text-sm font-medium">{message.text}</div>
        </div>
      )}
      
      <form action={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
            Research Topic
          </label>
          <input
            type="text"
            id="title"
            name="title"
            required
            disabled={isSubmitting}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-500 transition-colors"
            placeholder="e.g., Machine Learning in Healthcare, Climate Change Solutions..."
          />
          <p className="mt-2 text-sm text-gray-500">
            Provide a clear, specific topic for your research paper.
          </p>
        </div>
        
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 disabled:bg-blue-400 disabled:cursor-not-allowed font-medium flex items-center justify-center space-x-2"
        >
          {isSubmitting ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
              <span>Creating Project...</span>
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              <span>Create New Project</span>
            </>
          )}
        </button>
      </form>
    </div>
  )
} 