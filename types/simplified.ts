// Updated types for the simplified research paper generator

import type { CSLItem } from "@/lib/utils/csl"

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
  // Bibliographic
  volume?: string
  issue?: string
  pages?: string
  publisher?: string
  // Classification
  paper_type?: string // 'journal-article' | 'conference-paper' | 'preprint' | 'review' | 'book-chapter' | 'dissertation' | etc.
  keywords?: string[]
  fields_of_study?: string[]
  // Summaries
  tldr?: string // One-sentence summary (from Semantic Scholar)
  // Access & licensing
  is_open_access?: boolean
  open_access_status?: string // 'gold' | 'green' | 'bronze' | 'hybrid' | 'closed'
  license?: string // 'cc-by' | 'cc-by-nc' | etc.
  // Integrity
  is_retracted?: boolean
  // Metrics
  influential_citation_count?: number
  references_count?: number
  // Cross-reference identifiers
  external_ids?: Record<string, string> // { arxiv: '2301.00001', pmid: '12345', pmcid: 'PMC123', mag: '...' }
  // Ranking / search metadata
  combined_score?: number
  authority_score?: number
  recency_score?: number
  bm25_score?: number
  canonical_id?: string
  api_source?: string
  preprint_id?: string
  siblings?: string[]
  [key: string]: unknown
}

// Content source types - how full-text was obtained
export type ContentSource = 'pdf' | 'html' | 'abstract-only'

// Review settings for literature reviews
export interface ReviewSettingsConfig {
  review_focus?: string
}

// Voice profile identifiers for authorial persona variation
export type VoiceProfileId = 
  | 'conservative-reviewer'
  | 'confident-researcher' 
  | 'senior-scholar'
  | 'balanced-academic'

// Simplified generation config - no feature flags or complex nested objects
export interface GenerationConfig {
  temperature?: number
  max_tokens?: number
  sources?: string[]
  limit?: number
  library_papers_used?: string[]
  length?: number
  paperType?: PaperTypeKey
  localRegion?: string
  useLibraryOnly?: boolean
  // Paper settings (nested for backwards compatibility)
  paper_settings?: {
    paperType?: PaperTypeKey
  }
  // Original research configuration (for empirical papers)
  original_research?: OriginalResearchConfig
  // Review settings (for literature reviews)
  review_settings?: ReviewSettingsConfig
  // Voice/Authorial persona - controls hedging, confidence, citation posture
  // Selected during paper profile generation or manually by user
  voiceProfileId?: VoiceProfileId
  // Custom instructions extracted from user's freeform topic input
  custom_instructions?: string
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
  created_at: string
  csl_json?: CSLItem // CSL-JSON formatted citation data
  authors?: Author[] // Joined from paper_authors table
  content_source?: ContentSource // How full-text was obtained: 'pdf', 'html', or 'abstract-only'
}

export interface PaperAuthor {
  paper_id: string
  author_id: string
  ordinal?: number
}

export type PaperStatus = 'generating' | 'complete' | 'failed'

export type PaperTypeKey = 
  | 'researchArticle' 
  | 'literatureReview' 
  | 'capstoneProject' 
  | 'mastersThesis' 
  | 'phdDissertation'

/**
 * Search multipliers by paper type - determines how many papers to search for
 * relative to the ideal source count. Higher multipliers account for filtering losses.
 * E.g., if idealSourceCount is 40 and multiplier is 5, search for 200 papers.
 */
export const PAPER_TYPE_SEARCH_MULTIPLIERS: Record<PaperTypeKey, number> = {
  literatureReview: 5,      // Needs most sources, heavy filtering expected
  phdDissertation: 4,       // Comprehensive coverage needed
  mastersThesis: 3,         // Substantial but focused
  capstoneProject: 3,       // Similar to thesis
  researchArticle: 2.5,     // Focused, fewer sources needed
}

/**
 * Default target word count per paper type (midpoint of the accepted range).
 *
 * Literature Review:  3,000–8,000  → 5,500
 * Research Article:   4,000–8,000  → 6,000
 * Capstone Project:   5,000–10,000 → 7,500
 * Master's Thesis:   15,000–25,000 → 20,000
 * PhD Dissertation:  40,000–80,000 → 60,000
 */
export const DEFAULT_LENGTH_BY_PAPER_TYPE: Record<PaperTypeKey, number> = {
  literatureReview: 3000,
  researchArticle: 6000,
  capstoneProject: 7500,
  mastersThesis: 20000,
  phdDissertation: 60000,
}

/**
 * Minimum number of papers to search for by paper type.
 * Ensures adequate coverage even if idealSourceCount is low.
 */
export const PAPER_TYPE_MIN_SEARCH: Record<PaperTypeKey, number> = {
  literatureReview: 150,
  phdDissertation: 120,
  mastersThesis: 80,
  capstoneProject: 80,
  researchArticle: 50,
}

export interface OriginalResearchConfig {
  has_original_research: boolean
  research_question?: string
  key_findings?: string
}

export interface ResearchProject {
  id: string
  user_id: string
  topic: string
  status: PaperStatus
  generation_config?: GenerationConfig
  content?: string
  created_at: string
  completed_at?: string
  // New fields for original research support
  paper_type?: PaperTypeKey
  has_original_research?: boolean
  research_question?: string
  key_findings?: string
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
    length?: number
    paperType?: 'researchArticle' | 'literatureReview' | 'capstoneProject' | 'mastersThesis' | 'phdDissertation'
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
  content?: string // For streaming content updates
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

// Paper source types
export type PaperSource = 'openalex' | 'crossref' | 'semantic_scholar' | 'arxiv' | 'core' | 'google_scholar' | 'pubmed_central' | 'europe_pmc'
export type PaperSources = PaperSource[]