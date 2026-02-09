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
    <div className="mt-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="group inline-flex items-center gap-1 text-[10px] text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors cursor-pointer"
      >
        <ChevronDown className={cn(
          "h-2.5 w-2.5 transition-transform",
          !isExpanded && "-rotate-90"
        )} />
        <span className="tracking-wide uppercase font-medium">{paperCount} source{paperCount !== 1 ? 's' : ''}</span>
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-2.5 pl-3 border-l border-foreground/10">
          {Object.entries(byPaper).map(([paperId, { title, chunks }]) => (
            <div key={paperId}>
              <p className="font-instrument text-[11px] text-foreground/50 leading-snug line-clamp-1 italic">
                {title}
              </p>
              {chunks.map((chunk, i) => (
                <p
                  key={i}
                  className="text-[10px] text-muted-foreground/35 leading-relaxed mt-0.5 line-clamp-2"
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
