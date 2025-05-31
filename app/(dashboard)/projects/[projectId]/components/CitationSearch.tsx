'use client'

import { useState, useEffect, useMemo } from 'react'
import { Search, ChevronDown, ExternalLink, Plus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { debounce } from 'lodash-es'

import { 
  CitationSourceRegistry, 
  CrossRefAdapter, 
  ArxivAdapter, 
  LocalLibraryAdapter,
  type Citation 
} from '@/lib/citations/citation-sources'

interface SearchResult {
  id: string
  citation: Citation
  source: string
  inLibrary: boolean
  confidence?: number
}

interface CitationSearchProps {
  onSelect: (citation: Citation) => void
  existingCitations?: Citation[]
  className?: string
}

export function CitationSearch({ onSelect, existingCitations = [], className }: CitationSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [activeSource, setActiveSource] = useState<'all' | 'library' | 'crossref' | 'arxiv'>('all')
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Initialize citation source registry
  const citationRegistry = useMemo(() => {
    const registry = new CitationSourceRegistry()
    registry.register(new CrossRefAdapter())
    registry.register(new ArxivAdapter())
    registry.register(new LocalLibraryAdapter(existingCitations))
    return registry
  }, [existingCitations])

  // Debounced search function
  const debouncedSearch = useMemo(
    () => debounce(async (searchQuery: string, source: typeof activeSource) => {
      if (searchQuery.length < 3) {
        setResults([])
        return
      }

      setLoading(true)
      try {
        let searchResults: SearchResult[] = []

        if (source === 'all') {
          // Search all sources
          const allResults = await citationRegistry.searchAll(searchQuery, 20)
          searchResults = allResults.flatMap(({ source: sourceName, citations }) =>
            citations.map(citation => ({
              id: citation.doi || citation.url || citation.title,
              citation,
              source: sourceName,
              inLibrary: sourceName === 'Library'
            }))
          )
        } else {
          // Search specific source
          let sourceAdapter
          switch (source) {
            case 'library':
              sourceAdapter = citationRegistry.getSource('Library')
              break
            case 'crossref':
              sourceAdapter = citationRegistry.getSource('CrossRef')
              break
            case 'arxiv':
              sourceAdapter = citationRegistry.getSource('arXiv')
              break
          }

          if (sourceAdapter) {
            const citations = await sourceAdapter.search(searchQuery, 20)
            searchResults = citations.map(citation => ({
              id: citation.doi || citation.url || citation.title,
              citation,
              source: sourceAdapter.name,
              inLibrary: sourceAdapter.name === 'Library'
            }))
          }
        }

        // Sort results: library first, then by relevance
        searchResults.sort((a, b) => {
          if (a.inLibrary && !b.inLibrary) return -1
          if (!a.inLibrary && b.inLibrary) return 1
          return 0
        })

        setResults(searchResults)
      } catch (error) {
        console.error('Search error:', error)
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300),
    [citationRegistry]
  )

  useEffect(() => {
    debouncedSearch(query, activeSource)
  }, [query, activeSource, debouncedSearch])

  // Handle DOI/URL paste detection
  const handleQueryChange = (value: string) => {
    setQuery(value)

    // Auto-detect DOI or arXiv ID
    const doiMatch = value.match(/10\.\d{4,}\/[-._;()\/:a-zA-Z0-9]+/i)
    const arxivMatch = value.match(/(?:arxiv:)?(\d{4}\.\d{4,5})/i)

    if (doiMatch && value.length > 10) {
      // Fetch by DOI
      citationRegistry.fetchByIdentifier(doiMatch[0], 'doi').then(citation => {
        if (citation) {
          setResults([{
            id: citation.doi || citation.title,
            citation,
            source: 'DOI Lookup',
            inLibrary: false
          }])
        }
      })
    } else if (arxivMatch && value.length > 8) {
      // Fetch by arXiv ID
      citationRegistry.fetchByIdentifier(arxivMatch[1], 'arxiv').then(citation => {
        if (citation) {
          setResults([{
            id: citation.url || citation.title,
            citation,
            source: 'arXiv',
            inLibrary: false
          }])
        }
      })
    }
  }

  const sourceTabs = [
    { key: 'all' as const, label: 'All Sources', count: results.length },
    { key: 'library' as const, label: 'Library', count: results.filter(r => r.inLibrary).length },
    { key: 'crossref' as const, label: 'CrossRef', count: results.filter(r => r.source === 'CrossRef').length },
    { key: 'arxiv' as const, label: 'arXiv', count: results.filter(r => r.source === 'arXiv').length }
  ]

  return (
    <div className={`relative ${className}`}>
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
        <Input
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Search by title, author, DOI, or paste a reference..."
          className="pl-10 pr-10"
        />
        {loading && (
          <div className="absolute right-3 top-3">
            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
          </div>
        )}
      </div>

      {/* Source Tabs */}
      <div className="flex gap-1 mt-3 overflow-x-auto">
        {sourceTabs.map(tab => (
          <Button
            key={tab.key}
            variant={activeSource === tab.key ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveSource(tab.key)}
            className="whitespace-nowrap"
          >
            {tab.label}
            {tab.count > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">
                {tab.count}
              </Badge>
            )}
          </Button>
        ))}
      </div>

      {/* Search Results */}
      {results.length > 0 && (
        <div className="absolute z-50 w-full mt-2 bg-white border rounded-lg shadow-lg max-h-96 overflow-y-auto">
          {results.map((result) => (
            <SearchResultItem
              key={result.id}
              result={result}
              onSelect={() => {
                onSelect(result.citation)
                setQuery('')
                setResults([])
              }}
            />
          ))}
        </div>
      )}

      {/* No Results */}
      {query.length >= 3 && !loading && results.length === 0 && (
        <div className="absolute z-50 w-full mt-2 bg-white border rounded-lg shadow-lg p-4 text-center text-gray-500">
          <p className="text-sm">No citations found for "{query}"</p>
          <p className="text-xs text-gray-400 mt-1">
            Try searching with different keywords or check the spelling
          </p>
        </div>
      )}
    </div>
  )
}

function SearchResultItem({ result, onSelect }: { result: SearchResult; onSelect: () => void }) {
  const [expanded, setExpanded] = useState(false)

  const formatAuthorsShort = (authors: Citation['authors']): string => {
    if (!authors || authors.length === 0) return 'Unknown'
    if (authors.length === 1) return authors[0].family
    if (authors.length === 2) return `${authors[0].family} & ${authors[1].family}`
    return `${authors[0].family} et al.`
  }

  const getSourceBadgeColor = (source: string) => {
    switch (source) {
      case 'Library': return 'bg-green-100 text-green-800'
      case 'CrossRef': return 'bg-blue-100 text-blue-800'
      case 'arXiv': return 'bg-purple-100 text-purple-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="p-4 hover:bg-gray-50 border-b last:border-b-0 cursor-pointer" onClick={onSelect}>
      <div className="flex justify-between items-start">
        <div className="flex-1 mr-3">
          <h4 className="text-sm font-medium text-gray-900 line-clamp-2 mb-1">
            {result.citation.title}
          </h4>
          
          <div className="flex items-center gap-2 mb-2">
            <p className="text-xs text-gray-600">
              {formatAuthorsShort(result.citation.authors)} 
              {result.citation.year && ` • ${result.citation.year}`}
            </p>
            
            <Badge className={`text-xs ${getSourceBadgeColor(result.source)}`}>
              {result.source}
            </Badge>
          </div>

          {result.citation.journal && (
            <p className="text-xs text-gray-500 italic mb-2">
              {result.citation.journal}
            </p>
          )}

          {expanded && result.citation.abstract && (
            <p className="text-xs text-gray-600 line-clamp-3 mb-3">
              {result.citation.abstract}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          {result.inLibrary && (
            <Badge className="bg-green-100 text-green-700 text-xs">
              In Library
            </Badge>
          )}
          
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              setExpanded(!expanded)
            }}
            className="h-6 w-6 p-0"
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t flex gap-2">
          <Button size="sm" onClick={(e) => { e.stopPropagation(); onSelect() }}>
            <Plus className="h-3 w-3 mr-1" />
            Add Citation
          </Button>
          
          {(result.citation.doi || result.citation.url) && (
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                const url = result.citation.doi 
                  ? `https://doi.org/${result.citation.doi}`
                  : result.citation.url
                window.open(url, '_blank')
              }}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              View Source
            </Button>
          )}
        </div>
      )}
    </div>
  )
} 