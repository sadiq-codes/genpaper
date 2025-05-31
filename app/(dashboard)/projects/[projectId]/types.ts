// Section status enum
export type SectionStatus = 
  | 'completed' 
  | 'in-progress' 
  | 'draft' 
  | 'pending' 
  | 'ai_drafting'

// Citation status enum  
export type CitationStatus = 
  | 'suggested' 
  | 'accepted' 
  | 'rejected'

// Project status enum
export type ProjectStatus = 
  | 'draft'
  | 'in-progress' 
  | 'ai-drafting'
  | 'completed'
  | 'archived'

// AI suggestion types
export type AISuggestionType = 
  | 'text' 
  | 'citation' 
  | 'style'

// Citation source types
export type CitationSourceType = 
  | 'journal'
  | 'book' 
  | 'website'
  | 'conference'
  | 'preprint'

// Core interfaces
export interface BasicProject {
  id: string
  title: string
  status?: ProjectStatus
  created_at: string
}

export interface Project extends BasicProject {
  outline?: string
  content?: string
  citations_identified?: any[] // eslint-disable-line @typescript-eslint/no-explicit-any
  references_list?: any[] // eslint-disable-line @typescript-eslint/no-explicit-any
  word_count?: number
  citation_count?: number
}

export interface Section {
  id: string
  project_id: string
  section_key: string
  title: string
  content?: string
  order: number
  status: SectionStatus
  word_count: number
  created_at: string
  updated_at: string
}

export interface Citation {
  id: string
  project_id: string
  title: string
  authors: string
  year: string
  journal?: string
  doi?: string
  abstract?: string
  source_type: CitationSourceType
  source_url?: string
  relevance_score?: number
  status: CitationStatus
  created_at: string
  updated_at: string
}

export interface AISuggestion {
  id: number
  type: AISuggestionType
  content: string
  position: { line: number; char: number }
  confidence?: number
  suggestedCitation?: Citation
  original?: string
  suggested?: string
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
}

export interface SectionsResponse extends ApiResponse {
  sections?: Section[]
}

export interface ProjectWorkspaceProps {
  projectId: string
  initialProject: BasicProject
} 