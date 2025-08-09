'use client'

import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Loader2, BookOpen, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react'
import { 
  generateBibliography,
  BIBLIOGRAPHY_STYLES,
  type BibliographyResult,
  type BibliographyStyle
} from '@/lib/citations/immediate-bibliography'
import { 
  parseCitationPlaceholders, 
  replacePlaceholders,
  type PlaceholderCitation 
} from '@/lib/citations/placeholder-schema'
import { toast } from 'sonner'

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
  const [placeholders, setPlaceholders] = useState<PlaceholderCitation[]>([])
  const [isResolvingPlaceholders, setIsResolvingPlaceholders] = useState(false)

  // Available citation styles
  const availableStyles = Object.entries(BIBLIOGRAPHY_STYLES).map(([key, style]) => ({
    id: key,
    name: style.name
  }))

  // Render citations with placeholder support
  useEffect(() => {
    const renderCitations = async () => {
      setIsLoading(true)
      setError(null)

      try {
        // Check for citation placeholders
        const detectedPlaceholders = parseCitationPlaceholders(content)
        setPlaceholders(detectedPlaceholders)

        if (detectedPlaceholders.length > 0) {
          // Render with placeholder chips
          const contentWithChips = content.replace(
            /\[\[CITE:([^:]+):([^\]]+)\]\]/g,
            '<span class="citation-placeholder bg-blue-100 text-blue-800 px-2 py-1 rounded-md text-sm font-mono">📎 $1:$2</span>'
          )
          setRenderedContent(contentWithChips)
          setBibliography('')
          setCitationCount(0)
        } else {
          // Traditional citation rendering
          const result = await generateBibliography(projectId, currentStyle as BibliographyStyle)
          
          setRenderedContent(content)
          setBibliography(result.bibliography)
          setCitationCount(result.count)
        }
        
        setMissingCitations([])
        
        // Notify parent of content change
        onContentChange?.(renderedContent)
        
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

  // Handle placeholder resolution
  const handleResolvePlaceholders = async () => {
    if (placeholders.length === 0) return

    setIsResolvingPlaceholders(true)
    try {
      const response = await fetch('/api/citations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          refs: placeholders
        })
      })

      if (!response.ok) {
        throw new Error(`Resolution failed: ${response.status}`)
      }

      const data = await response.json()
      const citeKeyMap = data.citeKeyMap || {}
      
      // Replace placeholders with resolved citations
      const { text: resolvedContent, unresolvedCount } = replacePlaceholders(content, citeKeyMap)
      setRenderedContent(resolvedContent)
      
      // Show notification
      const resolvedCount = placeholders.length - unresolvedCount
      toast.success(`Citations resolved`, {
        description: `${resolvedCount} of ${placeholders.length} citations successfully resolved`,
        action: unresolvedCount > 0 ? {
          label: 'View References',
          onClick: () => console.log('Open references panel')
        } : undefined
      })

      // Clear placeholders
      setPlaceholders([])
      
    } catch (error) {
      console.error('Failed to resolve placeholders:', error)
      toast.error('Citation resolution failed', {
        description: 'Unable to resolve citation placeholders. Please try again.',
        action: {
          label: 'Retry',
          onClick: () => handleResolvePlaceholders()
        }
      })
    } finally {
      setIsResolvingPlaceholders(false)
    }
  }

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

      {/* Placeholder Citations Banner */}
      {placeholders.length > 0 && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg mb-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium text-blue-900 mb-1">Citation Placeholders Detected</h4>
              <p className="text-sm text-blue-700">
                {placeholders.length} citation placeholders found. Click "Resolve Citations" to convert them to formatted citations.
              </p>
            </div>
            <Button 
              size="sm" 
              onClick={handleResolvePlaceholders}
              disabled={isResolvingPlaceholders}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isResolvingPlaceholders ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  Resolving...
                </>
              ) : (
                <>
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Resolve Now
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Missing Citations Warning */}
      {missingCitations.length > 0 && (
        <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium text-orange-900 mb-2">Unresolved Citations</h4>
              <p className="text-sm text-orange-700 mb-2">
                Some citations could not be resolved. You can retry or manually add them to your library.
              </p>
              <ul className="text-xs text-orange-600 space-y-1">
                {missingCitations.map((paperId, index) => (
                  <li key={index} className="font-mono">
                    {paperId}
                  </li>
                ))}
              </ul>
            </div>
            <Button 
              size="sm" 
              variant="outline"
              onClick={handleResolvePlaceholders}
              className="border-orange-300 text-orange-700 hover:bg-orange-100"
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              Retry Resolve
            </Button>
          </div>
        </div>
      )}
    </div>
  )
} 