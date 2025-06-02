// Updated types for the simplified research paper generator

export interface User {
  id: string
  email: string
  full_name?: string
  created_at: string
}

export interface Author {
  id: string
  name: string
}

export interface PaperMetadata {
  search_query?: string
  found_at?: string
  relevance_score?: number
  [key: string]: unknown
}

export interface GenerationConfig {
  model?: string
  search_parameters?: {
    sources?: string[]
    limit?: number
    useSemanticSearch?: boolean
  }
  paper_settings?: {
    length?: 'short' | 'medium' | 'long'
    style?: 'academic' | 'review' | 'survey'
    citationStyle?: 'apa' | 'mla' | 'chicago' | 'ieee'
    includeMethodology?: boolean
    includeFuture?: boolean
  }
  library_papers_used?: string[]
  [key: string]: unknown
}

export interface Paper {
  id: string
  title: string
  abstract?: string
  publication_date?: string
  venue?: string // journal / conference / arXiv category
  doi?: string
  url?: string
  pdf_url?: string
  metadata?: PaperMetadata
  source?: string // 'arxiv', 'pubmed', 'manual', etc.
  citation_count?: number
  impact_score?: number
  created_at: string
  authors?: Author[] // Joined from paper_authors table
}

export interface PaperAuthor {
  paper_id: string
  author_id: string
  ordinal?: number
}

export type PaperStatus = 'generating' | 'complete' | 'failed'

export interface ResearchProject {
  id: string
  user_id: string
  topic: string
  status: PaperStatus
  generation_config?: GenerationConfig
  created_at: string
  completed_at?: string
}

export interface ResearchProjectVersion {
  id: string
  project_id: string
  version: number
  content?: string
  word_count?: number
  created_at: string
}

export interface ProjectCitation {
  id: string
  project_id: string
  version: number
  paper_id: string
  block_id?: string
  position_start?: number
  position_end?: number
  citation_text: string // "(Smith & Doe, 2023)"
  page_range?: string
  created_at: string
  paper?: Paper // Joined paper data
}

export interface LibraryPaper {
  id: string
  user_id: string
  paper_id: string
  notes?: string
  added_at: string
  paper: Paper // Joined paper data
}

export interface LibraryCollection {
  id: string
  user_id: string
  name: string
  description?: string
  created_at: string
  paper_count?: number
}

export interface Tag {
  id: string
  user_id: string
  name: string
}

// API Request/Response types
export interface GenerateRequest {
  topic: string
  libraryPaperIds?: string[]
  useLibraryOnly?: boolean
  config?: {
    length?: 'short' | 'medium' | 'long'
    style?: 'academic' | 'review' | 'survey'
    citationStyle?: 'apa' | 'mla' | 'chicago' | 'ieee'
    includeMethodology?: boolean
  }
}

export interface GenerateResponse {
  projectId: string
  status: PaperStatus
  message?: string
}

export interface SearchPapersRequest {
  query: string
  limit?: number
  sources?: string[] // Filter by source
  useSemanticSearch?: boolean
}

export interface SearchPapersResponse {
  papers: Paper[]
  total: number
  query: string
}

export interface AddToLibraryRequest {
  paperId?: string
  paperData?: Partial<Paper> // For manual paper entry
  notes?: string
  collectionId?: string
}

export interface AddToLibraryResponse {
  success: boolean
  libraryPaper?: LibraryPaper
}

// UI State types
export interface CitationPreviewData {
  citation: ProjectCitation
  paper: Paper
  isOpen: boolean
  position?: { x: number; y: number }
}

export interface GenerationProgress {
  stage: 'searching' | 'analyzing' | 'writing' | 'citations' | 'complete' | 'failed'
  progress: number
  message: string
  currentVersion?: number
}

export interface LibraryFilters {
  search?: string
  collectionId?: string
  tags?: string[]
  source?: string
  sortBy?: 'added_at' | 'title' | 'publication_date' | 'citation_count'
  sortOrder?: 'asc' | 'desc'
}

// Extended types with computed fields
export interface ResearchProjectWithLatestVersion extends ResearchProject {
  latest_version?: ResearchProjectVersion
  citation_count?: number
}

export interface PaperWithAuthors extends Paper {
  authors: Author[]
  author_names: string[] // Computed field for easy display
} 