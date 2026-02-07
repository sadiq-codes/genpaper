'use client'

import { useState, memo } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ProjectPaper } from '@/components/editor/types'
import { cn } from '@/lib/utils'

/**
 * Evidence chunk from RAG retrieval.
 */
interface EvidenceChunk {
  paperId: string
  paperTitle?: string
  content: string
}

interface RAGMetadata {
  chunksRetrieved: number
  papersCovered: number
  skipped: boolean
  fallbackUsed: boolean
  intent?: string
  intentConfidence?: number
}

interface EvidencePanelProps {
  evidence?: EvidenceChunk[]
  papers: ProjectPaper[]
  ragMetadata?: RAGMetadata
}

/**
 * EvidencePanel - Minimal source attribution below assistant messages.
 * Shows which papers were referenced, expandable for details.
 */
export const EvidencePanel = memo(function EvidencePanel({ 
  evidence, 
  papers, 
  ragMetadata 
}: EvidencePanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (ragMetadata?.skipped) return null
  if (!evidence || evidence.length === 0) return null

  // Group by paper
  const byPaper = evidence.reduce((acc, chunk) => {
    const key = chunk.paperId
    if (!acc[key]) {
      const paperFromList = papers.find(p => p.id === key)
      acc[key] = {
        title: chunk.paperTitle || paperFromList?.title || 'Unknown paper',
        chunks: [],
      }
    }
    acc[key].chunks.push(chunk)
    return acc
  }, {} as Record<string, { title: string; chunks: EvidenceChunk[] }>)

  const paperCount = Object.keys(byPaper).length

  return (
    <div className="mt-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
      >
        <ChevronDown className={cn(
          "h-3 w-3 transition-transform",
          !isExpanded && "-rotate-90"
        )} />
        <span>{paperCount} source{paperCount !== 1 ? 's' : ''} used</span>
      </button>

      {isExpanded && (
        <div className="mt-1.5 space-y-2 pl-4 border-l-2 border-border/30">
          {Object.entries(byPaper).map(([paperId, { title, chunks }]) => (
            <div key={paperId}>
              <p className="text-[11px] font-medium text-foreground/60 leading-snug line-clamp-1">
                {title}
              </p>
              {chunks.map((chunk, i) => (
                <p
                  key={i}
                  className="text-[10px] text-muted-foreground/50 leading-relaxed mt-0.5 line-clamp-2 italic"
                >
                  {chunk.content}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
