'use client'

import { createContext, useContext } from 'react'
import type { UIMessage } from 'ai'
import type { ProjectPaper, Citation } from './types'
import type { PendingToolCall } from './hooks/useEditorChat'
import type { ProcessingStatus } from './hooks/usePaperProcessingStatus'
import type { ChatSendOptions } from './sidebar/ChatTab'
import type { AutocompletePrefs } from './hooks/useAutocompletePrefs'

export interface ProcessingSummary {
  total: number
  pending: number
  processing: number
  processed: number
  failed: number
  allProcessed: boolean
}

export interface ResearchEditorContextValue {
  // Project
  projectId?: string
  projectTitle: string
  papers: ProjectPaper[]
  citationStyle: string

  // Autocomplete preferences (DB-backed)
  autocompletePrefs: AutocompletePrefs

  // Chat
  chatMessages: UIMessage[]
  isChatLoading: boolean
  isChatLoadingHistory: boolean
  chatError: Error | null | undefined
  pendingTools: PendingToolCall[]
  sendMessage: (content: string | ChatSendOptions) => void
  clearChatHistory: () => void
  stopGeneration: () => void

  // UI
  isMobile: boolean
  mobileMenuOpen: boolean
  sidebarOpen: boolean
  activeTab: 'chat' | 'research'
  setActiveTab: (tab: 'chat' | 'research') => void
  toggleSidebar: () => void
  openLibraryDrawer: () => void

  // Actions
  insertCitation: (citation: Citation) => void
  removePaper: (paperId: string, claimCount: number) => void

  // Processing status
  getProcessingStatus: (paperId: string) => ProcessingStatus
  processingSummary: ProcessingSummary | undefined
  retryPaper: (paperId: string) => void
  isProcessingPolling: boolean

  // Review toolbar
  pendingEditCount: number
  activeEditIndex: number
  navigateEdit: (direction: 'next' | 'prev') => void
  acceptAllEdits: () => void
  rejectAllEdits: () => void
}

const ResearchEditorContext = createContext<ResearchEditorContextValue | null>(null)

export function ResearchEditorProvider({
  children,
  value,
}: {
  children: React.ReactNode
  value: ResearchEditorContextValue
}) {
  return (
    <ResearchEditorContext.Provider value={value}>
      {children}
    </ResearchEditorContext.Provider>
  )
}

export function useResearchEditor(): ResearchEditorContextValue {
  const ctx = useContext(ResearchEditorContext)
  if (!ctx) {
    throw new Error('useResearchEditor must be used within a ResearchEditorProvider')
  }
  return ctx
}
