'use client'

import { useState, useEffect, useMemo } from 'react'
import { BookOpen, ExternalLink, Download } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import type { CSLItem } from '@/lib/utils/csl'

interface ReferenceListProps {
  content: string
  citations: Map<string, CSLItem>
  citationStyle?: 'apa' | 'mla' | 'chicago' | 'harvard'
  onCitationClick?: (citationId: string) => void
  className?: string
}

interface Reference {
  id: string
  csl: CSLItem
  count: number
  formatted: string
}

export default function ReferenceList({ 
  content, 
  citations, 
  citationStyle = 'apa',
  onCitationClick,
  className = ''
}: ReferenceListProps) {
  const [references, setReferences] = useState<Reference[]>([])
  const [isLoading, setIsLoading] = useState(false)

  // Extract citation IDs from content
  const citationIds = useMemo(() => {
    const regex = /\[CITE:([^\]]+)\]/g
    const matches = []
    let match

    while ((match = regex.exec(content)) !== null) {
      matches.push(match[1])
    }

    return matches
  }, [content])

  // Generate formatted references
  useEffect(() => {
    const generateReferences = async () => {
      if (citationIds.length === 0) {
        setReferences([])
        return
      }

      setIsLoading(true)
      try {
        // Count citations and get unique ones
        const citationCounts = new Map<string, number>()
        citationIds.forEach(id => {
          citationCounts.set(id, (citationCounts.get(id) || 0) + 1)
        })

        const uniqueCitations = Array.from(citationCounts.keys())
        const refs: Reference[] = []

        for (const citationId of uniqueCitations) {
          const csl = citations.get(citationId)
          if (csl) {
            const formatted = await formatReference(csl, citationStyle)
            refs.push({
              id: citationId,
              csl,
              count: citationCounts.get(citationId) || 0,
              formatted
            })
          } else {
            // Create placeholder for missing citation
            refs.push({
              id: citationId,
              csl: {
                id: citationId,
                type: 'article',
                title: 'Unknown Reference',
                author: [{ family: 'Unknown', given: '' }],
                issued: { 'date-parts': [[new Date().getFullYear()]] }
              },
              count: citationCounts.get(citationId) || 0,
              formatted: `[Missing Reference: ${citationId}]`
            })
          }
        }

        // Sort alphabetically by first author's last name
        refs.sort((a, b) => {
          const aAuthor = a.csl.author?.[0]?.family || a.csl.title || ''
          const bAuthor = b.csl.author?.[0]?.family || b.csl.title || ''
          return aAuthor.localeCompare(bAuthor)
        })

        setReferences(refs)
      } catch (error) {
        console.error('Error generating references:', error)
      }
      setIsLoading(false)
    }

    generateReferences()
  }, [citationIds, citations, citationStyle])

  // Format a single reference
  const formatReference = async (csl: CSLItem, style: string): Promise<string> => {
    try {
      // Simple formatting - you can enhance this with a proper CSL processor
      const authors = csl.author?.map(author => {
        if (author.family && author.given) {
          return `${author.family}, ${author.given.charAt(0)}.`
        }
        return author.literal || author.family || ''
      }).join(', ') || 'Unknown Author'

      const year = csl.issued?.['date-parts']?.[0]?.[0] || 'n.d.'
      const title = csl.title || 'Untitled'
      const journal = csl['container-title'] || csl.journal || ''

      switch (style) {
        case 'apa':
          return `${authors} (${year}). ${title}. ${journal ? `${journal}.` : ''}`
        case 'mla':
          return `${authors} "${title}" ${journal ? `${journal},` : ''} ${year}.`
        case 'chicago':
          return `${authors} "${title}" ${journal ? `${journal}` : ''} (${year}).`
        case 'harvard':
          return `${authors} ${year}, '${title}', ${journal ? `${journal}.` : ''}`
        default:
          return `${authors} (${year}). ${title}. ${journal ? `${journal}.` : ''}`
      }
    } catch (error) {
      console.error('Error formatting reference:', error)
      return `${csl.title || 'Unknown Reference'} (formatting error)`
    }
  }

  if (citationIds.length === 0) {
    return null
  }

  return (
    <div className={`mt-12 ${className}`}>
      <Separator className="mb-6" />
      
      <div className="flex items-center gap-2 mb-6">
        <BookOpen className="h-5 w-5 text-gray-600" />
        <h2 className="text-lg font-semibold text-gray-900">References</h2>
        <Badge variant="secondary" className="text-xs">
          {references.length} {references.length === 1 ? 'item' : 'items'}
        </Badge>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {references.map((ref, index) => (
            <Card key={ref.id} className="p-4 hover:bg-gray-50 transition-colors">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-medium">
                    {index + 1}
                  </div>
                </div>
                
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 mb-2">
                    {ref.formatted.includes('[Missing Reference:') ? (
                      <span className="text-red-600">{ref.formatted}</span>
                    ) : (
                      ref.formatted
                    )}
                  </p>
                  
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>Cited {ref.count} {ref.count === 1 ? 'time' : 'times'}</span>
                    
                    {ref.csl.DOI && (
                      <a
                        href={`https://doi.org/${ref.csl.DOI}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700"
                      >
                        <ExternalLink className="h-3 w-3" />
                        DOI
                      </a>
                    )}
                    
                    {ref.csl.URL && (
                      <a
                        href={ref.csl.URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700"
                      >
                        <ExternalLink className="h-3 w-3" />
                        URL
                      </a>
                    )}
                  </div>
                </div>
                
                <div className="flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onCitationClick?.(ref.id)}
                    className="h-8 w-8 p-0"
                  >
                    <BookOpen className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      
      {references.length === 0 && !isLoading && (
        <div className="text-center py-8">
          <BookOpen className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No references found in this document</p>
          <p className="text-sm text-gray-400 mt-1">
            Add citations to your content to see them listed here
          </p>
        </div>
      )}
    </div>
  )
} 