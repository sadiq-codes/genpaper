'use client'

import { FlaskConical, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ChatTab } from './ChatTab'
import { ResearchTab } from './ResearchTab'
import { useResearchEditor } from '../research-editor-context'

export function EditorSidebar() {
  const { activeTab, setActiveTab } = useResearchEditor()

  return (
    <div className="flex flex-col h-full rounded-xl border border-border/40 bg-background overflow-hidden">
      {/* Tab header */}
      <div className="shrink-0 flex items-center p-2 border-b border-border/30">
        <div className="flex gap-0.5 w-full" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === 'chat'}
            onClick={() => setActiveTab('chat')}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-200",
              activeTab === 'chat' 
                ? "bg-foreground/80 text-background font-medium" 
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Chat</span>
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'research'}
            onClick={() => setActiveTab('research')}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-200",
              activeTab === 'research' 
                ? "bg-foreground/80 text-background font-medium" 
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Papers</span>
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'chat' ? <ChatTab /> : <ResearchTab />}
      </div>
    </div>
  )
}
