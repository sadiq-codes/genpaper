'use client'

import { Clock, FlaskConical, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { UIMessage } from 'ai'
import type { 
  ProjectPaper, 
  Citation, 
} from '../types'
import type { PendingToolCall } from '../hooks/useEditorChat'
import type { ProcessingStatus } from '../hooks/usePaperProcessingStatus'
import { cn } from '@/lib/utils'
import { ChatTab, type ChatSendOptions } from './ChatTab'
import { ResearchTab } from './ResearchTab'

interface ProcessingSummary {
  total: number
  pending: number
  processing: number
  processed: number
  failed: number
  allProcessed: boolean
}

interface EditorSidebarProps {
  activeTab: 'chat' | 'research'
  onTabChange: (tab: 'chat' | 'research') => void
  // Project info
  projectId?: string
  // Chat props
  chatMessages: UIMessage[]
  onSendMessage: (content: string | ChatSendOptions) => void
  isChatLoading?: boolean
  /** Is chat history being loaded */
  isChatLoadingHistory?: boolean
  /** Chat error (for rate limit handling) */
  chatError?: Error | null
  // Tool-related props (actions are handled in editor, this is for status display only)
  pendingTools?: PendingToolCall[]
  onClearHistory?: () => void
  // Research props
  papers: ProjectPaper[]
  onInsertCitation: (citation: Citation) => void
  onOpenLibrary: () => void
  onRemovePaper: (paperId: string, claimCount: number) => void
  // Processing status props
  getProcessingStatus?: (paperId: string) => ProcessingStatus
  processingSummary?: ProcessingSummary
  onRetryPaper?: (paperId: string) => void
  isProcessingPolling?: boolean
  // History
  onOpenHistory?: () => void
  // Stop generation
  onStopGeneration?: () => void
}

export function EditorSidebar({
  activeTab,
  onTabChange,
  projectId,
  chatMessages,
  onSendMessage,
  isChatLoading = false,
  isChatLoadingHistory = false,
  chatError,
  pendingTools,
  onClearHistory,
  papers,
  onInsertCitation,
  onOpenLibrary,
  onRemovePaper,
  getProcessingStatus,
  processingSummary,
  onRetryPaper,
  isProcessingPolling,
  onOpenHistory,
  onStopGeneration,
}: EditorSidebarProps) {
  return (
    <div className="flex flex-col h-full rounded-2xl border-2 border-foreground/10 bg-background overflow-hidden">
      {/* Tab header */}
      <div className="flex-shrink-0 flex items-center justify-between p-3 border-b-2 border-foreground/10">
        <div className="flex gap-1 p-1 bg-muted rounded-lg">
          <button
            onClick={() => onTabChange('chat')}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
              activeTab === 'chat' 
                ? "bg-background shadow-sm text-primary font-caveat text-lg" 
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <MessageSquare className={cn("h-4 w-4", activeTab === 'chat' ? "text-primary" : "")} />
            <span>Chat</span>
          </button>
          <button
            onClick={() => onTabChange('research')}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
              activeTab === 'research' 
                ? "bg-background shadow-sm font-caveat text-lg" 
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <FlaskConical className="h-4 w-4" />
            <span>Papers</span>
          </button>
        </div>
        
        {onOpenHistory && (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-7 w-7"
                  onClick={onOpenHistory}
                >
                  <Clock className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Chat history</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'chat' ? (
          <ChatTab 
            messages={chatMessages}
            onSendMessage={onSendMessage}
            isLoading={isChatLoading}
            error={chatError}
            papers={papers}
            projectId={projectId}
            onCitePaper={(paper) => onInsertCitation({
              id: paper.id,
              authors: paper.authors,
              title: paper.title,
              year: paper.year,
              journal: paper.journal,
              doi: paper.doi,
            })}
            pendingTools={pendingTools}
            onClearHistory={onClearHistory}
            onStop={onStopGeneration}
          />
        ) : (
          <ResearchTab 
            papers={papers}
            onInsertCitation={(paper) => onInsertCitation({
              id: paper.id,
              authors: paper.authors,
              title: paper.title,
              year: paper.year,
              journal: paper.journal,
              doi: paper.doi,
            })}
            onOpenLibrary={onOpenLibrary}
            onRemovePaper={onRemovePaper}
            getProcessingStatus={getProcessingStatus}
            processingSummary={processingSummary}
            onRetryPaper={onRetryPaper}
            isPolling={isProcessingPolling}
          />
        )}
      </div>
    </div>
  )
}
