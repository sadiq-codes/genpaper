// Modern Citation UI Components

// 1. Smart Citation Search with Real-time Results
export function CitationSearch({ onSelect }: { onSelect: (citation: Citation) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [activeSource, setActiveSource] = useState<'all' | 'library' | 'crossref' | 'scholar'>('all')
  
  // Debounced search
  const debouncedSearch = useMemo(
    () => debounce(async (searchQuery: string) => {
      if (searchQuery.length < 3) {
        setResults([])
        return
      }
      
      setLoading(true)
      try {
        const searchResults = await searchCitations(searchQuery, activeSource)
        setResults(searchResults)
      } finally {
        setLoading(false)
      }
    }, 300),
    [activeSource]
  )
  
  useEffect(() => {
    debouncedSearch(query)
  }, [query, debouncedSearch])
  
  return (
    <div className="relative">
      {/* Search Input with Smart Features */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title, author, DOI, or paste a reference..."
          className="w-full px-4 py-3 pr-10 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500"
        />
        {loading && (
          <div className="absolute right-3 top-3">
            <Spinner className="w-5 h-5 text-blue-500" />
          </div>
        )}
      </div>
      
      {/* Source Tabs */}
      <div className="flex gap-2 mt-2">
        {(['all', 'library', 'crossref', 'scholar'] as const).map(source => (
          <button
            key={source}
            onClick={() => setActiveSource(source)}
            className={`px-3 py-1 text-xs rounded-full transition ${
              activeSource === source 
                ? 'bg-blue-500 text-white' 
                : 'bg-gray-100 hover:bg-gray-200'
            }`}
          >
            {source.charAt(0).toUpperCase() + source.slice(1)}
          </button>
        ))}
      </div>
      
      {/* Search Results */}
      {results.length > 0 && (
        <div className="absolute z-10 w-full mt-2 bg-white border rounded-lg shadow-lg max-h-96 overflow-y-auto">
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
    </div>
  )
}

// 2. Interactive Citation Card
function SearchResultItem({ result, onSelect }: { result: SearchResult; onSelect: () => void }) {
  const [expanded, setExpanded] = useState(false)
  
  return (
    <div className="p-3 hover:bg-gray-50 border-b last:border-b-0">
      <div className="flex justify-between items-start">
        <div className="flex-1 mr-2">
          <h4 className="text-sm font-medium text-gray-900 line-clamp-2">
            {result.citation.title}
          </h4>
          <p className="text-xs text-gray-600 mt-1">
            {formatAuthorsShort(result.citation.authors)} • {result.citation.year || 'n.d.'}
          </p>
          {result.citation.journal && (
            <p className="text-xs text-gray-500 italic">{result.citation.journal}</p>
          )}
        </div>
        
        <div className="flex gap-1">
          {result.inLibrary && (
            <span className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded">
              In Library
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              setExpanded(!expanded)
            }}
            className="p-1 hover:bg-gray-200 rounded"
          >
            <ChevronDown className={`w-4 h-4 transition ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>
      
      {expanded && (
        <div className="mt-3 pt-3 border-t">
          {result.citation.abstract && (
            <p className="text-xs text-gray-600 line-clamp-3">{result.citation.abstract}</p>
          )}
          <div className="flex gap-2 mt-3">
            <button
              onClick={onSelect}
              className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Add Citation
            </button>
            {result.citation.doi && (
              <a
                href={`https://doi.org/${result.citation.doi}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded"
              >
                View Source
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// 3. In-Document Citation Manager
export function DocumentCitationManager({ projectId, content }: { projectId: string; content: string }) {
  const [citations, setCitations] = useState<Map<string, Citation>>(new Map())
  const [selectedText, setSelectedText] = useState<string | null>(null)
  const [showCitationMenu, setShowCitationMenu] = useState(false)
  const [citationStyle, setCitationStyle] = useState<CitationStyle>('apa7')
  
  // Handle text selection
  useEffect(() => {
    const handleSelection = () => {
      const selection = window.getSelection()
      const text = selection?.toString().trim()
      
      if (text && text.length > 10) {
        setSelectedText(text)
        setShowCitationMenu(true)
      } else {
        setShowCitationMenu(false)
      }
    }
    
    document.addEventListener('mouseup', handleSelection)
    return () => document.removeEventListener('mouseup', handleSelection)
  }, [])
  
  const addCitation = async (citation: Citation) => {
    if (!selectedText) return
    
    // Add citation to collection
    setCitations(new Map(citations.set(citation.id, citation)))
    
    // Insert in-text citation at cursor position
    const inTextCitation = formatInTextCitation(citation, citationStyle)
    // Implementation to insert at cursor position
    
    setShowCitationMenu(false)
    setSelectedText(null)
  }
  
  return (
    <>
      {/* Floating Citation Menu */}
      {showCitationMenu && selectedText && (
        <FloatingMenu>
          <div className="p-4 bg-white rounded-lg shadow-xl border w-96">
            <h3 className="text-sm font-medium mb-3">Add Citation for:</h3>
            <p className="text-xs text-gray-600 mb-3 italic">"{selectedText}"</p>
            
            <CitationSearch onSelect={addCitation} />
            
            <div className="mt-3 pt-3 border-t">
              <button
                onClick={() => setShowCitationMenu(false)}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </FloatingMenu>
      )}
      
      {/* Citation Style Selector */}
      <div className="fixed bottom-4 right-4 bg-white rounded-lg shadow-lg p-3">
        <select
          value={citationStyle}
          onChange={(e) => setCitationStyle(e.target.value as CitationStyle)}
          className="text-xs border rounded px-2 py-1"
        >
          <option value="apa7">APA 7th</option>
          <option value="mla9">MLA 9th</option>
          <option value="chicago17">Chicago 17th</option>
          <option value="ieee">IEEE</option>
        </select>
      </div>
    </>
  )
}

// 4. Smart Bibliography Generator
export function SmartBibliography({ projectId }: { projectId: string }) {
  const [citations, setCitations] = useState<Citation[]>([])
  const [style, setStyle] = useState<CitationStyle>('apa7')
  const [groupBy, setGroupBy] = useState<'none' | 'type' | 'year'>('none')
  const [showUnused, setShowUnused] = useState(false)
  
  return (
    <div className="bg-white rounded-lg shadow p-6">
      {/* Controls */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">References</h2>
        
        <div className="flex gap-3">
          <select
            value={style}
            onChange={(e) => setStyle(e.target.value as CitationStyle)}
            className="text-sm border rounded px-3 py-1"
          >
            <option value="apa7">APA 7th</option>
            <option value="mla9">MLA 9th</option>
            <option value="chicago17">Chicago 17th</option>
          </select>
          
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}
            className="text-sm border rounded px-3 py-1"
          >
            <option value="none">No Grouping</option>
            <option value="type">By Type</option>
            <option value="year">By Year</option>
          </select>
          
          <button
            onClick={() => setShowUnused(!showUnused)}
            className={`text-sm px-3 py-1 rounded ${
              showUnused ? 'bg-gray-200' : 'bg-gray-100'
            }`}
          >
            {showUnused ? 'Hide' : 'Show'} Unused
          </button>
        </div>
      </div>
      
      {/* Bibliography Entries */}
      <div className="space-y-3">
        {getGroupedCitations(citations, groupBy).map((group) => (
          <div key={group.label}>
            {groupBy !== 'none' && (
              <h3 className="text-sm font-medium text-gray-700 mb-2">{group.label}</h3>
            )}
            <div className="space-y-2">
              {group.citations.map((citation, index) => (
                <BibliographyEntry
                  key={citation.id}
                  citation={citation}
                  style={style}
                  number={index + 1}
                  isUnused={!citation.usageCount}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      
      {/* Export Options */}
      <div className="mt-6 pt-6 border-t flex gap-3">
        <button className="text-sm px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
          Copy All
        </button>
        <button className="text-sm px-4 py-2 border rounded hover:bg-gray-50">
          Export BibTeX
        </button>
        <button className="text-sm px-4 py-2 border rounded hover:bg-gray-50">
          Export RIS
        </button>
      </div>
    </div>
  )
}

// Helper Components and Functions
function BibliographyEntry({ 
  citation, 
  style, 
  number, 
  isUnused 
}: { 
  citation: Citation
  style: CitationStyle
  number: number
  isUnused: boolean
}) {
  const [showDetails, setShowDetails] = useState(false)
  const formattedCitation = formatBibliographyEntry(citation, style)
  
  return (
    <div className={`p-3 rounded ${isUnused ? 'bg-gray-50 opacity-60' : 'bg-white border'}`}>
      <div className="flex items-start">
        <span className="text-sm text-gray-500 mr-3">[{number}]</span>
        <div className="flex-1">
          <p className="text-sm text-gray-800">{formattedCitation}</p>
          {isUnused && (
            <span className="text-xs text-orange-600 mt-1 inline-block">Unused in document</span>
          )}
        </div>
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="p-1 hover:bg-gray-100 rounded"
        >
          <Info className="w-4 h-4 text-gray-400" />
        </button>
      </div>
      
      {showDetails && (
        <div className="mt-3 pt-3 border-t text-xs text-gray-600">
          <p>Added: {new Date(citation.createdAt).toLocaleDateString()}</p>
          <p>Used {citation.usageCount || 0} times</p>
          {citation.doi && <p>DOI: {citation.doi}</p>}
        </div>
      )}
    </div>
  )
}

// Utility functions
function formatAuthorsShort(authors: Author[]): string {
  if (!authors || authors.length === 0) return 'Unknown'
  if (authors.length === 1) return authors[0].family
  if (authors.length === 2) return `${authors[0].family} & ${authors[1].family}`
  return `${authors[0].family} et al.`
}

function formatInTextCitation(citation: Citation, style: CitationStyle): string {
  // Simplified - would use the formatter classes
  switch (style) {
    case 'apa7':
      return `(${formatAuthorsShort(citation.authors)}, ${citation.year || 'n.d.'})`
    case 'mla9':
      return `(${authors[0].family}${citation.pages ? ' ' + citation.pages : ''})`
    default:
      return `[${citation.id}]`
  }
}

function getGroupedCitations(
  citations: Citation[], 
  groupBy: 'none' | 'type' | 'year'
): Array<{ label: string; citations: Citation[] }> {
  if (groupBy === 'none') {
    return [{ label: 'All References', citations }]
  }
  
  // Group implementation
  return []
} 