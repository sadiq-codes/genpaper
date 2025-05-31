'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Download, Copy, Info, Filter } from 'lucide-react';
import { formatCitations } from '@/lib/citations/csl-manager';
import { CitationStyleSelector } from './CitationStyleSelector';

type GroupBy = 'none' | 'type' | 'year' | 'source';

interface Citation {
  id: string;
  citation_key: string;
  type?: string;
  title: string;
  authors: Array<{ family: string; given: string }>;
  year?: number;
  journal?: string;
  doi?: string;
  url?: string;
  metadata?: any;
  created_at: string;
  usage_count?: number;
}

interface SmartBibliographyProps {
  projectId: string;
  initialStyle?: string;
  showExportOptions?: boolean;
  showFilters?: boolean;
}

export function SmartBibliography({ 
  projectId,
  initialStyle = 'apa',
  showExportOptions = true,
  showFilters = true
}: SmartBibliographyProps) {
  const [citations, setCitations] = useState<Citation[]>([]);
  const [style, setStyle] = useState<string>(initialStyle);
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [showUnused, setShowUnused] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [copyToast, setCopyToast] = useState(false);
  const [formattedBibliography, setFormattedBibliography] = useState('');
  const [isFormatting, setIsFormatting] = useState(false);
  
  // Load citations
  useEffect(() => {
    loadCitations();
  }, [projectId]);

  async function loadCitations() {
    setIsLoading(true);
    
    // Fetch citations with usage count
    const { data, error } = await supabase
      .from('citations')
      .select(`
        *,
        citation_links!inner(id)
      `)
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    if (!error && data) {
      // Calculate usage count
      const citationsWithUsage = data.map(citation => ({
        ...citation,
        usage_count: citation.citation_links?.length || 0
      }));
      
      setCitations(citationsWithUsage);
    }
    
    setIsLoading(false);
  }

  // Filter citations based on showUnused
  const filteredCitations = useMemo(() => {
    if (showUnused) {
      return citations;
    }
    return citations.filter(c => (c.usage_count || 0) > 0);
  }, [citations, showUnused]);

  // Group citations
  const groupedCitations = useMemo(() => {
    if (groupBy === 'none') {
      return [{ label: 'All References', citations: filteredCitations }];
    }

    const groups = new Map<string, Citation[]>();
    
    filteredCitations.forEach(citation => {
      let key: string;
      
      switch (groupBy) {
        case 'type':
          key = citation.type || 'article';
          break;
        case 'year':
          key = citation.year ? String(citation.year) : 'Unknown Year';
          break;
        case 'source':
          key = citation.journal || 'Unknown Source';
          break;
        default:
          key = 'Other';
      }
      
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(citation);
    });

    // Sort groups
    const sortedEntries = Array.from(groups.entries()).sort((a, b) => {
      if (groupBy === 'year') {
        return b[0].localeCompare(a[0]); // Newest first
      }
      return a[0].localeCompare(b[0]); // Alphabetical
    });

    return sortedEntries.map(([label, citations]) => ({ label, citations }));
  }, [filteredCitations, groupBy]);

  // Format bibliography with CSL
  useEffect(() => {
    if (filteredCitations.length === 0) {
      setFormattedBibliography('');
      return;
    }

    formatBibliography();
  }, [filteredCitations, style]);

  async function formatBibliography() {
    setIsFormatting(true);
    try {
      // Convert to CSL JSON format
      const cslData = filteredCitations.map(citation => ({
        id: citation.id,
        type: citation.type || 'article-journal',
        title: citation.title,
        author: citation.authors.length > 0 ? citation.authors : [{ family: 'Anonymous', given: '' }],
        issued: citation.year ? { 'date-parts': [[citation.year]] } : undefined,
        'container-title': citation.journal,
        DOI: citation.doi,
        URL: citation.url,
        ...citation.metadata
      }));

      const formatted = await formatCitations(cslData, style, 'bibliography');
      setFormattedBibliography(formatted);
    } catch (error) {
      console.error('Error formatting bibliography:', error);
      setFormattedBibliography('Error formatting bibliography. Please try a different style.');
    } finally {
      setIsFormatting(false);
    }
  }

  // Export handlers
  const handleCopyAll = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(formattedBibliography);
      setCopyToast(true);
      setTimeout(() => setCopyToast(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }, [formattedBibliography]);

  const handleExportBibTeX = useCallback(async () => {
    if (filteredCitations.length === 0) return;

    try {
      // Convert to CSL JSON for citation-js
      const cslData = filteredCitations.map(citation => ({
        id: citation.citation_key,
        type: citation.type || 'article',
        title: citation.title,
        author: citation.authors,
        issued: citation.year ? { 'date-parts': [[citation.year]] } : undefined,
        'container-title': citation.journal,
        DOI: citation.doi,
        URL: citation.url
      }));

      // Use citation-js to generate BibTeX
      const { Cite } = await import('@citation-js/core');
      const cite = new Cite(cslData);
      const bibtex = cite.format('bibtex');
      
      // Download file
      const blob = new Blob([bibtex], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'references.bib';
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting BibTeX:', error);
    }
  }, [filteredCitations]);

  const handleExportRIS = useCallback(() => {
    if (filteredCitations.length === 0) return;

    try {
      // Build RIS format manually (citation-js doesn't have built-in RIS)
      let ris = '';
      
      filteredCitations.forEach(citation => {
        ris += 'TY  - JOUR\n';
        ris += `ID  - ${citation.citation_key}\n`;
        ris += `TI  - ${citation.title}\n`;
        citation.authors.forEach(author => {
          ris += `AU  - ${author.family}, ${author.given}\n`;
        });
        if (citation.year) ris += `PY  - ${citation.year}\n`;
        if (citation.journal) ris += `JO  - ${citation.journal}\n`;
        if (citation.doi) ris += `DO  - ${citation.doi}\n`;
        if (citation.url) ris += `UR  - ${citation.url}\n`;
        ris += 'ER  - \n\n';
      });
      
      // Download file
      const blob = new Blob([ris], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'references.ris';
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting RIS:', error);
    }
  }, [filteredCitations]);

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="space-y-3">
            <div className="h-4 bg-gray-200 rounded"></div>
            <div className="h-4 bg-gray-200 rounded w-5/6"></div>
            <div className="h-4 bg-gray-200 rounded w-4/6"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow">
      {/* Header with Controls */}
      <div className="p-6 border-b">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <h2 className="text-lg font-semibold">
            References ({filteredCitations.length})
          </h2>
          
          <div className="flex flex-wrap gap-3">
            {/* Style Selector */}
            <CitationStyleSelector
              value={style}
              onChange={setStyle}
              className="w-48"
            />
            
            {/* Group By Selector */}
            {showFilters && (
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                className="text-sm border rounded px-3 py-1.5"
              >
                <option value="none">No Grouping</option>
                <option value="type">By Type</option>
                <option value="year">By Year</option>
                <option value="source">By Source</option>
              </select>
            )}
            
            {/* Show Unused Toggle */}
            {showFilters && (
              <button
                onClick={() => setShowUnused(!showUnused)}
                className={`text-sm px-3 py-1.5 rounded flex items-center gap-1 ${
                  showUnused ? 'bg-gray-200' : 'bg-gray-100 hover:bg-gray-200'
                }`}
              >
                <Filter className="w-3 h-3" />
                {showUnused ? 'Hide' : 'Show'} Unused
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bibliography Entries */}
      <div className="p-6">
        {filteredCitations.length === 0 ? (
          <p className="text-gray-500 text-center py-8">
            {showUnused ? 'No citations found' : 'No used citations found'}
          </p>
        ) : isFormatting ? (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            <p className="text-sm text-gray-600 mt-2">Formatting bibliography...</p>
          </div>
        ) : (
          <div className="space-y-6">
            {groupBy === 'none' ? (
              // Show as single formatted bibliography
              <div className="prose prose-sm max-w-none">
                <div dangerouslySetInnerHTML={{ __html: formattedBibliography.replace(/\n/g, '<br />') }} />
              </div>
            ) : (
              // Show grouped citations
              groupedCitations.map((group) => (
                <div key={group.label}>
                  <h3 className="text-sm font-medium text-gray-700 mb-3 pb-1 border-b">
                    {group.label} ({group.citations.length})
                  </h3>
                  <GroupedBibliography 
                    citations={group.citations} 
                    style={style}
                  />
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Export Options */}
      {showExportOptions && filteredCitations.length > 0 && (
        <div className="p-6 border-t bg-gray-50 flex flex-wrap gap-3">
          <button 
            onClick={handleCopyAll}
            className="text-sm px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-2 relative"
          >
            <Copy className="w-4 h-4" />
            Copy All
            {copyToast && (
              <span className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
                Copied ✓
              </span>
            )}
          </button>
          <button 
            onClick={handleExportBibTeX}
            className="text-sm px-4 py-2 border rounded hover:bg-gray-50 flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Export BibTeX
          </button>
          <button 
            onClick={handleExportRIS}
            className="text-sm px-4 py-2 border rounded hover:bg-gray-50 flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Export RIS
          </button>
        </div>
      )}
    </div>
  );
}

// Component for grouped bibliography
function GroupedBibliography({ 
  citations, 
  style 
}: { 
  citations: Citation[];
  style: string;
}) {
  const [formatted, setFormatted] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    formatGroup();
  }, [citations, style]);

  async function formatGroup() {
    setIsLoading(true);
    try {
      const cslData = citations.map(citation => ({
        id: citation.id,
        type: citation.type || 'article-journal',
        title: citation.title,
        author: citation.authors.length > 0 ? citation.authors : [{ family: 'Anonymous', given: '' }],
        issued: citation.year ? { 'date-parts': [[citation.year]] } : undefined,
        'container-title': citation.journal,
        DOI: citation.doi,
        URL: citation.url,
        ...citation.metadata
      }));

      const result = await formatCitations(cslData, style, 'bibliography');
      setFormatted(result);
    } catch (error) {
      console.error('Error formatting group:', error);
      setFormatted('Error formatting citations');
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) {
    return <div className="text-sm text-gray-500">Formatting...</div>;
  }

  return (
    <div className="prose prose-sm max-w-none">
      <div dangerouslySetInnerHTML={{ __html: formatted.replace(/\n/g, '<br />') }} />
    </div>
  );
} 