'use client'

import dynamic from 'next/dynamic'
import { Clock, FlaskConical, MessageSquare, Loader2 } from 'lucide-react'
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
import { cn } from '@/lib/utils'

// Re-export type for external use
export type { ChatSendOptions } from './ChatTab'

// Code split the heavy tab components - only load when active
// This reduces initial bundle size significantly
const ChatTab = dynamic(() => import('./ChatTab').then(mod => ({ default: mod.ChatTab })), {
  ssr: false,
  loading: () => <TabLoadingSkeleton />,
})

const ResearchTab = dynamic(() => import('./ResearchTab').then(mod => ({ default: mod.ResearchTab })), {
  ssr: false,
  loading: () => <TabLoadingSkeleton />,
})

// Minimal loading skeleton for tabs
function TabLoadingSkeleton() {
  return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}

// Import type for ChatSendOptions
import type { ChatSendOptions } from './ChatTab'

interface EditorSidebarProps {
  activeTab: 'chat' | 'research'
  onTabChange: (tab: 'chat' | 'research') => void
  // Project info
  projectId?: string
  // Chat props
  chatMessages: UIMessage[]
  onSendMessage: (content: string | ChatSendOptions) => void
  isChatLoading?: boolean
  // Tool-related props (actions are in editor now, these are for status display)
  pendingTools?: PendingToolCall[]
  onConfirmTool?: (toolId: string) => void
  onRejectTool?: (toolId: string) => void
  onClearHistory?: () => void
  /** Whether ghost edit previews are visible in editor */
  hasGhostPreviews?: boolean
  // Research props
  papers: ProjectPaper[]
  onInsertCitation: (citation: Citation) => void
  onOpenLibrary: () => void
  onRemovePaper: (paperId: string, claimCount: number) => void
  // History
  onOpenHistory?: () => void
}

export function EditorSidebar({
  activeTab,
  onTabChange,
  projectId,
  chatMessages,
  onSendMessage,
  isChatLoading = false,
  pendingTools,
  onConfirmTool,
  onRejectTool,
  onClearHistory,
  hasGhostPreviews = false,
  papers,
  onInsertCitation,
  onOpenLibrary,
  onRemovePaper,
  onOpenHistory,
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
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'chat' ? (
          <ChatTab 
            messages={chatMessages}
            onSendMessage={onSendMessage}
            isLoading={isChatLoading}
            papers={papers}
            projectId={projectId}
            pendingTools={pendingTools}
            onConfirmTool={onConfirmTool}
            onRejectTool={onRejectTool}
            onClearHistory={onClearHistory}
            hasGhostPreviews={hasGhostPreviews}
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
          />
        )}
      </div>
    </div>
  )
}
