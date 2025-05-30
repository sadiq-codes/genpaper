'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { Citation } from '@/types/database'

interface ReferenceListProps {
  projectId: string
}

export function ReferenceList({ projectId }: ReferenceListProps) {
  const [citations, setCitations] = useState<Citation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  async function fetchCitations() {
    try {
      setError(null)

      // Fetch all unique citations for the project
      const { data: citationsData, error: citationsError } = await supabase
        .from('citations')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true }) // Chronological order for reference list

      if (citationsError) {
        throw citationsError
      }

      // Remove duplicates based on DOI or title+year combination
      const uniqueCitations = citationsData?.reduce((acc: Citation[], current) => {
        const exists = acc.find(citation => {
          // First try to match by DOI if available
          if (current.doi && citation.doi) {
            return current.doi === citation.doi
          }
          // Otherwise match by title and year
          return current.title === citation.title && current.year === citation.year
        })
        
        if (!exists) {
          acc.push(current)
        }
        return acc
      }, []) || []

      setCitations(uniqueCitations)
    } catch (err) {
      console.error('Error fetching citations:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch citations')
    }
  }

  useEffect(() => {
    async function initialLoad() {
      setLoading(true)
      await fetchCitations()
      setLoading(false)
    }

    if (projectId) {
      initialLoad()
    }
  }, [projectId])

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchCitations()
    setRefreshing(false)
  }

  const formatAuthors = (authors: Array<{ name: string }>) => {
    if (!authors || authors.length === 0) return 'Unknown Author'
    
    if (authors.length === 1) {
      return authors[0].name
    } else if (authors.length === 2) {
      return `${authors[0].name} & ${authors[1].name}`
    } else if (authors.length <= 3) {
      return authors.map(a => a.name).join(', ')
    } else {
      return `${authors[0].name} et al.`
    }
  }

  const formatReference = (citation: Citation) => {
    const authors = formatAuthors(citation.authors)
    const year = citation.year ? `(${citation.year})` : ''
    const title = citation.title
    const journal = citation.journal ? `. ${citation.journal}` : ''
    const doi = citation.doi ? `. DOI: ${citation.doi}` : ''
    
    return `${authors} ${year}. ${title}${journal}${doi}.`.replace(/\.\.$/, '.')
  }

  if (loading) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-6">
        <div className="animate-pulse">
          <div className="h-4 bg-green-200 rounded w-1/3 mb-4"></div>
          <div className="space-y-3">
            <div className="h-3 bg-green-200 rounded"></div>
            <div className="h-3 bg-green-200 rounded w-5/6"></div>
            <div className="h-3 bg-green-200 rounded w-4/5"></div>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <div className="text-red-600">
          <p className="text-sm font-medium">Error loading reference list</p>
          <p className="text-xs text-red-500 mt-1">{error}</p>
          <button 
            onClick={handleRefresh}
            className="mt-2 text-xs bg-red-100 hover:bg-red-200 text-red-700 px-2 py-1 rounded transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  if (citations.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
        <div className="text-gray-600">
          <svg className="w-8 h-8 mx-auto text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm">No references available</p>
          <p className="text-xs text-gray-500 mt-1">
            References will appear here when citations are added to your project.
          </p>
          <button 
            onClick={handleRefresh}
            className="mt-3 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 rounded transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-green-50 border border-green-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-green-100 border-b border-green-200 px-4 py-3 flex items-center justify-between">
        <h4 className="text-sm font-medium text-green-800">
          References ({citations.length})
        </h4>
        <button 
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-xs bg-green-200 hover:bg-green-300 disabled:bg-green-150 text-green-800 px-2 py-1 rounded transition-colors flex items-center space-x-1"
        >
          <svg 
            className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
        </button>
      </div>
      
      {/* References List */}
      <div className="p-4">
        <ol className="space-y-4">
          {citations.map((citation, index) => (
            <li key={citation.id} className="flex items-start">
              <span className="flex-shrink-0 w-8 h-6 bg-green-200 text-green-800 rounded text-xs font-medium flex items-center justify-center mr-3 mt-0.5">
                {index + 1}.
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-green-800 leading-relaxed break-words">
                  {formatReference(citation)}
                </p>
                {/* Additional metadata */}
                <div className="mt-1 text-xs text-green-600">
                  <span className="inline-flex items-center px-2 py-0.5 rounded bg-green-100 text-green-700 mr-2">
                    {citation.source_type || 'paper'}
                  </span>
                  {citation.source_url && (
                    <a 
                      href={citation.source_url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-green-600 hover:text-green-800 underline"
                    >
                      View Source
                    </a>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
      
      {/* Footer */}
      <div className="bg-green-100 border-t border-green-200 px-4 py-2">
        <p className="text-xs text-green-600">
          Automatically generated reference list from AI-identified citations. Updates when new citations are added.
        </p>
      </div>
    </div>
  )
} 