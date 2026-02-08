/**
 * Editor Hooks
 * 
 * Extracted from ResearchEditor to separate concerns:
 * - useEditorState: Content, auto-save, persistence
 * - usePaperManagement: Add/remove papers
 * - useEditorChat: AI chat with streaming + tools
 */

export { useEditorState } from './useEditorState'
export { usePaperManagement } from './usePaperManagement'
export { useEditorChat } from './useEditorChat'
export type { PendingToolCall, UseEditorChatReturn, SendMessageOptions } from './useEditorChat'
export { usePaperSearch, searchPapers } from './usePaperSearch'
export { useChatImageUpload } from './useChatImageUpload'

// Re-export existing hooks
export { useSmartCompletion } from './useSmartCompletion'
export { useCitationFormatter, clearAllCitationCaches } from './useCitationFormatter'
export type { CitationPaper } from './useCitationFormatter'

// Autocomplete preferences hook
export { useAutocompletePrefs } from './useAutocompletePrefs'
export type { AutocompletePrefs } from './useAutocompletePrefs'

// Note: useCitationManager hooks have been removed.
// Citation formatting is now 100% local via CitationNodeView + local-formatter.ts
