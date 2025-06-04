'use client'

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Download, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import MarkdownIt from 'markdown-it'
import { paperToCSL, fixCSL, validateCSL, hashCSLData, type CSLItem } from '@/lib/utils/csl'
import { createClient } from '@/lib/supabase/client'
import type { PaperWithAuthors } from '@/types/simplified'

interface CitationCoreProps {
  content: string
  papers: PaperWithAuthors[]
  projectId?: string
  initialStyle?: 'apa' | 'mla' | 'chicago-author-date'
  className?: string
  onError?: (error: string) => void
  onStatusChange?: (status: 'loading' | 'ready' | 'error' | 'fallback') => void
}

const CITATION_STYLES = {
  'apa': 'APA',
  'mla': 'MLA', 
  'chicago-author-date': 'Chicago (Author-Date)',
  'harvard1': 'Harvard',
  'ieee': 'IEEE',
  'vancouver': 'Vancouver'
} as const

type CitationStyle = keyof typeof CITATION_STYLES

const CITATION_REGEX = /\[CITE:\s*([a-f0-9-]{36}|[A-Za-z0-9_]+)\]/g

interface DatabaseCitation {
  id: string
  key: string
  csl_json: Record<string, unknown>
}

interface CitationModule {
  Cite?: unknown
  default?: unknown | { Cite?: unknown }
  [key: string]: unknown
}

interface CitationError {
  id: string
  message: string
  type: 'missing' | 'invalid' | 'formatting'
}

export default function CitationCore({ 
  content, 
  papers, 
  projectId,
  initialStyle = 'apa',
  className = '',
  onError,
  onStatusChange
}: CitationCoreProps) {
  const [style, setStyle] = useState<CitationStyle>(initialStyle)
  const [Cite, setCite] = useState<typeof import('citation-js').Cite | null>(null)
  const [citationLibLoaded, setCitationLibLoaded] = useState(false)
  const [dbCitations, setDbCitations] = useState<DatabaseCitation[]>([])
  const [citationsLoading, setCitationsLoading] = useState(false)
  const [debugUniqueItemIds, setDebugUniqueItemIds] = useState<string[]>([])
  const [citationErrors, setCitationErrors] = useState<CitationError[]>([])
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  
  const citeCache = useRef<{ hash: string; cite: InstanceType<typeof import('citation-js').Cite> | null }>({ hash: '', cite: null })
  
  // Status reporting
  useEffect(() => {
    if (citationsLoading) {
      onStatusChange?.('loading')
    } else if (!citationLibLoaded) {
      onStatusChange?.('loading')
    } else if (citationErrors.length > 0) {
      onStatusChange?.('error')
    } else if (!Cite) {
      onStatusChange?.('fallback')
    } else {
      onStatusChange?.('ready')
    }
  }, [citationsLoading, citationLibLoaded, Cite, citationErrors.length, onStatusChange])
  
  const loadCitationJS = useCallback(async () => {
    try {
      let constructorCandidate: unknown = null;
      let strategy = '';

      try {
        const mainModule = await import('citation-js');
        
        if (mainModule.Cite && typeof mainModule.Cite === 'function') {
          constructorCandidate = mainModule.Cite;
          strategy = 'main.Cite';
        } else if (mainModule.default?.Cite && typeof mainModule.default.Cite === 'function') {
          constructorCandidate = mainModule.default.Cite;
          strategy = 'main.default.Cite';
        } else if (typeof mainModule.default === 'function') {
          constructorCandidate = mainModule.default;
          strategy = 'main.default';
        }
      } catch (error) {
        console.error('Failed to load citation-js main module:', error);
      }

      if (!constructorCandidate) {
        try {
          const cjsModule = await import('citation-js/build/citation.js') as CitationModule;
          
          if (cjsModule.Cite && typeof cjsModule.Cite === 'function') {
            constructorCandidate = cjsModule.Cite;
            strategy = 'cjs.Cite';
          } else if (cjsModule.default && typeof cjsModule.default === 'object' && 
                     (cjsModule.default as Record<string, unknown>).Cite && 
                     typeof (cjsModule.default as Record<string, unknown>).Cite === 'function') {
            constructorCandidate = (cjsModule.default as Record<string, unknown>).Cite;
            strategy = 'cjs.default.Cite';
          } else if (typeof cjsModule.default === 'function') {
            constructorCandidate = cjsModule.default;
            strategy = 'cjs.default';
          } else if (cjsModule.default && typeof cjsModule.default === 'object') {
            const defaultObj = cjsModule.default as Record<string, unknown>;
            for (const [key, value] of Object.entries(defaultObj)) {
              if (typeof value === 'function' && key.toLowerCase().includes('cite')) {
                constructorCandidate = value;
                strategy = `cjs.default.${key}`;
                break;
              }
            }
          }
        } catch (error) {
          console.error('Failed to load citation-js CJS module:', error);
        }
      }

      if (typeof constructorCandidate === 'function') {
        setCite(() => constructorCandidate as typeof import('citation-js').Cite); 
        setCitationLibLoaded(true);
        console.log(`Citation-js loaded using strategy: ${strategy}`);
      } else {
        console.error('No valid Cite constructor found');
        setCitationLibLoaded(true);
        onError?.('Failed to load citation formatting library');
      }

    } catch (error) {
      console.error('Error loading citation-js:', error);
      setCitationLibLoaded(true);
      onError?.('Critical error loading citation system');
    }
  }, [onError])

  useEffect(() => {
    loadCitationJS();
  }, [loadCitationJS]);

  const fetchDatabaseCitations = useCallback(async () => {
    if (!projectId) return

    setCitationsLoading(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('citations')
        .select('id, key, csl_json')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })

      if (error) {
        console.error('Failed to fetch citations:', error)
        onError?.('Failed to load citations from database')
        return
      }

      setDbCitations(data || [])
      setLastRefresh(new Date())
    } catch (error) {
      console.error('Error fetching citations:', error)
      onError?.('Error connecting to citation database')
    } finally {
      setCitationsLoading(false)
    }
  }, [projectId, onError])

  useEffect(() => {
    fetchDatabaseCitations()
  }, [fetchDatabaseCitations])

  // Enhanced CSL data building with validation
  const cslData = useMemo((): CSLItem[] => {
    const errors: CitationError[] = []
    
    const paperCslData: CSLItem[] = papers.map(paper => {
      try {
        if (paper.csl_json && validateCSL(paper.csl_json as CSLItem)) {
          return fixCSL(paper.csl_json as Record<string, unknown>)
        }
        if (paper.csl_json) {
          return fixCSL(paper.csl_json as Record<string, unknown>)
        }
        return paperToCSL(paper)
      } catch (error) {
        errors.push({
          id: paper.id,
          message: `Invalid paper data: ${error}`,
          type: 'invalid'
        })
        return paperToCSL(paper) // Fallback
      }
    })

    const dbCslData: CSLItem[] = dbCitations.map(citation => {
      try {
        const cslItem = fixCSL(citation.csl_json)
        return { ...cslItem, id: citation.key } as CSLItem
      } catch (error) {
        errors.push({
          id: citation.key,
          message: `Invalid database citation: ${error}`,
          type: 'invalid'
        })
        console.warn('Invalid CSL from database citation:', citation.key, error)
        return null
      }
    }).filter((item): item is CSLItem => item !== null)

    setCitationErrors(errors)
    return [...paperCslData, ...dbCslData]
  }, [papers, dbCitations])

  const cslHash = useMemo(() => hashCSLData(cslData), [cslData])
  
  // Enhanced cite instance with better error handling
  const cite = useMemo(() => {
    if (!Cite || cslData.length === 0) return null
    
    if (citeCache.current.hash === cslHash && citeCache.current.cite) {
      return citeCache.current.cite
    }
    
    const validItems: CSLItem[] = []
    const errors: CitationError[] = [...citationErrors]
    
    for (let i = 0; i < cslData.length; i++) {
      const item = cslData[i]!
      try {
        new Cite([item])
        validItems.push(item)
      } catch (itemError) {
        errors.push({
          id: item.id || `item-${i}`,
          message: `Citation validation failed: ${itemError}`,
          type: 'invalid'
        })
      }
    }
    
    setCitationErrors(errors)
    
    const itemsToUse = validItems.length > 0 ? validItems : cslData
    
    const deduped = new Map<string, CSLItem>()
    for (const item of itemsToUse) {
      if (item && item.id) {
        deduped.set(item.id, item)
      }
    }
    const uniqueItems = [...deduped.values()]
    
    if (uniqueItems.length === 0 && cslData.length > 0) {
      setDebugUniqueItemIds(cslData.map(item => item?.id || 'NO_ID_IN_CSL_DATA'))
      citeCache.current = { hash: cslHash, cite: null }
      return null
    }

    const currentUniqueIds = uniqueItems.map(item => item.id)
    setDebugUniqueItemIds(currentUniqueIds);

    try {
      const newCite = new Cite(uniqueItems)
      citeCache.current = { hash: cslHash, cite: newCite }
      return newCite
    } catch (error) {
      console.error('Failed to initialize citation formatter:', error)
      onError?.('Failed to initialize citation formatter')
      citeCache.current = { hash: cslHash, cite: null }
      return null
    }
  }, [Cite, cslData, cslHash, citationErrors, onError])
  
  const citationMap = useMemo(() => {
    const map = new Map<string, PaperWithAuthors | DatabaseCitation>()
    papers.forEach(paper => {
      map.set(paper.id, paper)
    })
    dbCitations.forEach(citation => {
      map.set(citation.key, citation)
    })
    return map
  }, [papers, dbCitations])
  
  const md = useMemo(() => {
    return new MarkdownIt({
      html: true,
      linkify: true,
      typographer: true
    })
  }, [])
  
  // Enhanced content processing with error tracking
  const { formattedContent, missingCitations } = useMemo(() => {
    if (!citationLibLoaded) {
      return { 
        formattedContent: '<div class="text-center py-4 text-muted-foreground">Loading citation formatter...</div>',
        missingCitations: []
      }
    }

    if (citationsLoading && projectId) {
      return { 
        formattedContent: '<div class="text-center py-4 text-muted-foreground">Loading citations from database...</div>',
        missingCitations: []
      }
    }

    const missing: string[] = []
    
    if (!cite) {
      const contentWithCitations = content.replace(CITATION_REGEX, (match, citationId) => {
        const item = citationMap.get(citationId)
        if (!item) {
          missing.push(citationId)
          return `(missing source: ${citationId})`
        }
        
        if ('source' in item && item.source === 'database') {
          const csl = item.csl_json as CSLItem
          const authors = csl.author?.[0]?.family || 'Unknown'
          const year = csl.issued?.['date-parts']?.[0]?.[0] || 'n.d.'
          return `(${authors}, ${year})`
        } else if ('author_names' in item) {
          const authors = (item as PaperWithAuthors).author_names?.[0]?.split(' ').pop() || 'Unknown'
          const year = (item as PaperWithAuthors).publication_date ? new Date((item as PaperWithAuthors).publication_date!).getFullYear() : 'n.d.'
          return `(${authors}, ${year})`
        }
        
        return `(source format error: ${citationId})`
      })
      
      try {
        return { 
          formattedContent: md.render(contentWithCitations),
          missingCitations: missing
        }
      } catch (error) {
        console.warn('Markdown processing failed:', error)
        return { 
          formattedContent: contentWithCitations,
          missingCitations: missing
        }
      }
    }
    
    try {
      const contentWithCitations = content.replace(CITATION_REGEX, (match, citationId) => {
        if (!citationMap.has(citationId)) {
          missing.push(citationId)
          return `<span style="color: red; background-color: #fff3cd; padding: 2px 4px; border-radius: 3px;">(missing source: ${citationId})</span>`
        }
        
        try {
          const hasItem = cite.data.some((item: { id: string }) => item.id === citationId)
          if (!hasItem) {
            missing.push(citationId)
            return `<span style="color: orange; background-color: #fff3cd; padding: 2px 4px; border-radius: 3px;">(source not found: ${citationId})</span>`
          }
          
          const formatted = cite.format('citation', {
            format: 'text',
            template: style,
            lang: 'en-US',
            entry: citationId
          })
          return formatted || `<span style="color: red;">(formatting error: ${citationId})</span>`
        } catch (error) {
          console.warn(`Failed to format citation for ${citationId}:`, error)
          return `<span style="color: red;">(citation error: ${citationId})</span>`
        }
      })
      
      return { 
        formattedContent: md.render(contentWithCitations),
        missingCitations: missing
      }
    } catch (error) {
      console.warn('Markdown processing failed:', error)
      return { 
        formattedContent: content,
        missingCitations: missing
      }
    }
  }, [content, cite, md, citationMap, style, citationLibLoaded, citationsLoading, projectId])
  
  const bibliography = useMemo(() => {
    if (!cite) return ''
    
    try {
      const bibHtml = cite.format('bibliography', {
        format: 'html',
        template: style,
        lang: 'en-US'
      })
      
      return bibHtml.replace(/^<div[^>]*>([\s\S]*)<\/div>$/, '$1')
    } catch (error) {
      console.warn('Failed to generate bibliography:', error)
      onError?.('Failed to generate bibliography')
      return ''
    }
  }, [cite, style, onError])

  // Export functionality
  const exportBibliography = useCallback((format: 'bibtex' | 'ris' | 'json' = 'bibtex') => {
    if (!cite) return

    try {
      let output: string
      let filename: string
      let mimeType: string

      switch (format) {
        case 'bibtex':
          output = cite.format('bibliography', { format: 'text', template: 'bibtex' })
          filename = 'bibliography.bib'
          mimeType = 'application/x-bibtex'
          break
        case 'ris':
          output = cite.format('bibliography', { format: 'text', template: 'ris' })
          filename = 'bibliography.ris'
          mimeType = 'application/x-research-info-systems'
          break
        case 'json':
          output = JSON.stringify(cite.data, null, 2)
          filename = 'bibliography.json'
          mimeType = 'application/json'
          break
        default:
          throw new Error(`Unsupported format: ${format}`)
      }

      const blob = new Blob([output], { type: mimeType })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Export failed:', error)
      onError?.(`Failed to export bibliography: ${error}`)
    }
  }, [cite, onError])

  // Update missing citations errors
  useEffect(() => {
    if (missingCitations.length > 0) {
      const missingErrors: CitationError[] = missingCitations.map(id => ({
        id,
        message: 'Citation not found in database or papers',
        type: 'missing' as const
      }))
      setCitationErrors(prev => [...prev.filter(e => e.type !== 'missing'), ...missingErrors])
    }
  }, [missingCitations])
  
  return (
    <div className={className}>
      {/* Enhanced Controls */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <label htmlFor="citation-style" className="text-sm font-medium">
          Citation Style:
        </label>
        <Select 
          value={style} 
          onValueChange={(value) => setStyle(value as CitationStyle)}
        >
          <SelectTrigger className="w-48" id="citation-style">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(CITATION_STYLES).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Status Indicators */}
        {citationsLoading && (
          <div className="flex items-center gap-2 text-sm text-blue-600">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Loading citations...
          </div>
        )}
        
        {!cite && citationLibLoaded && !citationsLoading && (
          <div className="flex items-center gap-2 text-sm text-orange-600">
            <AlertCircle className="w-4 h-4" />
            Fallback mode
          </div>
        )}

        {cite && (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <CheckCircle2 className="w-4 h-4" />
            Ready
          </div>
        )}

        {/* Export Controls */}
        {cite && (
          <div className="flex items-center gap-2 ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportBibliography('bibtex')}
              className="flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export BibTeX
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchDatabaseCitations}
              disabled={citationsLoading}
              className="flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${citationsLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        )}
      </div>

      {/* Error Alerts */}
      {citationErrors.length > 0 && (
        <Alert className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Found {citationErrors.length} citation issue{citationErrors.length !== 1 ? 's' : ''}:
            <ul className="mt-2 text-xs list-disc list-inside">
              {citationErrors.slice(0, 5).map((error, idx) => (
                <li key={idx}>{error.type}: {error.message}</li>
              ))}
              {citationErrors.length > 5 && (
                <li>... and {citationErrors.length - 5} more</li>
              )}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      
      {/* Formatted Content */}
      <div className="prose prose-gray max-w-none dark:prose-invert">
        <div 
          dangerouslySetInnerHTML={{ __html: formattedContent }}
        />
        
        {/* Bibliography */}
        {bibliography && (
          <div className="mt-8 pt-8 border-t">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">References</h2>
              <div className="text-sm text-muted-foreground">
                {cite?.data?.length || 0} source{(cite?.data?.length || 0) !== 1 ? 's' : ''}
                {lastRefresh && (
                  <span className="ml-2">
                    • Updated {lastRefresh.toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>
            <div 
              className="text-sm bibliography-content"
              dangerouslySetInnerHTML={{ __html: bibliography }}
            />
          </div>
        )}
      </div>
      
      {/* Development Debug Info */}
      {process.env.NODE_ENV === 'development' && (
        <details className="mt-6 p-4 bg-gray-50 rounded text-xs">
          <summary className="cursor-pointer font-medium">Debug Info (Phase 3)</summary>
          <div className="mt-2 space-y-2">
            <div><strong>Papers:</strong> {papers.length}</div>
            <div><strong>DB Citations:</strong> {dbCitations.length}</div>
            <div><strong>Style:</strong> {style}</div>
            <div><strong>CSL Data:</strong> {cslData.length} items ({cslData.filter(item => !!item).length} valid objects)</div>
            <div><strong>Unique CSL Items:</strong> {debugUniqueItemIds.length}</div>
            <div><strong>Citations Found:</strong> {content.match(CITATION_REGEX)?.length || 0}</div>
            <div><strong>Missing Citations:</strong> {missingCitations.length}</div>
            <div><strong>Citation Errors:</strong> {citationErrors.length}</div>
            <div><strong>Citation Map Size:</strong> {citationMap.size}</div>
            <div><strong>Cite Object:</strong> {cite ? `initialized (${cite.data.length} entries)` : 'null'}</div>
            <div><strong>Citation Lib Loaded:</strong> {citationLibLoaded ? 'yes' : 'no'}</div>
            <div><strong>Citations Loading:</strong> {citationsLoading ? 'yes' : 'no'}</div>
            <div><strong>CSL Valid (individually):</strong> {cslData.filter(c => validateCSL(c)).length}/{cslData.length}</div>
            <div><strong>Cache Hash:</strong> {cslHash.slice(0, 20)}...</div>
            {projectId && <div><strong>Project ID:</strong> {projectId}</div>}
          </div>
        </details>
      )}
    </div>
  )
}