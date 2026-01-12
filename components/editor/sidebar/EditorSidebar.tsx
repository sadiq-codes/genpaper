'use client'

import { Clock, FlaskConical, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ChatTab } from './ChatTab'
import { ResearchTab } from './ResearchTab'
import type { 
  ChatMessage, 
  ProjectPaper, 
  Citation, 
  ExtractedClaim, 
  ResearchGap,
  AnalysisState,
} from '../types'
import { cn } from '@/lib/utils'

interface EditorSidebarProps {
  activeTab: 'chat' | 'research'
  onTabChange: (tab: 'chat' | 'research') => void
  // Chat props
  chatMessages: ChatMessage[]
  onSendMessage: (content: string) => void
  isChatLoading?: boolean
  // Research props
  papers: ProjectPaper[]
  analysisState: AnalysisState
  onInsertCitation: (citation: Citation) => void
  onInsertClaim: (claim: ExtractedClaim) => void
  onInsertGap: (gap: ResearchGap) => void
  onRunAnalysis: () => void
  onOpenLibrary: () => void
  onRemovePaper: (paperId: string, claimCount: number) => void
  // History
  onOpenHistory?: () => void
}

export function EditorSidebar({
  activeTab,
  onTabChange,
  chatMessages,
  onSendMessage,
  isChatLoading = false,
  papers,
  analysisState,
  onInsertCitation,
  onInsertClaim,
  onInsertGap,
  onRunAnalysis,
  onOpenLibrary,
  onRemovePaper,
  onOpenHistory,
}: EditorSidebarProps) {
  return (
    <div className="flex flex-col h-full rounded-2xl border-2 border-foreground/10 bg-background overflow-hidden">
      {/* Tab header */}
      <div className="flex items-center justify-between p-3 border-b-2 border-foreground/10">
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
            <span>Research</span>
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
      <div className="flex-1 overflow-hidden">
        {activeTab === 'chat' ? (
          <ChatTab 
            messages={chatMessages}
            onSendMessage={onSendMessage}
            isLoading={isChatLoading}
          />
        ) : (
          <ResearchTab 
            papers={papers}
            analysisState={analysisState}
            onInsertClaim={onInsertClaim}
            onInsertGap={onInsertGap}
            onInsertCitation={(paper) => onInsertCitation({
              id: paper.id,
              authors: paper.authors,
              title: paper.title,
              year: paper.year,
              journal: paper.journal,
              doi: paper.doi,
            })}
            onRunAnalysis={onRunAnalysis}
            onOpenLibrary={onOpenLibrary}
            onRemovePaper={onRemovePaper}
          />
        )}
      </div>
    </div>
  )
}
