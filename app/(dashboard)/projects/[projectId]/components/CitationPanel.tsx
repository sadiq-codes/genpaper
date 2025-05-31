'use client'

import React, { useState, useMemo } from 'react'
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Search,
  X,
  Plus,
  MoreHorizontal,
  CheckCircle,
  Quote,
  BookOpen,
  ExternalLink,
  Copy,
  Download,
  Filter,
} from "lucide-react"

import { CitationSearch } from './CitationSearch'
import { SmartBibliography } from './SmartBibliography'
import { CitationFormatterFactory, type CitationStyle } from '@/lib/citations/citation-formatter'
import type { Citation } from '@/lib/citations/citation-sources'
import type { DatabaseCitation } from "@/lib/tanstack-query/hooks/useCitations"

interface CitationPanelProps {
  citations: DatabaseCitation[]
  showCitations: boolean
  onHideCitations: () => void
  onCopyBibliography?: () => void
  projectId: string
  documentContent?: string
}

export default function CitationPanel({
  citations,
  showCitations,
  onHideCitations,
  onCopyBibliography,
  projectId,
  documentContent = ''
}: CitationPanelProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedStyle, setSelectedStyle] = useState<CitationStyle>('apa7')
  const [activeTab, setActiveTab] = useState<'search' | 'library' | 'bibliography'>('library')

  if (!showCitations) return null

  // Convert database citations to our Citation interface
  const convertedCitations = useMemo(() => {
    return citations.map(dbCitation => ({
      id: dbCitation.id,
      type: 'article' as const, // Map from database type if available
      title: dbCitation.title,
      authors: dbCitation.authors.map((author: any) => ({
        given: author.given || '',
        family: author.family || ''
      })),
      year: dbCitation.year || undefined,
      journal: dbCitation.journal || undefined,
      doi: dbCitation.doi || undefined,
      // Note: url and abstract are not available in DatabaseCitation
      url: undefined,
      abstract: undefined
    } as Citation))
  }, [citations])

  // Filter citations based on search query
  const filteredCitations = convertedCitations.filter(citation => 
    citation.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    citation.authors.some(author => 
      `${author.given} ${author.family}`.toLowerCase().includes(searchQuery.toLowerCase())
    ) ||
    citation.journal?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleAddCitation = (citation: Citation) => {
    // TODO: Implement adding citation to project database
    console.log('Adding citation:', citation)
  }

  const handleCopyBibliography = () => {
    const formatter = CitationFormatterFactory.createFormatter(selectedStyle)
    const bibliography = filteredCitations
      .map((citation, index) => `${index + 1}. ${formatter.formatBibliography(citation)}`)
      .join('\n\n')
    
    navigator.clipboard.writeText(bibliography).then(() => {
      console.log('Bibliography copied to clipboard')
    }).catch(err => {
      console.error('Failed to copy bibliography:', err)
    })
    
    if (onCopyBibliography) {
      onCopyBibliography()
    }
  }

  const citationStats = {
    total: citations.length,
    withDOI: citations.filter(c => c.doi).length,
    withLinks: citations.filter(c => c.links && c.links.length > 0).length,
  }

  return (
    <div className="w-96 border-l border-gray-200 bg-gray-50 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-white flex-shrink-0">
        <div>
          <h3 className="font-semibold text-gray-900">Citations & Sources</h3>
          <p className="text-xs text-gray-500 mt-1">{citationStats.total} citations</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="w-6 h-6">
            <Filter className="w-3 h-3" />
          </Button>
          <Button variant="ghost" size="icon" className="w-6 h-6" onClick={onHideCitations}>
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)} className="flex-1 flex flex-col">
        <TabsList className="grid w-full grid-cols-3 m-4 mb-0">
          <TabsTrigger value="search" className="text-xs">Search</TabsTrigger>
          <TabsTrigger value="library" className="text-xs">Library</TabsTrigger>
          <TabsTrigger value="bibliography" className="text-xs">Bibliography</TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-hidden">
          {/* Search Tab */}
          <TabsContent value="search" className="h-full p-4 mt-0">
            <div className="space-y-4 h-full">
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-2">Find & Add Citations</h4>
                <p className="text-xs text-gray-600 mb-4">
                  Search academic databases and add citations to your project
                </p>
              </div>
              
              <CitationSearch 
                onSelect={handleAddCitation}
                existingCitations={convertedCitations}
                className="flex-1"
              />
            </div>
          </TabsContent>

          {/* Library Tab */}
          <TabsContent value="library" className="h-full p-4 mt-0 overflow-y-auto">
            <div className="space-y-4">
              {/* Search Bar */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-3 h-3 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Search your citations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-8 text-xs"
                />
              </div>

              {/* Citation Style Selector */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-700">Citation Style</p>
                <div className="flex gap-2">
                  <Badge 
                    className={`text-xs px-2 py-1 cursor-pointer transition-colors ${
                      selectedStyle === 'apa7' 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                    onClick={() => setSelectedStyle('apa7')}
                  >
                    APA
                  </Badge>
                  <Badge 
                    className={`text-xs px-2 py-1 cursor-pointer transition-colors ${
                      selectedStyle === 'mla9' 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                    onClick={() => setSelectedStyle('mla9')}
                  >
                    MLA
                  </Badge>
                  <Badge 
                    className={`text-xs px-2 py-1 cursor-pointer transition-colors ${
                      selectedStyle === 'chicago17' 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                    onClick={() => setSelectedStyle('chicago17')}
                  >
                    Chicago
                  </Badge>
                </div>
              </div>

              {/* Citation Stats */}
              {citations.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-lg font-semibold text-blue-900">{citationStats.total}</p>
                      <p className="text-xs text-blue-700">Total</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-blue-900">{citationStats.withDOI}</p>
                      <p className="text-xs text-blue-700">With DOI</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-blue-900">{citationStats.withLinks}</p>
                      <p className="text-xs text-blue-700">Referenced</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Empty State */}
              {citations.length === 0 && (
                <div className="text-center py-8">
                  <BookOpen className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-600 mb-2">No citations yet</p>
                  <p className="text-xs text-gray-500 mb-4">Citations will appear here as you add them to your paper</p>
                  <Button 
                    size="sm" 
                    onClick={() => setActiveTab('search')}
                    className="text-xs"
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Add Citation
                  </Button>
                </div>
              )}

              {/* Citations List */}
              {filteredCitations.length > 0 && (
                <div className="space-y-3">
                  {filteredCitations.map((citation) => (
                    <CitationCard
                      key={citation.doi || citation.title}
                      citation={citation}
                      style={selectedStyle}
                    />
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Bibliography Tab */}
          <TabsContent value="bibliography" className="h-full mt-0 overflow-y-auto">
            <SmartBibliography
              projectId={projectId}
              citations={convertedCitations}
              style={selectedStyle}
              documentContent={documentContent}
              className="h-full"
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}

function CitationCard({ citation, style }: { citation: Citation, style: CitationStyle }) {
  const formatter = CitationFormatterFactory.createFormatter(style)
  const formattedAuthors = citation.authors.map(a => `${a.given} ${a.family}`).join(', ')

  return (
    <Card className="border transition-shadow cursor-pointer border-gray-200 hover:shadow-sm">
      <CardContent className="p-3">
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1">
            <h4 className="font-medium text-sm text-gray-900 mb-1 line-clamp-2">
              {citation.title}
            </h4>
            <p className="text-xs text-gray-600 mb-2">
              {formattedAuthors} {citation.year && `(${citation.year})`}
            </p>
            {citation.journal && (
              <p className="text-xs text-gray-500 italic mb-2">{citation.journal}</p>
            )}
          </div>
          <Button variant="ghost" size="icon" className="w-6 h-6 flex-shrink-0">
            <MoreHorizontal className="w-3 h-3" />
          </Button>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {citation.doi && (
              <Badge variant="outline" className="text-xs">
                DOI
              </Badge>
            )}
            {citation.url && (
              <Badge variant="outline" className="text-xs">
                URL
              </Badge>
            )}
          </div>
          
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="w-5 h-5"
              onClick={() => {
                const inText = formatter.formatInText(citation)
                navigator.clipboard.writeText(inText)
              }}
            >
              <Quote className="w-3 h-3" />
            </Button>
            {(citation.doi || citation.url) && (
              <Button
                variant="ghost"
                size="icon"
                className="w-5 h-5"
                onClick={() => {
                  const url = citation.doi 
                    ? `https://doi.org/${citation.doi}`
                    : citation.url
                  window.open(url, '_blank')
                }}
              >
                <ExternalLink className="w-3 h-3" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
} 