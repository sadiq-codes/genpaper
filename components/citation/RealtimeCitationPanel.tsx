'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';
import { formatCitations } from '@/lib/citations/csl-manager';
import { CitationStyleSelector } from './CitationStyleSelector';

interface Citation {
  id: string;
  citation_key: string;
  title: string;
  authors: Array<{ family: string; given: string }>;
  year?: number;
  journal?: string;
  doi?: string;
  metadata?: any;
  enriched_at?: string;
  links?: Array<{
    section: string;
    start: number;
    end: number;
    text_segment?: string;
    reason?: string;
  }>;
}

interface RealtimeCitationPanelProps {
  projectId: string;
  citationStyle?: string;
  onStyleChange?: (style: string) => void;
  pageSize?: number;
}

export function RealtimeCitationPanel({ 
  projectId, 
  citationStyle = 'apa',
  onStyleChange,
  pageSize = 50
}: RealtimeCitationPanelProps) {
  const [citations, setCitations] = useState<Citation[]>([]);
  const [bibliography, setBibliography] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [copyToast, setCopyToast] = useState(false);
  const [newCitationsCount, setNewCitationsCount] = useState(0);
  const [currentStyle, setCurrentStyle] = useState(citationStyle);
  
  const lastUpdateRef = useRef<number>(0);

  // Handle style change
  const handleStyleChange = useCallback((newStyle: string) => {
    setCurrentStyle(newStyle);
    if (onStyleChange) {
      onStyleChange(newStyle);
    }
  }, [onStyleChange]);

  // Memoized load function
  const loadCitations = useCallback(async (append = false) => {
    if (!append) setIsLoading(true);
    
    const from = append ? page * pageSize : 0;
    const to = from + pageSize - 1;
    
    const { data, error, count } = await supabase
      .from('citations_with_links')
      .select('*', { count: 'exact' })
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .range(from, to);

    if (!error && data) {
      if (append) {
        setCitations(prev => [...prev, ...data]);
      } else {
        setCitations(data);
      }
      
      setHasMore((count || 0) > (from + data.length));
      lastUpdateRef.current = Date.now();
    }
    
    setIsLoading(false);
  }, [projectId, page, pageSize, supabase]);

  // Initial load
  useEffect(() => {
    loadCitations();
  }, [projectId, loadCitations]);

  // Real-time subscription with optimized updates
  useEffect(() => {
    const channel = supabase
      .channel(`project:${projectId}`)
      .on('broadcast', { event: 'citations_updated' }, (payload: any) => {
        console.log('Citation update received:', payload);
        
        // Show new citations badge
        if (payload.payload?.newCitations > 0) {
          setNewCitationsCount(prev => prev + payload.payload.newCitations);
        }
        
        // Only reload if we're on the first page or if it's been > 5s since last update
        const now = Date.now();
        if (page === 0 || now - lastUpdateRef.current > 5000) {
          loadCitations();
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, page, loadCitations, supabase]);

  // Format bibliography when citations change or style changes
  useEffect(() => {
    if (citations.length > 0) {
      formatBibliography();
    }
  }, [citations, currentStyle]);

  const formatBibliography = useCallback(async () => {
    try {
      // Convert to CSL JSON format
      const cslData = citations.map(citation => ({
        id: citation.id,
        type: 'article-journal',
        title: citation.title,
        author: citation.authors.length > 0 ? citation.authors : [{ family: 'Anonymous', given: '' }],
        issued: citation.year ? { 'date-parts': [[citation.year]] } : undefined,
        'container-title': citation.journal,
        DOI: citation.doi,
        ...citation.metadata // Include any CSL data from enrichment
      }));

      // Format using CSL manager
      const formatted = await formatCitations(cslData, currentStyle, 'bibliography');
      setBibliography(formatted);
    } catch (error) {
      console.error('Error formatting bibliography:', error);
      setBibliography('Error formatting bibliography');
    }
  }, [citations, currentStyle]);

  const handleCopyBibliography = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(bibliography);
      setCopyToast(true);
      setTimeout(() => setCopyToast(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }, [bibliography]);

  const handleLoadMore = useCallback(() => {
    setPage(prev => prev + 1);
    loadCitations(true);
  }, [loadCitations]);

  const handleRefresh = useCallback(() => {
    setPage(0);
    setNewCitationsCount(0);
    loadCitations();
  }, [loadCitations]);

  if (isLoading && citations.length === 0) {
    return (
      <div className="animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/2 mb-4"></div>
        <div className="space-y-3">
          <div className="h-3 bg-gray-200 rounded"></div>
          <div className="h-3 bg-gray-200 rounded w-5/6"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 relative">
      {/* New citations notification */}
      {newCitationsCount > 0 && (
        <div className="absolute -top-2 right-0 z-10">
          <button
            onClick={handleRefresh}
            className="bg-blue-500 text-white text-xs px-3 py-1 rounded-full hover:bg-blue-600 animate-pulse"
          >
            {newCitationsCount} new citation{newCitationsCount !== 1 ? 's' : ''} ↻
          </button>
        </div>
      )}

      {/* Citation Count with Real-time Indicator and Style Selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold">
            Citations ({citations.length})
          </h3>
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span className="text-xs text-gray-500">Live</span>
          </div>
        </div>
        <CitationStyleSelector 
          value={currentStyle}
          onChange={handleStyleChange}
          className="w-48"
          showSearch={false}
        />
      </div>

      {/* Citation List */}
      <div className="space-y-3">
        {citations.map((citation, index) => (
          <CitationCard key={citation.id} citation={citation} index={index + 1} />
        ))}
      </div>

      {/* Load More */}
      {hasMore && (
        <div className="text-center pt-4">
          <button
            onClick={handleLoadMore}
            disabled={isLoading}
            className="text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50"
          >
            {isLoading ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}

      {/* Formatted Bibliography */}
      {bibliography && citations.length > 0 && (
        <div className="mt-8 pt-8 border-t">
          <div className="flex justify-between items-center mb-4">
            <h4 className="font-semibold">References</h4>
            <button
              onClick={handleCopyBibliography}
              className="text-sm text-blue-600 hover:text-blue-700 relative"
            >
              Copy All
              {copyToast && (
                <span className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded">
                  Copied ✓
                </span>
              )}
            </button>
          </div>
          <div className="prose prose-sm max-w-none">
            <pre className="whitespace-pre-wrap font-serif text-sm bg-gray-50 p-4 rounded">
              {bibliography}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function CitationCard({ citation, index }: { citation: Citation; index: number }) {
  const [expanded, setExpanded] = useState(false);
  
  return (
    <div className="bg-white border rounded-lg p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start space-x-3">
        <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-700 rounded-full text-xs font-medium flex items-center justify-center">
          {index}
        </span>
        
        <div className="flex-1 min-w-0">
          <h5 className="text-sm font-medium text-gray-900 line-clamp-2">
            {citation.title}
          </h5>
          
          <p className="text-xs text-gray-600 mt-1">
            {citation.authors.length > 0 
              ? citation.authors.map(a => a.family).join(', ')
              : 'Anonymous'}
            {citation.year && ` (${citation.year})`}
            {citation.journal && ` • ${citation.journal}`}
          </p>
          
          <div className="flex items-center gap-2 mt-1">
            {citation.doi && (
              <p className="text-xs text-blue-600">
                DOI: {citation.doi}
              </p>
            )}
            {citation.enriched_at && (
              <span className="text-xs text-green-600">✓ Enriched</span>
            )}
          </div>
          
          {citation.links && citation.links.length > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-gray-500 hover:text-gray-700 mt-2"
            >
              {expanded ? 'Hide' : 'Show'} {citation.links.length} usage{citation.links.length !== 1 ? 's' : ''}
            </button>
          )}
          
          {expanded && citation.links && (
            <div className="mt-2 space-y-1">
              {citation.links.map((link, i) => (
                <div key={i} className="text-xs bg-gray-50 rounded p-2">
                  <span className="font-medium">{link.section}:</span>
                  {link.reason && <span className="text-gray-600 ml-1">{link.reason}</span>}
                  {link.text_segment && (
                    <p className="text-gray-500 mt-1 italic">
                      "{link.text_segment}"
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
} 