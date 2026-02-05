'use client'

import { useState, memo } from 'react'
import { ChevronDown, ChevronRight, FileText } from 'lucide-react'
import type { ProjectPaper } from '@/components/editor/types'

/**
 * Evidence chunk from RAG retrieval.
 * Matches the EvidenceChunk type exported from the chat route.
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
  intent?: string           // Detected intent: research, editing, chat, meta
  intentConfidence?: number // 0-1, how confident the classifier was
}

interface EvidencePanelProps {
  evidence?: EvidenceChunk[]
  papers: ProjectPaper[]
  ragMetadata?: RAGMetadata
}

/**
 * EvidencePanel - Shows what sources were used to generate an assistant response.
 * Collapsed by default, expands to show paper titles and excerpt snippets.
 * 
 * Hidden completely when:
 * - RAG was skipped (chat, editing, meta intents)
 * - No evidence was retrieved
 */
export const EvidencePanel = memo(function EvidencePanel({ 
  evidence, 
  papers, 
  ragMetadata 
}: EvidencePanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  // Hide completely when RAG was skipped - no need to tell users about internal routing
  if (ragMetadata?.skipped) {
    return null
  }

  // No evidence to show
  if (!evidence || evidence.length === 0) {
    return null
  }

  // Group evidence by paper for cleaner display
  const byPaper = evidence.reduce((acc, chunk) => {
    const key = chunk.paperId
    if (!acc[key]) {
      // Try to get title from evidence, fall back to papers prop
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
  const chunkCount = evidence.length

  return (
    <div className="mt-2 border-t border-border/40 pt-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full text-left"
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <FileText className="h-3 w-3 shrink-0" />
        <span>
          {chunkCount} excerpt{chunkCount !== 1 ? 's' : ''} from {paperCount} paper{paperCount !== 1 ? 's' : ''}
          {ragMetadata?.fallbackUsed && (
            <span className="text-muted-foreground/50 ml-1">(expanded search)</span>
          )}
        </span>
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-3 pl-5">
          {Object.entries(byPaper).map(([paperId, { title, chunks }]) => (
            <div key={paperId} className="space-y-1.5">
              <div className="text-[11px] font-medium text-foreground/70 truncate" title={title}>
                {title}
              </div>
              {chunks.map((chunk, i) => (
                <div 
                  key={i}
                  className="text-[10px] text-muted-foreground bg-muted/30 rounded px-2 py-1.5 line-clamp-3"
                  title={chunk.content}
                >
                  &ldquo;{chunk.content}&rdquo;
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
