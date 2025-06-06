'use client'

import type { PaperWithAuthors } from '@/types/simplified'
import CitationCore from './CitationCore'
import { useState, useCallback } from 'react'

// Temporarily disable lazy loading to debug bundling issue
// const CitationCore = lazy(() => import('./CitationCore'))

interface CitationRendererProps {
  content: string
  papers: PaperWithAuthors[]
  projectId?: string
  initialStyle?: 'apa' | 'mla' | 'chicago-author-date'
  className?: string
}

export default function CitationRenderer({ 
  content, 
  papers, 
  projectId,
  className = '' 
}: CitationRendererProps) {
  const [error, setError] = useState<string | null>(null)

  const handleError = useCallback((errorMessage: string) => {
    setError(errorMessage)
    console.error('Citation system error:', errorMessage)
  }, [])

  const handleStatusChange = useCallback((newStatus: 'loading' | 'ready' | 'error' | 'fallback') => {
    if (newStatus !== 'error') {
      setError(null)
    }
  }, [])

  return (
    <div className={className}>
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <div className="flex">
            <div className="text-sm text-red-700">
              <strong>Citation Error:</strong> {error}
            </div>
          </div>
        </div>
      )}
      
      <CitationCore
        content={content}
        papers={papers}
        projectId={projectId}
        onError={handleError}
        onStatusChange={handleStatusChange}
        className="w-full"
      />
    </div>
  )
} 