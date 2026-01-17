/**
 * Editor Hooks
 * 
 * Extracted from ResearchEditor to separate concerns:
 * - useEditorState: Content, auto-save, persistence
 * - usePaperManagement: Add/remove papers
 * - useEditorChat: AI chat with streaming + tools
 * - useBackgroundPaperSearch: Background paper search for write mode
 */

export { useEditorState } from './useEditorState'
export { usePaperManagement } from './usePaperManagement'
export { useEditorChat } from './useEditorChat'
export type { PendingToolCall, UseEditorChatReturn } from './useEditorChat'
export { useBackgroundPaperSearch } from './useBackgroundPaperSearch'

// Re-export existing hooks
export { useSmartCompletion } from './useSmartCompletion'
export { useCitationFormatter, clearAllCitationCaches } from './useCitationFormatter'
export type { CitationPaper } from './useCitationFormatter'

// Note: useCitationManager hooks have been removed.
// Citation formatting is now 100% local via CitationNodeView + local-formatter.ts
