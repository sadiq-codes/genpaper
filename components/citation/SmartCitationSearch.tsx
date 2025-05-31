'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { debounce } from 'lodash-es';
import { ChevronDown, Loader2 } from 'lucide-react';
import { Citation } from '@/lib/ai/citation-function-schema';

interface SearchResult {
  id: string;
  citation: Citation;
  source: 'library' | 'crossref' | 'scholar' | 'pubmed';
  relevanceScore?: number;
  inLibrary?: boolean;
  abstract?: string;
}

interface SmartCitationSearchProps {
  projectId: string;
  onSelect: (citation: Citation, source: string) => void;
  className?: string;
}

export function SmartCitationSearch({ 
  projectId, 
  onSelect,
  className = ''
}: SmartCitationSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeSource, setActiveSource] = useState<'all' | 'library' | 'crossref' | 'scholar'>('all');
  
  // Create debounced search function
  const debouncedSearch = useMemo(
    () => debounce(async (searchQuery: string, source: string) => {
      if (searchQuery.length < 3) {
        setResults([]);
        return;
      }
      
      setLoading(true);
      try {
        const searchResults = await searchCitations(searchQuery, source, projectId);
        setResults(searchResults);
      } catch (error) {
        console.error('Search error:', error);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300),
    [projectId]
  );
  
  // Cancel debounced search on unmount
  useEffect(() => {
    return () => {
      debouncedSearch.cancel();
    };
  }, [debouncedSearch]);
  
  // Trigger search when query or source changes
  useEffect(() => {
    debouncedSearch(query, activeSource);
  }, [query, activeSource, debouncedSearch]);
  
  const handleSelect = useCallback((result: SearchResult) => {
    onSelect(result.citation, result.source);
    setQuery('');
    setResults([]);
  }, [onSelect]);
  
  return (
    <div className={`relative ${className}`}>
      {/* Search Input */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title, author, DOI, or paste a reference..."
          className="w-full px-4 py-3 pr-10 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        {loading && (
          <div className="absolute right-3 top-3">
            <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
          </div>
        )}
      </div>
      
      {/* Source Tabs */}
      <div className="flex gap-2 mt-2">
        {(['all', 'library', 'crossref', 'scholar'] as const).map(source => (
          <button
            key={source}
            onClick={() => setActiveSource(source)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              activeSource === source 
                ? 'bg-blue-500 text-white' 
                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
            }`}
          >
            {source.charAt(0).toUpperCase() + source.slice(1)}
          </button>
        ))}
      </div>
      
      {/* Search Results */}
      {results.length > 0 && !loading && (
        <div className="absolute z-50 w-full mt-2 bg-white border rounded-lg shadow-lg max-h-96 overflow-y-auto">
          {results.map((result) => (
            <SearchResultItem
              key={`${result.source}-${result.id}`}
              result={result}
              onSelect={() => handleSelect(result)}
            />
          ))}
        </div>
      )}
      
      {/* No results message */}
      {query.length >= 3 && results.length === 0 && !loading && (
        <div className="absolute z-50 w-full mt-2 bg-white border rounded-lg shadow-lg p-4">
          <p className="text-sm text-gray-500 text-center">No results found for "{query}"</p>
        </div>
      )}
    </div>
  );
}

function SearchResultItem({ 
  result, 
  onSelect 
}: { 
  result: SearchResult; 
  onSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  
  return (
    <div className="p-3 hover:bg-gray-50 border-b last:border-b-0 cursor-pointer" onClick={onSelect}>
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
        
        <div className="flex gap-1 items-start">
          <span className="px-2 py-0.5 text-[10px] bg-gray-100 text-gray-600 rounded uppercase">
            {result.source}
          </span>
          {result.inLibrary && (
            <span className="px-2 py-0.5 text-[10px] bg-green-100 text-green-700 rounded">
              In Library
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="p-1 hover:bg-gray-200 rounded"
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>
      
      {expanded && (
        <div className="mt-3 pt-3 border-t">
          {result.abstract && (
            <p className="text-xs text-gray-600 line-clamp-3 mb-3">{result.abstract}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSelect();
              }}
              className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Add Citation
            </button>
            {result.citation.doi && (
              <a
                href={`https://doi.org/${result.citation.doi}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded text-gray-700"
              >
                View Source
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Search function that queries multiple sources
async function searchCitations(
  query: string, 
  source: string,
  projectId: string
): Promise<SearchResult[]> {
  const sources = source === 'all' 
    ? ['library', 'crossref', 'scholar'] 
    : [source];
  
  const searchPromises = sources.map(src => 
    searchBySource(query, src as any, projectId)
  );
  
  const results = await Promise.allSettled(searchPromises);
  
  // Combine and deduplicate results
  const allResults: SearchResult[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value) {
      allResults.push(...result.value);
    }
  });
  
  // Deduplicate by DOI or title
  const seen = new Map<string, SearchResult>();
  allResults.forEach(result => {
    const key = result.citation.doi || result.citation.title.toLowerCase();
    if (!seen.has(key) || (result.inLibrary && !seen.get(key)?.inLibrary)) {
      seen.set(key, result);
    }
  });
  
  return Array.from(seen.values());
}

// Source-specific search implementations
async function searchBySource(
  query: string, 
  source: 'library' | 'crossref' | 'scholar',
  projectId: string
): Promise<SearchResult[]> {
  switch (source) {
    case 'library':
      return searchLibrary(query, projectId);
    case 'crossref':
      return searchCrossRef(query);
    case 'scholar':
      return searchGoogleScholar(query);
    default:
      return [];
  }
}

// Search user's library
async function searchLibrary(query: string, projectId: string): Promise<SearchResult[]> {
  try {
    const response = await fetch(`/api/citations/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, projectId })
    });
    
    if (!response.ok) throw new Error('Library search failed');
    
    const citations = await response.json();
    
    return citations.map((citation: any) => ({
      id: citation.id,
      citation: {
        doi: citation.doi,
        title: citation.title,
        authors: citation.authors,
        year: citation.year,
        journal: citation.journal,
        reason: 'From your library'
      },
      source: 'library' as const,
      inLibrary: true,
      abstract: citation.metadata?.abstract
    }));
  } catch (error) {
    console.error('Library search error:', error);
    return [];
  }
}

// Search CrossRef
async function searchCrossRef(query: string): Promise<SearchResult[]> {
  try {
    const response = await fetch(`/api/citations/crossref`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    
    if (!response.ok) throw new Error('CrossRef search failed');
    
    const data = await response.json();
    
    return data.items?.map((item: any) => ({
      id: item.DOI,
      citation: {
        doi: item.DOI,
        title: item.title?.[0] || '',
        authors: item.author?.map((a: any) => `${a.family}, ${a.given}`) || [],
        year: item.published?.['date-parts']?.[0]?.[0] || null,
        journal: item['container-title']?.[0] || item.publisher,
        reason: 'Found via CrossRef'
      },
      source: 'crossref' as const,
      abstract: item.abstract
    })) || [];
  } catch (error) {
    console.error('CrossRef search error:', error);
    return [];
  }
}

// Mock Google Scholar search (would need proxy/API in production)
async function searchGoogleScholar(query: string): Promise<SearchResult[]> {
  // In production, this would call your backend API that handles Scholar scraping
  console.warn('Google Scholar search not implemented - would need backend proxy');
  return [];
}

// Helper function
function formatAuthorsShort(authors: string[]): string {
  if (!authors || authors.length === 0) return 'Unknown';
  const firstAuthor = authors[0].split(',')[0]; // Get last name
  if (authors.length === 1) return firstAuthor;
  if (authors.length === 2) {
    const secondAuthor = authors[1].split(',')[0];
    return `${firstAuthor} & ${secondAuthor}`;
  }
  return `${firstAuthor} et al.`;
} 