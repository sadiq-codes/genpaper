'use client'

import { useMemo, useEffect, useState, useRef } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import type { ProjectPaper } from '../types'
import { Lock } from 'lucide-react'
import { UpgradeButton } from '@/components/billing/upgrade-button'
import { 
  formatBibliography, 
  isNumericStyle,
  type CitationPaper 
} from '@/lib/citations/local-formatter'

/**
 * ReferencesNodeView
 * 
 * React component that renders the auto-generated References section.
 * 
 * Features:
 * - Uses the same citation style as inline citations
 * - Updates in real-time when citations change
 * - Properly formats bibliography based on style (APA, IEEE, etc.)
 * - Hidden when no citations exist in the document
 */
export function ReferencesNodeView({ editor }: NodeViewProps) {
  // Track citation signature to trigger re-renders only when citations actually change
  const [citationSignature, setCitationSignature] = useState('')
  const prevSignatureRef = useRef('')
  
  // Listen for document changes - only update when citations change
  useEffect(() => {
    if (!editor) return
    
    // Compute citation signature (sorted list of citation IDs)
    const computeCitationSignature = () => {
      const ids = new Set<string>()
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'citation' && node.attrs.id) {
          ids.add(node.attrs.id)
        }
      })
      return [...ids].sort().join(',')
    }
    
    const handleUpdate = () => {
      // Only trigger re-render if citations actually changed
      const newSignature = computeCitationSignature()
      if (newSignature !== prevSignatureRef.current) {
        prevSignatureRef.current = newSignature
        setCitationSignature(newSignature)
      }
    }
    
    // Initial computation
    const initialSignature = computeCitationSignature()
    prevSignatureRef.current = initialSignature
    setCitationSignature(initialSignature)
    
    editor.on('update', handleUpdate)
    
    // Also listen for citation style changes
    const handleTransaction = ({ transaction }: { transaction: unknown }) => {
      const tr = transaction as { getMeta?: (key: string) => unknown }
      if (tr.getMeta?.('citationStyleChange') || tr.getMeta?.('papersUpdated') || tr.getMeta?.('referencesVisibleChange')) {
        // Force update on style/papers change
        const newSignature = computeCitationSignature() + '-' + Date.now()
        prevSignatureRef.current = newSignature
        setCitationSignature(newSignature)
      }
    }
    
    editor.on('transaction', handleTransaction)
    
    return () => {
      editor.off('update', handleUpdate)
      editor.off('transaction', handleTransaction)
    }
  }, [editor])
  
  // Get citation style and papers from Citation extension storage
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorStorage = editor?.storage as any
  const citationStorage = editorStorage?.citation as {
    citationStyle: string
    citationNumbers: Map<string, number>
    papers: ProjectPaper[]
    referencesVisible?: number | 'all'
  } | undefined
  
  const style = citationStorage?.citationStyle || 'apa'
  const citationNumbers = citationStorage?.citationNumbers || new Map<string, number>()
  const papers = citationStorage?.papers || []
  const referencesVisible: number | 'all' = citationStorage?.referencesVisible ?? 'all'
  
  // Extract all unique cited paper IDs from the document
  // Uses citationSignature as dependency - only recomputes when citations actually change
  const citedPaperIds = useMemo(() => {
    if (!editor) return new Set<string>()
    
    const ids = new Set<string>()
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'citation' && node.attrs.id) {
        ids.add(node.attrs.id)
      }
    })
    return ids
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, citationSignature])
  
  // Filter papers to only those that are cited
  const citedPapers = useMemo(() => {
    return papers.filter(p => citedPaperIds.has(p.id))
  }, [papers, citedPaperIds])
  
  // Convert ProjectPaper to CitationPaper format
  const citationPapers: CitationPaper[] = useMemo(() => {
    return citedPapers.map(p => ({
      id: p.id,
      title: p.title,
      authors: p.authors,
      year: p.year,
      journal: p.journal,
      doi: p.doi,
    }))
  }, [citedPapers])
  
  // Sort papers based on citation style
  const sortedPapers = useMemo(() => {
    const sorted = [...citationPapers]
    
    if (isNumericStyle(style)) {
      // Sort by citation number (order of appearance) for numeric styles
      sorted.sort((a, b) => {
        const numA = citationNumbers.get(a.id) || 999
        const numB = citationNumbers.get(b.id) || 999
        return numA - numB
      })
    } else {
      // Sort alphabetically by first author for author-date styles
      sorted.sort((a, b) => {
        const authorA = (a.authors?.[0] || 'ZZZ').toLowerCase()
        const authorB = (b.authors?.[0] || 'ZZZ').toLowerCase()
        return authorA.localeCompare(authorB)
      })
    }
    
    return sorted
  }, [citationPapers, style, citationNumbers])
  
  // Format bibliography
  const bibliographyText = useMemo(() => {
    if (sortedPapers.length === 0) return ''
    return formatBibliography(sortedPapers, style, citationNumbers)
  }, [sortedPapers, style, citationNumbers])
  
  // Parse bibliography into individual entries for better rendering
  const bibliographyEntries = useMemo(() => {
    if (!bibliographyText) return []
    
    // Split by double newline (entry separator) or single newline
    return bibliographyText
      .split(/\n\n|\n/)
      .map(entry => entry.trim())
      .filter(entry => entry.length > 0)
  }, [bibliographyText])
  
  // Hide if no citations
  if (citedPaperIds.size === 0 || bibliographyEntries.length === 0) {
    return (
      <NodeViewWrapper 
        as="div" 
        className="references-block-empty"
        data-type="references-block"
        contentEditable={false}
      >
        {/* Empty - will be auto-removed by the manager */}
      </NodeViewWrapper>
    )
  }
  
  const visibleCount = referencesVisible === 'all' ? bibliographyEntries.length : referencesVisible
  const visibleEntries = bibliographyEntries.slice(0, visibleCount)
  const blurredEntries = bibliographyEntries.slice(visibleCount)
  const hasBlurred = blurredEntries.length > 0

  return (
    <NodeViewWrapper
      as="div"
      className="references-block"
      data-type="references-block"
      contentEditable={false}
    >
      <div className="references-content mt-12 pt-8 select-none">
        {/* References Heading */}
        <h2 className="text-xl font-semibold mb-6 text-foreground">
          References
        </h2>
        
        {/* Visible Bibliography Entries */}
        <div className="space-y-3">
          {visibleEntries.map((entry, index) => (
            <div
              key={`ref-${index}`}
              className="reference-entry text-sm text-foreground/90 leading-relaxed pl-8 -indent-8"
            >
              {entry}
            </div>
          ))}
        </div>

        {/* Blurred entries with upgrade overlay (free tier) */}
        {hasBlurred && (
          <div className="relative mt-4">
            <div className="space-y-3 select-none" style={{ filter: 'blur(4px)' }}>
              {blurredEntries.slice(0, 5).map((entry, index) => (
                <div
                  key={`blurred-ref-${index}`}
                  className="reference-entry text-sm text-muted-foreground leading-relaxed pl-8 -indent-8"
                >
                  {entry}
                </div>
              ))}
              {blurredEntries.length > 5 && (
                <div className="text-sm text-muted-foreground pl-8">
                  ... and {blurredEntries.length - 5} more references
                </div>
              )}
            </div>
            <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-[2px]">
              <div className="text-center space-y-2 p-4">
                <div className="flex items-center justify-center gap-2 text-sm font-medium text-foreground">
                  <Lock className="h-4 w-4" />
                  <span>{blurredEntries.length} more references</span>
                </div>
                <UpgradeButton label="Upgrade to See All" size="sm" />
              </div>
            </div>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}
