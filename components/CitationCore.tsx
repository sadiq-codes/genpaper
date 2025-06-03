'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import MarkdownIt from 'markdown-it'
import { paperToCSL, fixCSL, validateCSL, hashCSLData } from '@/lib/utils/csl'
import type { PaperWithAuthors } from '@/types/simplified'

interface CitationCoreProps {
  content: string
  papers: PaperWithAuthors[]
  initialStyle?: 'apa' | 'mla' | 'chicago-author-date'
  className?: string
}

const CITATION_STYLES = {
  'apa': 'APA',
  'mla': 'MLA', 
  'chicago-author-date': 'Chicago (Author-Date)'
} as const

type CitationStyle = keyof typeof CITATION_STYLES

// Flexible citation regex for both UUID and custom IDs
const CITATION_REGEX = /\[CITE:\s*([a-f0-9-]{36}|[A-Za-z0-9_]+)\]/g

export default function CitationCore({ 
  content, 
  papers, 
  initialStyle = 'apa',
  className = '' 
}: CitationCoreProps) {
  const [style, setStyle] = useState<CitationStyle>(initialStyle)
  const [Cite, setCite] = useState<typeof import('citation-js').Cite | null>(null)
  const [citationLibLoaded, setCitationLibLoaded] = useState(false)
  
  // Cached Cite instance with hash-based memoization
  const citeCache = useRef<{ hash: string; cite: InstanceType<typeof import('citation-js').Cite> | null }>({ hash: '', cite: null })
  
  // Dynamically load citation-js
  useEffect(() => {
    const loadCitationJS = async () => {
      try {
        console.log('📦 Starting to load citation-js browser build...')
        const citationModule = await import('citation-js/build/citation.js')
        console.log('📦 Citation-js browser module loaded:', citationModule)
        console.log('📦 Cite constructor:', citationModule.Cite)
        
        setCite(citationModule.Cite)
        setCitationLibLoaded(true)
        console.log('✅ Citation-js browser build successfully loaded and configured')
      } catch (error) {
        console.error('❌ Failed to load citation-js browser build:', error)
        setCitationLibLoaded(true) // Still mark as loaded to show fallback
      }
    }
    
    loadCitationJS()
  }, [])
  
  // Build CSL-JSON objects using our helper
  const cslData = useMemo(() => {
    return papers.map(paper => {
      // Use existing CSL-JSON if available and valid
      if (paper.csl_json && validateCSL(paper.csl_json)) {
        return fixCSL(paper.csl_json as unknown as Record<string, unknown>)
      }
      
      // Use database CSL-JSON but fix common issues
      if (paper.csl_json) {
        return fixCSL(paper.csl_json as unknown as Record<string, unknown>)
      }
      
      // Fallback: generate CSL-JSON from paper data
      return paperToCSL(paper)
    })
  }, [papers])
  
  // Hash CSL data for intelligent caching
  const cslHash = useMemo(() => hashCSLData(cslData), [cslData])
  
  // Initialize citation formatter with intelligent caching
  const cite = useMemo(() => {
    if (!Cite || cslData.length === 0) return null
    
    // Check if we can reuse cached Cite instance
    if (citeCache.current.hash === cslHash && citeCache.current.cite) {
      return citeCache.current.cite
    }
    
    // Validate each CSL item first
    const validItems: typeof cslData = []
    const invalidItems: Array<{ index: number; item: typeof cslData[0]; error: unknown }> = []
    
    for (let i = 0; i < cslData.length; i++) {
      const item = cslData[i]
      try {
        // Test if this individual item works with citation-js
        new Cite([item])
        validItems.push(item)
        console.log(`✅ CSL item ${i} is valid:`, item.title)
      } catch (itemError) {
        invalidItems.push({ index: i, item, error: itemError })
        console.error(`❌ CSL item ${i} (${item.title}) is invalid:`, itemError)
      }
    }
    
    if (invalidItems.length > 0) {
      console.warn(`⚠️ Found ${invalidItems.length} invalid CSL items, using ${validItems.length} valid items`)
    }
    
    // Use only valid items if we have any
    const itemsToUse = validItems.length > 0 ? validItems : cslData
    
    // Deduplicate items by ID to prevent citation-js errors
    const deduped = new Map<string, typeof cslData[0]>()
    for (const item of itemsToUse) {
      deduped.set(item.id, item)
    }
    const uniqueItems = [...deduped.values()]
    
    try {
      console.log('🔍 Attempting to create Cite instance with', uniqueItems.length, 'unique items')
      
      const newCite = new Cite(uniqueItems)
      console.log('✅ Successfully created Cite instance:', newCite)
      
      citeCache.current = { hash: cslHash, cite: newCite }
      return newCite
    } catch (error) {
      console.error('❌ Failed to initialize citation formatter even with validation:', error)
      console.error('❌ Items that failed:', uniqueItems)
      
      citeCache.current = { hash: cslHash, cite: null }
      return null
    }
  }, [Cite, cslData, cslHash])
  
  // Create paper ID to CSL map for fast lookup
  const paperMap = useMemo(() => {
    const map = new Map()
    papers.forEach(paper => {
      map.set(paper.id, paper)
    })
    return map
  }, [papers])
  
  // Markdown-it instance (built only once, independent of style)
  const md = useMemo(() => {
    return new MarkdownIt({
      html: true,
      linkify: true,
      typographer: true
    })
  }, [])
  
  // Process content with citations (style-aware)
  const formattedContent = useMemo(() => {
    if (!citationLibLoaded) {
      return '<div class="text-center py-4 text-muted-foreground">Loading citation formatter...</div>'
    }
    
    if (!cite) {
      // Fallback: simple string replacement if citation-js fails
      const contentWithCitations = content.replace(CITATION_REGEX, (match, paperId) => {
        const paper = paperMap.get(paperId)
        if (!paper) return `(missing source: ${paperId})`
        
        // Simple fallback citation format
        const authors = paper.author_names?.[0]?.split(' ').pop() || 'Unknown'
        const year = paper.publication_date ? new Date(paper.publication_date).getFullYear() : 'n.d.'
        return `(${authors}, ${year})`
      })
      
      try {
        return md.render(contentWithCitations)
      } catch (error) {
        console.warn('Markdown processing failed:', error)
        return contentWithCitations
      }
    }
    
    try {
      // Replace citations before markdown processing
      const contentWithCitations = content.replace(CITATION_REGEX, (match, paperId) => {
        if (!paperMap.has(paperId)) {
          return `(missing source: ${paperId})`
        }
        
        try {
          // Check if citation exists in Cite instance
          const hasItem = cite.data.some((item: { id: string }) => item.id === paperId)
          if (!hasItem) {
            return `(source not found: ${paperId})`
          }
          
          const formatted = cite.format('citation', {
            format: 'text',
            template: style,
            lang: 'en-US',
            entry: paperId
          })
          return formatted || `(formatting error: ${paperId})`
        } catch (error) {
          console.warn(`Failed to format citation for ${paperId}:`, error)
          return `(citation error: ${paperId})`
        }
      })
      
      return md.render(contentWithCitations)
    } catch (error) {
      console.warn('Markdown processing failed:', error)
      return content
    }
  }, [content, cite, md, paperMap, style, citationLibLoaded])
  
  // Generate bibliography (with proper HTML handling)
  const bibliography = useMemo(() => {
    if (!cite) return ''
    
    try {
      const bibHtml = cite.format('bibliography', {
        format: 'html',
        template: style,
        lang: 'en-US'
      })
      
      // Remove outer wrapper if citation-js adds one to avoid nesting
      return bibHtml.replace(/^<div[^>]*>([\s\S]*)<\/div>$/, '$1')
    } catch (error) {
      console.warn('Failed to generate bibliography:', error)
      return ''
    }
  }, [cite, style])
  
  return (
    <div className={className}>
      {/* Citation Style Selector */}
      <div className="mb-6 flex items-center gap-3">
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
        {!cite && citationLibLoaded && (
          <div className="text-sm text-orange-600">
            (Fallback mode - citation library not available)
          </div>
        )}
      </div>
      
      {/* Formatted Paper Content */}
      <div className="prose prose-gray max-w-none dark:prose-invert">
        <div 
          dangerouslySetInnerHTML={{ __html: formattedContent }}
        />
        
        {/* Bibliography */}
        {bibliography && (
          <div className="mt-8 pt-8 border-t">
            <h2 className="text-xl font-semibold mb-4">References</h2>
            <div 
              className="text-sm bibliography-content"
              dangerouslySetInnerHTML={{ __html: bibliography }}
            />
          </div>
        )}
      </div>
      
      {/* Debug Info in Development */}
      {process.env.NODE_ENV === 'development' && (
        <details className="mt-6 p-4 bg-gray-50 rounded text-xs">
          <summary className="cursor-pointer font-medium">Debug Info</summary>
          <div className="mt-2 space-y-2">
            <div><strong>Papers:</strong> {papers.length}</div>
            <div><strong>Style:</strong> {style}</div>
            <div><strong>CSL Data:</strong> {cslData.length} items</div>
            <div><strong>Citations Found:</strong> {content.match(CITATION_REGEX)?.length || 0}</div>
            <div><strong>Cite Object:</strong> {cite ? 'initialized' : 'null'}</div>
            <div><strong>Citation Lib Loaded:</strong> {citationLibLoaded ? 'yes' : 'no'}</div>
            <div><strong>CSL Valid:</strong> {cslData.filter(csl => validateCSL(csl)).length}/{cslData.length}</div>
            <div><strong>Cache Hash:</strong> {cslHash.slice(0, 20)}...</div>
            {cslData.length > 0 && (
              <div className="mt-2">
                <strong>First CSL Item:</strong>
                <pre className="mt-1 text-xs bg-white p-2 rounded border overflow-auto">
                  {JSON.stringify(cslData[0], null, 2)}
                </pre>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  )
}