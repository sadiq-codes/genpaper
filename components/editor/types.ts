// Editor types
import type { Editor } from '@tiptap/react'

export interface Citation {
  id: string
  authors: string[]
  title: string
  year: number
  journal?: string
  doi?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  citations?: Citation[]
}

export interface ProjectPaper {
  id: string
  title: string
  authors: string[]
  year: number
  abstract?: string
  journal?: string
  doi?: string
  content?: string
}

// Claim types from analysis
export type ClaimType = 'finding' | 'method' | 'limitation' | 'future_work' | 'background'

// Additional claim types for original research
export type OriginalClaimType = 'hypothesis' | 'contribution' | 'implication'

// Combined claim types
export type AllClaimTypes = ClaimType | OriginalClaimType

// Source of the claim
export type ClaimSource = 'literature' | 'original_research'

// Relationship between literature claim and user's research
export type ClaimRelationship = 'supports' | 'extends' | 'contradicts' | 'unrelated' | 'not_analyzed'

export interface ExtractedClaim {
  id: string
  paper_id?: string  // Optional - null for user's original research claims
  claim_text: string
  evidence_quote?: string
  section?: string
  claim_type: AllClaimTypes
  confidence: number
  // Joined paper data for display
  paper_title?: string
  paper_authors?: string[]
  paper_year?: number
  // NEW: Original research support
  source: ClaimSource
  relationship_to_user?: ClaimRelationship  // For literature claims: how they relate to user's research
  relationship_explanation?: string          // Brief explanation of the relationship
}

// Gap types from analysis
export type GapType = 'unstudied' | 'contradiction' | 'limitation'

// How the user's research addresses the gap
export type GapAddressedStatus = 'fully_addressed' | 'partially_addressed' | 'not_addressed' | 'not_analyzed'

export interface ResearchGap {
  id: string
  project_id: string
  gap_type: GapType
  description: string
  confidence: number
  supporting_paper_ids: string[]
  research_opportunity?: string
  evidence?: Array<{
    paper_id: string
    claim_text: string
    relevance: string
  }>
  // NEW: Original research support
  addressed_status: GapAddressedStatus
  user_contribution?: string  // How user's research addresses this gap
}

// Synthesis/Analysis types
export type AnalysisType = 'claim_extraction' | 'gap_analysis' | 'synthesis' | 'literature_review'

export interface AnalysisOutput {
  id: string
  project_id: string
  analysis_type: AnalysisType
  status: 'pending' | 'processing' | 'completed' | 'failed'
  structured_output?: {
    topic?: string
    paper_count?: number
    claim_count?: number
    themes?: Array<{
      name: string
      claims: string[]
      supporting_papers: string[]
    }>
    agreements?: Array<{
      finding: string
      papers: string[]
      confidence: number
    }>
    key_insights?: string[]
  }
  markdown_output?: string
  created_at: string
  completed_at?: string
}

// Research positioning analysis (for original research)
export interface ResearchPositioning {
  novelty: string[]           // What's new in user's research
  alignments: string[]        // Where user's findings agree with literature
  divergences: string[]       // Where user's findings differ from literature
  suggestedDiscussionPoints: string[]  // Auto-generated talking points for Discussion section
}

// Analysis state for the editor
export interface AnalysisState {
  status: 'idle' | 'loading' | 'analyzing' | 'complete' | 'error'
  claims: ExtractedClaim[]           // Literature claims
  userClaims: ExtractedClaim[]       // User's original research claims
  gaps: ResearchGap[]
  synthesis: AnalysisOutput | null
  positioning: ResearchPositioning | null  // Research positioning (when hasOriginalResearch)
  hasOriginalResearch: boolean       // Flag to indicate original research mode
  lastAnalyzedAt?: string
  error?: string
}

export interface EditorContextType {
  editor: Editor | null
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  activeTab: 'chat' | 'research'
  setActiveTab: (tab: 'chat' | 'research') => void
  projectId?: string
  projectPapers: ProjectPaper[]
  chatMessages: ChatMessage[]
  addChatMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void
  isAiLoading: boolean
  insertCitation: (citation: Citation) => void
  insertClaim: (claim: ExtractedClaim) => void
  insertGap: (gap: ResearchGap) => void
  autocompleteEnabled: boolean
  setAutocompleteEnabled: (enabled: boolean) => void
  analysisState: AnalysisState
  runAnalysis: () => Promise<void>
}

export interface ExportFormat {
  type: 'pdf' | 'docx' | 'latex'
  label: string
  icon: string
}

// Sentence generation types
export interface SuggestionCitation {
  paperId: string
  marker: string // "(Smith, 2023)"
  startOffset: number
  endOffset: number
}

export interface GeneratedSuggestion {
  text: string
  citations: SuggestionCitation[]
  contextHint: string
}

export interface GenerationContext {
  precedingText: string
  currentParagraph: string
  currentSection: string
  documentOutline: string[]
  cursorOffset: number
}

export interface CursorPosition {
  top: number
  left: number
  bottom: number
}
