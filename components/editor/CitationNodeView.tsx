'use client'

import { NodeViewWrapper } from '@tiptap/react'
import { Badge } from '@/components/ui/badge'
import { useState, useCallback } from 'react'
import { BookOpen } from 'lucide-react'
import type { NodeViewProps } from '@tiptap/react'

interface CitationAttrs {
  citationId: string
  displayText: string
}

interface CitationNodeViewProps extends NodeViewProps {
  node: NodeViewProps['node'] & {
    attrs: CitationAttrs
  }
}

export default function CitationNodeView({ 
  node, 
  deleteNode
}: CitationNodeViewProps) {
  const [isHovered, setIsHovered] = useState(false)
  const { citationId, displayText } = node.attrs

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    // Trigger citation edit/search dialog
    const event = new CustomEvent('openCitationSearch', {
      detail: { citationId, position: e.target }
    })
    window.dispatchEvent(event)
  }, [citationId])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      deleteNode()
    }
  }, [deleteNode])

  // Generate display text based on citation ID
  const getDisplayText = () => {
    if (displayText && displayText !== `[${citationId.substring(0, 8)}...]`) {
      return displayText
    }
    
    // Try to create a readable format
    if (citationId.includes('-')) {
      // Looks like a UUID, show shortened version
      return `[${citationId.substring(0, 8)}]`
    }
    
    // Show full ID if it's short enough
    return citationId.length <= 20 ? `[${citationId}]` : `[${citationId.substring(0, 15)}...]`
  }

  return (
    <NodeViewWrapper
      as="span"
      className="inline-citation-wrapper"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Badge
        variant="outline"
        className={`
          inline-flex items-center gap-1 text-xs font-normal cursor-pointer
          transition-all duration-200 select-none
          ${isHovered 
            ? 'bg-blue-50 border-blue-300 text-blue-700 shadow-sm' 
            : 'bg-gray-50 border-gray-300 text-gray-600'
          }
          hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700
        `}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="button"
        aria-label={`Citation: ${citationId}`}
      >
        <BookOpen className="h-3 w-3" />
        <span>{getDisplayText()}</span>
      </Badge>
    </NodeViewWrapper>
  )
} 