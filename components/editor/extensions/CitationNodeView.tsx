'use client'

import { useMemo } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import type { CitationAttributes } from './Citation'
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
 */
export function CitationNodeView({ node, selected, extension }: NodeViewProps) {
  const attrs = node.attrs as CitationAttributes
  
  // Get citation style from extension storage
  const storage = extension.storage as { 
    citationStyle: CitationStyleType
    citationNumbers: Map<string, number>
  }
  
  const style = storage?.citationStyle || 'apa'
  const citationNumber = storage?.citationNumbers?.get(attrs.id)
  
  // Format the citation - synchronous and instant
  const text = useMemo(() => {
    return formatCitationByStyle(attrs, style, citationNumber)
  }, [attrs, style, citationNumber])

  return (
    <NodeViewWrapper
      as="span"
      className={`citation-inline ${selected ? 'ProseMirror-selectednode' : ''}`}
      data-citation={attrs.id}
      data-type="citation"
      title={attrs.title || ''}
    >
      {text}
    </NodeViewWrapper>
  )
}
