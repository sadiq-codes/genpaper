'use client'

import { useMemo, useState, useEffect } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import type { CitationAttributes } from './Citation'
import type { ProjectPaper } from '../types'
import { formatInline } from '@/lib/citations/local-formatter'

// Citation style type
export type CitationStyleType = string

/**
 * Format citation based on style - uses local-formatter directly
 * This is synchronous and instant (no async, no loading states)
 */
export function formatCitationByStyle(
  attrs: CitationAttributes,
  style: CitationStyleType,
  citationNumber?: number
): string {
  return formatInline(
    {
      id: attrs.id,
      title: attrs.title,
      authors: attrs.authors,
      year: attrs.year,
      journal: attrs.journal,
      doi: attrs.doi,
    },
    style,
    citationNumber
  )
}

/**
 * React NodeView for Citations
 * 
 * Uses 100% local formatting via citation-js.
 * No API calls, no loading states - instant rendering.
 * Click to see details and quote in the popover.
 * 
 * IMPORTANT: Looks up paper data from storage.papers (passed from DocumentEditor)
 * rather than relying solely on node.attrs. This ensures citations always
 * display correctly even when attrs are incomplete (e.g., after generation).
 */
export function CitationNodeView({ node, selected, extension, editor }: NodeViewProps) {
  const attrs = node.attrs as CitationAttributes
  
  // Track storage version to force re-renders when style/papers change
  const [storageVersion, setStorageVersion] = useState(0)
  
  // Listen for transactions that indicate style or papers changed
  useEffect(() => {
    if (!editor) return
    
    const handleTransaction = ({ transaction }: { transaction: { getMeta: (key: string) => unknown } }) => {
      // Re-render when citation style changes or papers are updated
      if (transaction.getMeta('citationStyleChange') || transaction.getMeta('papersUpdated')) {
        setStorageVersion(v => v + 1)
      }
    }
    
    editor.on('transaction', handleTransaction)
    return () => {
      editor.off('transaction', handleTransaction)
    }
  }, [editor])
  
  // Get citation style and papers from extension storage
  // Wrap in useMemo with storageVersion dependency to ensure re-read after changes
  const { style, citationNumber, papers } = useMemo(() => {
    const storage = extension.storage as { 
      citationStyle: CitationStyleType
      citationNumbers: Map<string, number>
      papers: ProjectPaper[]
    }
    
    return {
      style: storage?.citationStyle || 'apa',
      citationNumber: storage?.citationNumbers?.get(attrs.id),
      papers: storage?.papers || []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extension.storage, attrs.id, storageVersion])
  
  // Look up paper from storage.papers (same as popover does)
  // This ensures we use the most up-to-date paper metadata
  const paper = useMemo(() => {
    return papers.find(p => p.id === attrs.id)
  }, [papers, attrs.id])
  
  // Use paper data if found, fallback to attrs for backward compatibility
  const displayAttrs: CitationAttributes = useMemo(() => {
    if (paper) {
      return {
        id: paper.id,
        instanceId: attrs.instanceId,
        citedContent: attrs.citedContent,
        title: paper.title || 'Untitled',
        authors: paper.authors || [],
        year: paper.year,
        journal: paper.journal,
        doi: paper.doi,
      }
    }
    // Fallback to node attrs (for backward compatibility with old documents)
    return attrs
  }, [paper, attrs])
  
  // Format the citation - synchronous and instant
  const text = useMemo(() => {
    return formatCitationByStyle(displayAttrs, style, citationNumber)
  }, [displayAttrs, style, citationNumber])

  return (
    <NodeViewWrapper
      as="span"
      className={`citation-inline cursor-pointer ${selected ? 'ProseMirror-selectednode' : ''}`}
      data-citation={attrs.id}
      data-type="citation"
      data-instance-id={attrs.instanceId || undefined}
      data-cited-content={attrs.citedContent || ''}
    >
      {text}
    </NodeViewWrapper>
  )
}
