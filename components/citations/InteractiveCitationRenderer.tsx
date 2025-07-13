'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Loader2, BookOpen, RefreshCw } from 'lucide-react'
import { 
  generateBibliography,
  type BibliographyResult,
  type CitationBibliographyEntry,
  type BibliographyStyle
} from '@/lib/citations/immediate-bibliography'
import type { CSLItem } from '@/lib/utils/csl'
import { CitationEditor } from './CitationEditor'

// Global window type extension
declare global {
  interface Window {
    handleCitationClick?: (citationId: string) => void
  }
}

interface InteractiveCitationRendererProps {
  content: string
  citations: Map<string, CSLItem>
  documentId: string
  initialStyle?: string
  locale?: string
  onContentChange?: (content: string) => void
  onCitationUpdate?: (citationId: string, csl: CSLItem) => void
  onStyleChange?: (style: string) => void
  className?: string
}

export function InteractiveCitationRenderer({
  content,
  citations,
  documentId,
  initialStyle = 'apa',
  locale = 'en-US',
  onContentChange,
  onCitationUpdate,
  onStyleChange,
  className = ''
}: InteractiveCitationRendererProps) {
  const [currentStyle, setCurrentStyle] = useState(initialStyle)
  const [availableStyles, setAvailableStyles] = useState<CitationStyleInfo[]>([])
  const [renderedContent, setRenderedContent] = useState('')
  const [bibliography, setBibliography] = useState('')
  const [interactiveCitations, setInteractiveCitations] = useState<InteractiveCitation[]>([])
  const [missingCitations, setMissingCitations] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isChangingStyle, setIsChangingStyle] = useState(false)
  const [editingCitation, setEditingCitation] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Create document context
  const documentContext: DocumentCitationContext = useMemo(() => ({
    documentId,
    citations,
    currentStyle,
    locale
  }), [documentId, citations, currentStyle, locale])

  // Render options
  const renderOptions: CitationRenderOptions = useMemo(() => ({
    style: currentStyle,
    format: 'html',
    locale,
    interactive: true,
    highlightEditable: true
  }), [currentStyle, locale])

  // Load available citation styles
  useEffect(() => {
    const loadStyles = async () => {
      try {
        const styles = await citationEngine.getAvailableStyles()
        setAvailableStyles(styles)
      } catch (error) {
        console.error('Failed to load citation styles:', error)
        setError('Failed to load citation styles')
      }
    }
    loadStyles()
  }, [])

  // Render document with citations
  const renderDocument = useCallback(async () => {
    if (citations.size === 0) {
      setRenderedContent(content)
      setBibliography('')
      setInteractiveCitations([])
      setMissingCitations([])
      setIsLoading(false)
      return
    }

    try {
      setError(null)
      const result = await citationEngine.renderDocument(
        content,
        documentContext,
        renderOptions
      )

      // Convert <button> interactive citations to inline <span> for cleaner typography
      const cleanedContent = result.renderedContent
        .replace(/<button([^>]+)>([^<]+)<\/button>/g, '<span $1 style="background:none;border:none;padding:0;margin:0;color:inherit;text-decoration:underline;cursor:pointer">$2</span>')

      setRenderedContent(cleanedContent)
      setBibliography(result.bibliography)
      setInteractiveCitations(result.citations)
      setMissingCitations(result.missingCitations)
      
      // Notify parent of content change
      onContentChange?.(result.renderedContent)
      
    } catch (error) {
      console.error('Failed to render document:', error)
      setError('Failed to render citations')
      setRenderedContent(content) // Fallback to original content
    } finally {
      setIsLoading(false)
      setIsChangingStyle(false)
    }
  }, [content, documentContext, renderOptions, onContentChange])

  // Initial render and re-render on changes
  useEffect(() => {
    setIsLoading(true)
    renderDocument()
  }, [renderDocument])

  // Handle citation style change
  const handleStyleChange = async (newStyle: string) => {
    if (newStyle === currentStyle) return

    setIsChangingStyle(true)
    setCurrentStyle(newStyle)
    onStyleChange?.(newStyle)

    try {
      const result = await citationEngine.changeDocumentStyle(
        content,
        documentContext,
        newStyle,
        { format: 'html', locale, interactive: true, highlightEditable: true }
      )

      setRenderedContent(result.renderedContent)
      setBibliography(result.bibliography)
      setInteractiveCitations(result.citations)
      onContentChange?.(result.renderedContent)
      
    } catch (error) {
      console.error('Failed to change citation style:', error)
      setError('Failed to change citation style')
    } finally {
      setIsChangingStyle(false)
    }
  }

  // Handle citation click for editing
  const handleCitationClick = useCallback((citationId: string) => {
    setEditingCitation(citationId)
  }, [citations.size])

  // Handle citation update
  const handleCitationUpdate = async (citationId: string, newCsl: CSLItem) => {
    try {
      const updatedCitation = await citationEngine.updateCitation(
        citationId,
        newCsl,
        documentContext,
        renderOptions
      )

      // Update local state
      setInteractiveCitations(prev => 
        prev.map(citation => 
          citation.id === citationId ? updatedCitation : citation
        )
      )

      // Notify parent
      onCitationUpdate?.(citationId, newCsl)
      
      // Re-render document
      await renderDocument()
      
    } catch (error) {
      console.error('Failed to update citation:', error)
      setError('Failed to update citation')
    } finally {
      setEditingCitation(null)
    }
  }

  // Set up global citation click handler
  useEffect(() => {
    window.handleCitationClick = handleCitationClick
    return () => {
      delete window.handleCitationClick
    }
  }, [handleCitationClick])

  // Get current style info
  const currentStyleInfo = availableStyles.find(style => style.id === currentStyle)

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        <span>Rendering citations...</span>
      </div>
    )
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Citation Controls */}
      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <BookOpen className="h-4 w-4 text-gray-600" />
            <span className="text-sm font-medium text-gray-700">Citation Style:</span>
          </div>
          
          <Select value={currentStyle} onValueChange={handleStyleChange} disabled={isChangingStyle}>
            <SelectTrigger className="w-64">
              <SelectValue>
                {isChangingStyle ? (
                  <div className="flex items-center">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Changing style...
                  </div>
                ) : (
                  currentStyleInfo?.name || currentStyle
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {availableStyles.map((style) => (
                <SelectItem key={style.id} value={style.id}>
                  <div className="flex items-center justify-between w-full">
                    <span>{style.name}</span>
                    <Badge variant="outline" className="ml-2 text-xs">
                      {style.category}
                    </Badge>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {currentStyleInfo && (
            <div className="text-sm text-gray-500">
              Example: <code className="bg-gray-100 px-1 rounded">{currentStyleInfo.example}</code>
            </div>
          )}
        </div>

        <div className="flex items-center space-x-2">
          <Badge variant="secondary">
            {interactiveCitations.length} citations
          </Badge>
          
          {missingCitations.length > 0 && (
            <Badge variant="destructive">
              {missingCitations.length} missing
            </Badge>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={renderDocument}
            disabled={isLoading || isChangingStyle}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

      {/* Missing Citations Warning */}
      {missingCitations.length > 0 && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-yellow-800 text-sm font-medium mb-2">
            Missing Citations ({missingCitations.length}):
          </p>
          <div className="flex flex-wrap gap-1">
            {missingCitations.map(id => (
              <Badge key={id} variant="outline" className="text-yellow-700 border-yellow-300">
                {id.slice(0, 8)}...
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Rendered Content */}
      <div className="prose max-w-none">
        <div 
          className="citation-content"
          dangerouslySetInnerHTML={{ __html: renderedContent }}
        />
      </div>

      {/* Bibliography */}
      {bibliography && (
        <div className="border-t pt-6">
          <h3 className="text-lg font-semibold mb-4">References</h3>
          <div 
            className="prose max-w-none text-sm"
            dangerouslySetInnerHTML={{ __html: bibliography }}
          />
        </div>
      )}

      {/* Citation Editor Modal */}
      {editingCitation && (
        <CitationEditor
          citationId={editingCitation}
          initialCsl={citations.get(editingCitation)}
          onSave={(csl: CSLItem) => handleCitationUpdate(editingCitation, csl)}
          onCancel={() => setEditingCitation(null)}
        />
      )}

      {/* Custom Styles for Citation Links */}
      <style jsx global>{`
        .citation-content .citation-link {
          transition: all 0.2s ease;
          text-decoration: none;
          border-radius: 4px;
        }
        
        .citation-content .citation-link:hover {
          transform: translateY(-1px);
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        
        .citation-content .citation-link:active {
          transform: translateY(0);
        }
        
        .citation-content .citation-link:focus {
          outline: 2px solid #3b82f6;
          outline-offset: 2px;
        }
      `}</style>
    </div>
  )
} 