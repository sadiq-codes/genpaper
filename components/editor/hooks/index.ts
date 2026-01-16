/**
 * Editor Hooks
 * 
 * Extracted from ResearchEditor to separate concerns:
 * - useEditorState: Content, auto-save, persistence
 * - useAnalysis: Paper analysis (claims, gaps, synthesis)
 * - usePaperManagement: Add/remove papers
 * - useChat: AI chat interactions (legacy, non-streaming)
 * - useEditorChat: New AI chat with streaming + tools
 * - useBackgroundPaperSearch: Background paper search for write mode
 */

export { useEditorState } from './useEditorState'
export { useAnalysis } from './useAnalysis'
export { usePaperManagement } from './usePaperManagement'
export { useChat } from './useChat'
export { useEditorChat } from './useEditorChat'
export type { PendingToolCall, UseEditorChatReturn } from './useEditorChat'
export { useBackgroundPaperSearch } from './useBackgroundPaperSearch'

// Re-export existing hooks
export { 
  useCitationManagerConfig, 
  useCitationPrefetch, 
  extractCitationIdsFromEditor 
} from './useCitationManager'
export { useSmartCompletion } from './useSmartCompletion'
