'use client'

import { useMemo, useState, useEffect, useRef } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import type { CitationAttributes } from './Citation'
import type { ProjectPaper } from '../types'
import { formatInline, formatInlineMultiple, isNumericStyle } from '@/lib/citations/local-formatter'

// Citation style type
export type CitationStyleType = string
const EMPTY_PAPERS: ProjectPaper[] = []

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
  const lastSeenStyleRef = useRef<string | null>(null)
  
  // Listen for transactions that indicate style or papers changed
  useEffect(() => {
    if (!editor) return
    
    const handleTransaction = ({ transaction }: { transaction: { getMeta: (key: string) => unknown } }) => {
      const styleChange = transaction.getMeta('citationStyleChange')
      const papersUpdate = transaction.getMeta('papersUpdated')
      if (styleChange || papersUpdate) {
        if (process.env.NODE_ENV === 'development') {
          console.log(
            `[CitationNodeView] Transaction detected — styleChange=${String(styleChange)}, papersUpdate=${String(papersUpdate)}, id=${attrs.id?.slice(0, 8)}`
          )
        }
        setStorageVersion(v => v + 1)
      }
    }

    // Fallback: re-render when extension storage style changes, even if we miss our meta.
    const handleUpdate = () => {
      const storage = (
        editor.storage as { citation?: { citationStyle?: string } } | undefined
      )?.citation
      const nextStyle = String(storage?.citationStyle || 'apa')
      if (lastSeenStyleRef.current !== nextStyle) {
        if (process.env.NODE_ENV === 'development') {
          console.log(
            `[CitationNodeView] Storage style changed — "${lastSeenStyleRef.current}" → "${nextStyle}", id=${attrs.id?.slice(0, 8)}`
          )
        }
        lastSeenStyleRef.current = nextStyle
        setStorageVersion(v => v + 1)
      }
    }
    
    editor.on('transaction', handleTransaction)
    editor.on('update', handleUpdate)
    handleUpdate()
    return () => {
      editor.off('transaction', handleTransaction)
      editor.off('update', handleUpdate)
    }
  }, [editor, extension, attrs.id])
  
  // Get citation style and papers from extension storage
  // Read directly (not in useMemo) since storageVersion triggers re-render
  const storageFromEditor = (
    editor?.storage as {
      citation?: {
        citationStyle?: CitationStyleType
        citationNumbers?: Map<string, number>
        papers?: ProjectPaper[]
      }
    } | undefined
  )?.citation

  const storageFromNode = extension.storage as {
    citationStyle?: CitationStyleType
    citationNumbers?: Map<string, number>
    papers?: ProjectPaper[]
  }

  // Always prefer editor.storage.citation (authoritative mutable runtime state).
  // NodeView extension.storage can lag behind on some transactions.
  const storage = storageFromEditor || storageFromNode
  
  // These will be re-read on every render (storageVersion change triggers re-render)
  const style = storage?.citationStyle || 'apa'
  const citationNumbers = storage?.citationNumbers
  const citationNumber = storage?.citationNumbers?.get(attrs.id)
  const papers = storage?.papers ?? EMPTY_PAPERS
  
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
  const resolvedCitationNumber = useMemo(() => {
    if (!isNumericStyle(style)) return citationNumber
    if (citationNumber !== undefined) return citationNumber
    if (!editor || editor.isDestroyed) return undefined

    // Fallback: rebuild number map from the document if storage is stale.
    const numbers = new Map<string, number>()
    let counter = 1
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'citation' && node.attrs?.id) {
        const id = String(node.attrs.id)
        if (!numbers.has(id)) {
          numbers.set(id, counter++)
        }
      }
    })
    return numbers.get(String(attrs.id))
  }, [style, citationNumber, editor, attrs.id])

  const groupedCitation = useMemo(() => {
    if (!attrs.groupRequired || !attrs.citationGroupId || !editor || editor.isDestroyed) {
      return null
    }

    const groupNodes: Array<{ attrs: CitationAttributes; pos: number }> = []
    editor.state.doc.descendants((docNode, pos) => {
      if (docNode.type.name !== 'citation') return
      const nodeAttrs = docNode.attrs as CitationAttributes
      if (nodeAttrs.groupRequired && nodeAttrs.citationGroupId === attrs.citationGroupId) {
        groupNodes.push({ attrs: nodeAttrs, pos })
      }
    })

    if (groupNodes.length <= 1) return null

    groupNodes.sort((a, b) => {
      const orderA =
        typeof a.attrs.citationGroupOrder === 'number'
          ? a.attrs.citationGroupOrder
          : Number.MAX_SAFE_INTEGER
      const orderB =
        typeof b.attrs.citationGroupOrder === 'number'
          ? b.attrs.citationGroupOrder
          : Number.MAX_SAFE_INTEGER
      if (orderA !== orderB) return orderA - orderB
      return a.pos - b.pos
    })

    const anchor = groupNodes[0]!
    const currentKey = attrs.instanceId || attrs.id
    const anchorKey = anchor.attrs.instanceId || anchor.attrs.id
    const isAnchor = currentKey === anchorKey

    const papersById = new Map<string, {
      id: string
      title?: string
      authors?: string[]
      year?: number
      journal?: string
      doi?: string
    }>()

    for (const groupNode of groupNodes) {
      const paperId = groupNode.attrs.id
      if (!paperId || papersById.has(paperId)) continue

      const paperFromStorage = papers.find((p) => p.id === paperId)
      if (paperFromStorage) {
        papersById.set(paperId, {
          id: paperFromStorage.id,
          title: paperFromStorage.title,
          authors: paperFromStorage.authors,
          year: paperFromStorage.year,
          journal: paperFromStorage.journal,
          doi: paperFromStorage.doi,
        })
      } else {
        papersById.set(paperId, {
          id: paperId,
          title: groupNode.attrs.title,
          authors: groupNode.attrs.authors,
          year: groupNode.attrs.year,
          journal: groupNode.attrs.journal,
          doi: groupNode.attrs.doi,
        })
      }
    }

    const groupedPapers = Array.from(papersById.values())
    if (groupedPapers.length <= 1) return null

    return {
      isAnchor,
      text: formatInlineMultiple(groupedPapers, style, citationNumbers),
    }
  }, [
    attrs.groupRequired,
    attrs.citationGroupId,
    attrs.instanceId,
    attrs.id,
    editor,
    papers,
    style,
    citationNumbers,
  ])

  const text = useMemo(() => {
    if (groupedCitation) {
      return groupedCitation.isAnchor ? groupedCitation.text : ''
    }
    const result = formatCitationByStyle(displayAttrs, style, resolvedCitationNumber)
    if (process.env.NODE_ENV === 'development') {
      console.log(
        `[CitationNodeView] Recomputed text: style="${style}", ver=${storageVersion}, id=${attrs.id?.slice(0, 8)} → "${result}"`
      )
    }
    return result
  }, [groupedCitation, displayAttrs, style, resolvedCitationNumber, storageVersion, attrs.id])

  const shouldHideGroupedSibling = Boolean(groupedCitation && !groupedCitation.isAnchor)

  return (
    <NodeViewWrapper
      as="span"
      className={`citation-inline cursor-pointer ${selected ? 'ProseMirror-selectednode' : ''}`}
      data-citation={attrs.id}
      data-type="citation"
      data-instance-id={attrs.instanceId || undefined}
      data-cited-content={attrs.citedContent || ''}
      data-citation-group-id={attrs.citationGroupId || undefined}
      data-citation-group-order={
        typeof attrs.citationGroupOrder === 'number' ? String(attrs.citationGroupOrder) : undefined
      }
      data-group-required={attrs.groupRequired ? 'true' : undefined}
      style={shouldHideGroupedSibling ? { display: 'none' } : undefined}
    >
      {shouldHideGroupedSibling ? null : text}
    </NodeViewWrapper>
  )
}
