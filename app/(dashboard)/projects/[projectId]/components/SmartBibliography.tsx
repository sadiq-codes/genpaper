'use client'

import { useState, useEffect, useMemo } from 'react'
import { Copy, Download, Eye, EyeOff, Filter, SortAsc, ChevronDown, Info, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { toast } from 'sonner'

import { CitationFormatterFactory, type CitationStyle } from '@/lib/citations/citation-formatter'
import type { Citation } from '@/lib/citations/citation-sources'

interface BibliographyEntry extends Citation {
  usageCount?: number
  lastUsed?: Date
  isUnused?: boolean
}

interface BibliographyGroup {
  label: string
  citations: BibliographyEntry[]
  count: number
}

interface SmartBibliographyProps {
  projectId: string
  citations: Citation[]
  style?: CitationStyle
  documentContent?: string
  className?: string
}

export function SmartBibliography({ 
  projectId, 
  citations, 
  style = 'apa7', 
  documentContent = '',
  className 
}: SmartBibliographyProps) {
  const [citationStyle, setCitationStyle] = useState<CitationStyle>(style)
  const [groupBy, setGroupBy] = useState<'none' | 'type' | 'year' | 'author'>('none')
  const [showUnused, setShowUnused] = useState(true)
  const [sortBy, setSortBy] = useState<'alphabetical' | 'year' | 'usage'>('alphabetical')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['all']))

  // Process citations to add usage information
  const processedCitations = useMemo(() => {
    const formatter = CitationFormatterFactory.createFormatter(citationStyle)
    
    return citations.map(citation => {
      // Calculate usage count by looking for in-text citations in document
      const inTextCitation = formatter.formatInText(citation)
      const escapedCitation = inTextCitation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(escapedCitation, 'g')
      const matches = documentContent.match(regex) || []
      
      return {
        ...citation,
        usageCount: matches.length,
        isUnused: matches.length === 0,
        lastUsed: matches.length > 0 ? new Date() : undefined
      } as BibliographyEntry
    })
  }, [citations, citationStyle, documentContent])

  // Group and sort citations
  const groupedCitations = useMemo(() => {
    let filteredCitations = processedCitations
    
    // Filter unused citations if needed
    if (!showUnused) {
      filteredCitations = filteredCitations.filter(c => !c.isUnused)
    }

    // Sort citations
    filteredCitations.sort((a, b) => {
      switch (sortBy) {
        case 'year':
          return (b.year || 0) - (a.year || 0)
        case 'usage':
          return (b.usageCount || 0) - (a.usageCount || 0)
        case 'alphabetical':
        default:
          const aAuthor = a.authors[0]?.family || ''
          const bAuthor = b.authors[0]?.family || ''
          return aAuthor.localeCompare(bAuthor)
      }
    })

    // Group citations
    if (groupBy === 'none') {
      return [{
        label: 'All References',
        citations: filteredCitations,
        count: filteredCitations.length
      }]
    }

    const groups = new Map<string, BibliographyEntry[]>()

    filteredCitations.forEach(citation => {
      let groupKey: string

      switch (groupBy) {
        case 'type':
          groupKey = citation.type || 'other'
          break
        case 'year':
          const decade = citation.year ? Math.floor(citation.year / 10) * 10 : 'No date'
          groupKey = decade === 'No date' ? 'No date' : `${decade}s`
          break
        case 'author':
          groupKey = citation.authors[0]?.family?.charAt(0).toUpperCase() || '#'
          break
        default:
          groupKey = 'All'
      }

      if (!groups.has(groupKey)) {
        groups.set(groupKey, [])
      }
      groups.get(groupKey)!.push(citation)
    })

    return Array.from(groups.entries())
      .map(([label, citations]) => ({
        label: formatGroupLabel(label, groupBy),
        citations,
        count: citations.length
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [processedCitations, groupBy, showUnused, sortBy])

  const totalCitations = citations.length
  const usedCitations = processedCitations.filter(c => !c.isUnused).length
  const unusedCitations = totalCitations - usedCitations

  const toggleGroupExpansion = (groupLabel: string) => {
    const newExpanded = new Set(expandedGroups)
    if (newExpanded.has(groupLabel)) {
      newExpanded.delete(groupLabel)
    } else {
      newExpanded.add(groupLabel)
    }
    setExpandedGroups(newExpanded)
  }

  const copyBibliography = async () => {
    const formatter = CitationFormatterFactory.createFormatter(citationStyle)
    const bibliography = processedCitations
      .filter(c => showUnused || !c.isUnused)
      .map((citation, index) => `${index + 1}. ${formatter.formatBibliography(citation)}`)
      .join('\n\n')

    try {
      await navigator.clipboard.writeText(bibliography)
      toast.success('Bibliography copied to clipboard')
    } catch (error) {
      toast.error('Failed to copy bibliography')
    }
  }

  const exportBibliography = (format: 'bibtex' | 'ris') => {
    // Placeholder for export functionality
    toast.info(`Export to ${format.toUpperCase()} coming soon`)
  }

  return (
    <div className={`bg-white rounded-lg shadow-sm border ${className}`}>
      {/* Header Controls */}
      <div className="p-6 border-b">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">References</h2>
            <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
              <span>{totalCitations} total</span>
              <span>•</span>
              <span className="text-green-600">{usedCitations} used</span>
              {unusedCitations > 0 && (
                <>
                  <span>•</span>
                  <span className="text-orange-600">{unusedCitations} unused</span>
                </>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={copyBibliography}>
              <Copy className="h-4 w-4 mr-1" />
              Copy All
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportBibliography('bibtex')}>
              <Download className="h-4 w-4 mr-1" />
              Export
            </Button>
          </div>
        </div>

        {/* Controls Row */}
        <div className="flex flex-wrap gap-3">
          <Select value={citationStyle} onValueChange={(value: CitationStyle) => setCitationStyle(value)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Citation Style" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="apa7">APA 7th</SelectItem>
              <SelectItem value="mla9">MLA 9th</SelectItem>
              <SelectItem value="chicago17">Chicago 17th</SelectItem>
            </SelectContent>
          </Select>

          <Select value={groupBy} onValueChange={(value: typeof groupBy) => setGroupBy(value)}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Group by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No Grouping</SelectItem>
              <SelectItem value="type">By Type</SelectItem>
              <SelectItem value="year">By Decade</SelectItem>
              <SelectItem value="author">By Author</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={(value: typeof sortBy) => setSortBy(value)}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="alphabetical">Alphabetical</SelectItem>
              <SelectItem value="year">Year</SelectItem>
              <SelectItem value="usage">Usage</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant={showUnused ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowUnused(!showUnused)}
          >
            {showUnused ? <Eye className="h-4 w-4 mr-1" /> : <EyeOff className="h-4 w-4 mr-1" />}
            {showUnused ? 'Hide' : 'Show'} Unused
          </Button>
        </div>
      </div>

      {/* Bibliography Entries */}
      <div className="p-6">
        {groupedCitations.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No citations to display</p>
            <p className="text-sm mt-1">Add citations to your document to see them here</p>
          </div>
        ) : (
          <div className="space-y-4">
            {groupedCitations.map((group) => (
              <BibliographyGroup
                key={group.label}
                group={group}
                style={citationStyle}
                isExpanded={expandedGroups.has(group.label)}
                onToggleExpansion={() => toggleGroupExpansion(group.label)}
                showGrouping={groupBy !== 'none'}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function BibliographyGroup({
  group,
  style,
  isExpanded,
  onToggleExpansion,
  showGrouping
}: {
  group: BibliographyGroup
  style: CitationStyle
  isExpanded: boolean
  onToggleExpansion: () => void
  showGrouping: boolean
}) {
  if (!showGrouping) {
    return (
      <div className="space-y-3">
        {group.citations.map((citation, index) => (
          <BibliographyEntryComponent
            key={citation.doi || citation.url || citation.title}
            citation={citation}
            style={style}
            number={index + 1}
          />
        ))}
      </div>
    )
  }

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggleExpansion}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-between p-2 h-auto">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-gray-700">{group.label}</h3>
            <Badge variant="secondary" className="text-xs">
              {group.count}
            </Badge>
          </div>
          <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 mt-2">
        {group.citations.map((citation, index) => (
          <BibliographyEntryComponent
            key={citation.doi || citation.url || citation.title}
            citation={citation}
            style={style}
            number={index + 1}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

function BibliographyEntryComponent({
  citation,
  style,
  number
}: {
  citation: BibliographyEntry
  style: CitationStyle
  number: number
}) {
  const [showDetails, setShowDetails] = useState(false)
  const formatter = CitationFormatterFactory.createFormatter(style)
  const formattedCitation = formatter.formatBibliography(citation)

  return (
    <div className={`p-4 rounded-lg border ${citation.isUnused ? 'bg-orange-50 border-orange-200' : 'bg-white border-gray-200'}`}>
      <div className="flex items-start gap-3">
        <span className="flex-shrink-0 text-sm text-gray-500 font-medium min-w-[2rem]">
          [{number}]
        </span>
        
        <div className="flex-1 min-w-0">
          <div className="text-sm text-gray-800 leading-relaxed">
            {formattedCitation}
          </div>
          
          <div className="flex items-center gap-3 mt-2">
            {citation.isUnused && (
              <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">
                Unused
              </Badge>
            )}
            
            {citation.usageCount && citation.usageCount > 0 && (
              <Badge variant="outline" className="text-xs text-green-600 border-green-300">
                Used {citation.usageCount} time{citation.usageCount !== 1 ? 's' : ''}
              </Badge>
            )}
            
            {(citation.doi || citation.url) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const url = citation.doi 
                    ? `https://doi.org/${citation.doi}`
                    : citation.url
                  window.open(url, '_blank')
                }}
                className="h-6 px-2 text-xs"
              >
                <ExternalLink className="h-3 w-3 mr-1" />
                View Source
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDetails(!showDetails)}
              className="h-6 px-2 text-xs"
            >
              <Info className="h-3 w-3 mr-1" />
              Details
            </Button>
          </div>

          {showDetails && (
            <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-600 space-y-1">
              <p><span className="font-medium">Type:</span> {citation.type}</p>
              {citation.doi && <p><span className="font-medium">DOI:</span> {citation.doi}</p>}
              {citation.abstract && (
                <p className="line-clamp-3">
                  <span className="font-medium">Abstract:</span> {citation.abstract}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function formatGroupLabel(label: string, groupBy: 'type' | 'year' | 'author'): string {
  switch (groupBy) {
    case 'type':
      const typeLabels: Record<string, string> = {
        'article': 'Journal Articles',
        'book': 'Books',
        'conference': 'Conference Papers',
        'website': 'Web Sources',
        'thesis': 'Theses & Dissertations',
        'other': 'Other Sources'
      }
      return typeLabels[label] || label
    case 'year':
      return label
    case 'author':
      return label === '#' ? 'Other Authors' : `Authors: ${label}`
    default:
      return label
  }
} 