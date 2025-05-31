'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Check, Search, ChevronDown, X } from 'lucide-react';
import { 
  POPULAR_STYLES, 
  JOURNAL_STYLES, 
  searchStyles, 
  getStyleInfo 
} from '@/lib/citations/csl-manager';

interface CitationStyleSelectorProps {
  value: string;
  onChange: (styleId: string) => void;
  className?: string;
  showSearch?: boolean;
}

export function CitationStyleSelector({ 
  value, 
  onChange, 
  className = '',
  showSearch = true 
}: CitationStyleSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: string; name: string }>>([]);
  const [currentStyleName, setCurrentStyleName] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // Get current style name
  useEffect(() => {
    const loadStyleName = async () => {
      try {
        const info = await getStyleInfo(value);
        setCurrentStyleName(info.titleShort || info.title);
      } catch {
        // Find in predefined lists
        const style = [...POPULAR_STYLES, ...JOURNAL_STYLES].find(s => s.id === value);
        setCurrentStyleName(style?.name || value);
      }
    };
    loadStyleName();
  }, [value]);

  // Search styles
  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const results = await searchStyles(query);
      setSearchResults(results);
    } catch (error) {
      console.error('Search error:', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleSelect = useCallback((styleId: string) => {
    onChange(styleId);
    setIsOpen(false);
    setSearchQuery('');
    setSearchResults([]);
  }, [onChange]);

  // Combined list for display
  const displayStyles = useMemo(() => {
    if (searchQuery && searchResults.length > 0) {
      return searchResults;
    }
    return POPULAR_STYLES;
  }, [searchQuery, searchResults]);

  return (
    <div className={`relative ${className}`}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <span className="truncate">{currentStyleName || 'Select style'}</span>
        <ChevronDown className={`w-4 h-4 ml-2 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setIsOpen(false)}
          />
          
          {/* Dropdown Content */}
          <div className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg max-w-md">
            {/* Search Box */}
            {showSearch && (
              <div className="p-3 border-b">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => handleSearch(e.target.value)}
                    placeholder="Search citation styles..."
                    className="w-full pl-9 pr-9 py-2 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                  {searchQuery && (
                    <button
                      onClick={() => {
                        setSearchQuery('');
                        setSearchResults([]);
                      }}
                      className="absolute right-2 top-2 p-1 hover:bg-gray-100 rounded"
                    >
                      <X className="w-4 h-4 text-gray-400" />
                    </button>
                  )}
                </div>
                
                {isSearching && (
                  <p className="text-xs text-gray-500 mt-2">Searching...</p>
                )}
                
                {searchQuery && !isSearching && searchResults.length === 0 && (
                  <p className="text-xs text-gray-500 mt-2">No styles found for "{searchQuery}"</p>
                )}
              </div>
            )}

            {/* Style Categories */}
            <div className="max-h-96 overflow-y-auto">
              {!searchQuery && (
                <>
                  {/* Popular Styles */}
                  <div className="p-2">
                    <h3 className="px-2 py-1 text-xs font-medium text-gray-500 uppercase">
                      Popular Styles
                    </h3>
                    {POPULAR_STYLES.map(style => (
                      <StyleOption
                        key={style.id}
                        style={style}
                        isSelected={value === style.id}
                        onSelect={() => handleSelect(style.id)}
                      />
                    ))}
                  </div>

                  {/* Journal Styles */}
                  <div className="p-2 border-t">
                    <h3 className="px-2 py-1 text-xs font-medium text-gray-500 uppercase">
                      Journal Styles
                    </h3>
                    {JOURNAL_STYLES.map(style => (
                      <StyleOption
                        key={style.id}
                        style={style}
                        isSelected={value === style.id}
                        onSelect={() => handleSelect(style.id)}
                      />
                    ))}
                  </div>
                </>
              )}

              {/* Search Results */}
              {searchQuery && searchResults.length > 0 && (
                <div className="p-2">
                  <h3 className="px-2 py-1 text-xs font-medium text-gray-500">
                    Search Results ({searchResults.length})
                  </h3>
                  {displayStyles.map(style => (
                    <StyleOption
                      key={style.id}
                      style={style}
                      isSelected={value === style.id}
                      onSelect={() => handleSelect(style.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Footer with Links */}
            <div className="p-3 border-t bg-gray-50">
              <div className="flex items-center justify-between text-xs">
                <a
                  href="https://www.zotero.org/styles"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  Browse all 9,000+ styles
                </a>
                <span className="text-gray-500">
                  Powered by CSL
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StyleOption({ 
  style, 
  isSelected, 
  onSelect 
}: { 
  style: { id: string; name: string };
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full px-3 py-2 text-sm text-left rounded hover:bg-gray-100 flex items-center justify-between ${
        isSelected ? 'bg-blue-50 text-blue-700' : ''
      }`}
    >
      <span>{style.name}</span>
      {isSelected && <Check className="w-4 h-4" />}
    </button>
  );
} 