// Main editor component
export { ResearchEditor } from './ResearchEditor'

// Sub-components
export { EditorTopNav } from './EditorTopNav'
export { EditorSidebar } from './sidebar/EditorSidebar'
export { ChatTab } from './sidebar/ChatTab'
export { ResearchTab } from './sidebar/ResearchTab'
export { ChatInput } from './sidebar/ChatInput'
export { DocumentEditor } from './document/DocumentEditor'
export { PrimaryToolbar } from './document/PrimaryToolbar'
export { FloatingToolbar } from './document/FloatingToolbar'

// Extensions
export { Citation } from './extensions/Citation'
export { Mathematics } from './extensions/Mathematics'

// Types
export type {
  Citation as CitationType,
  ChatMessage,
  ProjectPaper,
  ExtractedClaim,
  ResearchGap,
  AnalysisOutput,
  AnalysisState,
  ClaimType,
  GapType,
  EditorContextType,
  ExportFormat,
} from './types'
