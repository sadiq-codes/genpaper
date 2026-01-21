'use client'

import { useMemo, useEffect, useState } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import type { ProjectPaper } from '../types'
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
  // Track document version to trigger re-renders on citation changes
  const [docVersion, setDocVersion] = useState(0)
  
  // Listen for document changes to update bibliography
  useEffect(() => {
    if (!editor) return
    
    const handleUpdate = () => {
      setDocVersion(v => v + 1)
    }
    
    editor.on('update', handleUpdate)
    
    // Also listen for citation style changes
    const handleTransaction = ({ transaction }: { transaction: unknown }) => {
      const tr = transaction as { getMeta?: (key: string) => unknown }
      if (tr.getMeta?.('citationStyleChange') || tr.getMeta?.('papersUpdated')) {
        setDocVersion(v => v + 1)
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
  } | undefined
  
  const style = citationStorage?.citationStyle || 'apa'
  const citationNumbers = citationStorage?.citationNumbers || new Map<string, number>()
  const papers = citationStorage?.papers || []
  
  // Extract all unique cited paper IDs from the document
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
  }, [editor, docVersion])
  
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
        
        {/* Bibliography Entries */}
        <div className="space-y-3">
          {bibliographyEntries.map((entry, index) => (
            <div
              key={`ref-${index}`}
              className="reference-entry text-sm text-foreground/90 leading-relaxed pl-8 -indent-8"
            >
              {entry}
            </div>
          ))}
        </div>
      </div>
    </NodeViewWrapper>
  )
}
