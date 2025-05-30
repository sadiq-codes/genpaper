'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { Citation, ReferenceLink } from '@/types/database'

interface CitationWithLinks extends Citation {
  reference_links: ReferenceLink[]
}

interface CitationManagerProps {
  projectId: string
}

export function CitationManager({ projectId }: CitationManagerProps) {
  const [citations, setCitations] = useState<CitationWithLinks[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  async function fetchCitations() {
    try {
      setError(null)

      // Fetch citations with their associated reference links
      const { data: citationsData, error: citationsError } = await supabase
        .from('citations')
        .select(`
          *,
          reference_links (*)
        `)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })

      if (citationsError) {
        throw citationsError
      }

      setCitations(citationsData || [])
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

  if (loading) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <div className="animate-pulse">
          <div className="h-4 bg-blue-200 rounded w-1/3 mb-4"></div>
          <div className="space-y-3">
            <div className="h-3 bg-blue-200 rounded"></div>
            <div className="h-3 bg-blue-200 rounded w-5/6"></div>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <div className="text-red-600">
          <p className="text-sm font-medium">Error loading citations</p>
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
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          <p className="text-sm">No structured citations found</p>
          <p className="text-xs text-gray-500 mt-1">
            Citations will appear here when AI identifies and links them to your content.
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

  const formatAuthors = (authors: Array<{ name: string }>) => {
    if (!authors || authors.length === 0) return 'Unknown Author'
    
    if (authors.length === 1) {
      return authors[0].name
    } else if (authors.length === 2) {
      return `${authors[0].name} & ${authors[1].name}`
    } else {
      return `${authors[0].name} et al.`
    }
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-blue-100 border-b border-blue-200 px-4 py-3 flex items-center justify-between">
        <h4 className="text-sm font-medium text-blue-800">
          Structured Citations ({citations.length})
        </h4>
        <button 
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-xs bg-blue-200 hover:bg-blue-300 disabled:bg-blue-150 text-blue-800 px-2 py-1 rounded transition-colors flex items-center space-x-1"
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
      
      {/* Citations List */}
      <div className="p-4">
        <div className="space-y-4">
          {citations.map((citation, index) => (
            <div key={citation.id} className="bg-white border border-blue-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
              {/* Citation Number & Title */}
              <div className="flex items-start space-x-3 mb-2">
                <span className="flex-shrink-0 w-6 h-6 bg-blue-200 text-blue-800 rounded-full text-xs font-medium flex items-center justify-center mt-0.5">
                  {index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <h5 className="text-sm font-medium text-gray-900 leading-tight break-words">
                    {citation.title}
                  </h5>
                  {/* Source Type Badge */}
                  <div className="mt-1">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                      {citation.source_type || 'paper'}
                    </span>
                  </div>
                </div>
              </div>
              
              {/* Authors & Year */}
              <div className="ml-9 mb-2">
                <p className="text-xs text-gray-600">
                  <span className="font-medium">{formatAuthors(citation.authors)}</span>
                  {citation.year && <span> ({citation.year})</span>}
                  {citation.journal && <span className="italic">. {citation.journal}</span>}
                </p>
              </div>
              
              {/* DOI & Source */}
              {(citation.doi || citation.source_url) && (
                <div className="ml-9 mb-3">
                  {citation.doi && (
                    <p className="text-xs text-blue-600 break-all">
                      DOI: {citation.doi}
                    </p>
                  )}
                  {citation.source_url && !citation.doi && (
                    <a 
                      href={citation.source_url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:text-blue-800 underline break-all"
                    >
                      View Source
                    </a>
                  )}
                </div>
              )}
              
              {/* Reference Links */}
              {citation.reference_links && citation.reference_links.length > 0 && (
                <div className="ml-9">
                  <div className="bg-gray-50 rounded p-2">
                    <p className="text-xs text-gray-500 font-medium mb-1">
                      Linked to text ({citation.reference_links.length} location{citation.reference_links.length !== 1 ? 's' : ''}):
                    </p>
                    <div className="space-y-1">
                      {citation.reference_links.map((link) => (
                        <div key={link.id} className="text-xs text-gray-600">
                          {link.section_name && (
                            <span className="font-medium text-gray-700 block sm:inline">
                              {link.section_name}:{' '}
                            </span>
                          )}
                          {link.placeholder_text && (
                            <span className="bg-yellow-100 text-yellow-800 px-1 rounded mr-1">
                              {link.placeholder_text}
                            </span>
                          )}
                          {link.text_segment && (
                            <span className="italic block sm:inline mt-1 sm:mt-0">
                              "{link.text_segment.length > 100 ? link.text_segment.substring(0, 100) + '...' : link.text_segment}"
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      
      {/* Footer */}
      <div className="bg-blue-100 border-t border-blue-200 px-4 py-2">
        <p className="text-xs text-blue-600">
          These are structured citations identified and linked by AI to specific parts of your content.
        </p>
      </div>
    </div>
  )
} 