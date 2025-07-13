'use client'

import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Loader2, BookOpen } from 'lucide-react'
import { 
  generateBibliography,
  type BibliographyResult,
  type BibliographyStyle
} from '@/lib/citations/immediate-bibliography'

interface SimpleCitationRendererProps {
  content: string
  projectId: string
  initialStyle?: string
  onContentChange?: (content: string) => void
  onStyleChange?: (style: string) => void
  className?: string
}

export function SimpleCitationRenderer({
  content,
  projectId,
  initialStyle = 'apa',
  onContentChange,
  onStyleChange,
  className = ''
}: SimpleCitationRendererProps) {
  const [currentStyle, setCurrentStyle] = useState(initialStyle)
  const [renderedContent, setRenderedContent] = useState('')
  const [bibliography, setBibliography] = useState('')
  const [citationCount, setCitationCount] = useState(0)
  const [missingCitations, setMissingCitations] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Available citation styles
  const availableStyles = Object.entries(CITATION_STYLES).map(([key, style]) => ({
    id: key,
    name: style.name
  }))

  // Hydrate citations whenever content or style changes
  useEffect(() => {
    const renderCitations = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const result = await hydrateCitations(content, projectId, currentStyle)
        
        setRenderedContent(result.content)
        setBibliography(result.bibliography)
        setCitationCount(result.citations.length)
        setMissingCitations(result.missingCitations)
        
        // Notify parent of content change
        onContentChange?.(result.content + (result.bibliography ? '\n\n' + result.bibliography : ''))
        
      } catch (error) {
        console.error('Failed to render citations:', error)
        setError('Failed to render citations')
        setRenderedContent(content) // Fallback to original content
        setBibliography('')
        setCitationCount(0)
        setMissingCitations([])
      } finally {
        setIsLoading(false)
      }
    }

    renderCitations()
  }, [content, projectId, currentStyle, onContentChange])

  // Handle style change
  const handleStyleChange = (newStyle: string) => {
    if (newStyle === currentStyle) return
    
    setCurrentStyle(newStyle)
    onStyleChange?.(newStyle)
  }

  if (isLoading) {
    return (
      <div className={`space-y-4 ${className}`}>
        <div className="flex items-center justify-center p-8">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />
          <span>Processing citations...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`space-y-4 ${className}`}>
        <div className="text-center p-4 bg-red-50 border border-red-200 rounded-lg">
          <BookOpen className="w-8 h-8 text-red-600 mx-auto mb-2" />
          <h3 className="font-medium text-red-900 mb-1">Citation Error</h3>
          <p className="text-sm text-red-700">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Citation Controls */}
      <div className="flex items-center justify-between p-4 bg-gray-50 border border-gray-200 rounded-lg">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <BookOpen className="w-4 h-4 text-gray-600" />
            <span className="text-sm font-medium">Citations:</span>
            <Badge variant="secondary">{citationCount}</Badge>
          </div>
          
          {missingCitations.length > 0 && (
            <div className="flex items-center space-x-2">
              <span className="text-sm text-orange-600">Missing:</span>
              <Badge variant="destructive">{missingCitations.length}</Badge>
            </div>
          )}
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-600">Style:</span>
          <Select value={currentStyle} onValueChange={handleStyleChange}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableStyles.map((style) => (
                <SelectItem key={style.id} value={style.id}>
                  {style.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Rendered Content */}
      <div className="prose max-w-none">
        <div 
          dangerouslySetInnerHTML={{ __html: renderedContent.replace(/\n/g, '<br />') }}
        />
      </div>

      {/* Bibliography */}
      {bibliography && (
        <div className="mt-8 pt-4 border-t border-gray-200">
          <div 
            className="prose max-w-none"
            dangerouslySetInnerHTML={{ __html: bibliography.replace(/\n/g, '<br />') }}
          />
        </div>
      )}

      {/* Missing Citations Warning */}
      {missingCitations.length > 0 && (
        <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
          <h4 className="font-medium text-orange-900 mb-2">Missing Citations</h4>
          <p className="text-sm text-orange-700 mb-2">
            The following paper IDs were referenced but not found in the database:
          </p>
          <ul className="text-xs text-orange-600 space-y-1">
            {missingCitations.map((paperId, index) => (
              <li key={index} className="font-mono">
                {paperId}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
} 