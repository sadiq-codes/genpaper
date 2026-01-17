import type { PaperWithAuthors, GenerationConfig, GenerationProgress } from '@/types/simplified'
import type { PaperTypeKey } from '@/lib/prompts/types'

// Recency profile type - matches PaperProfile.sourceExpectations.recencyProfile
export type RecencyProfile = 'cutting-edge' | 'balanced' | 'foundational-heavy'

/** Search year range determined by AI based on topic context */
export interface SearchYearRange {
  /** Start year for paper search (e.g., 2019 for COVID-19 topics, 1980 for foundational fields) */
  fromYear: number
  /** End year for paper search (typically current year) */
  toYear: number
  /** Explanation of why this year range is appropriate for the topic */
  rationale: string
}

// Generation types
export interface EnhancedGenerationOptions {
  projectId: string
  userId: string
  topic: string
  paperType: PaperTypeKey
  sourceIds: string[]
  libraryPaperIds?: string[]
  useLibraryOnly?: boolean
  config: GenerationConfig & {
    studyDesign?: 'qualitative' | 'quantitative' | 'mixed'
    fewShot?: boolean
  }
  onProgress?: (progress: GenerationProgress) => void
  /** Recency profile from paper profile - affects search weighting */
  recencyProfile?: RecencyProfile
  /** Explicit search year range from paper profile - overrides recencyProfile defaults */
  searchYearRange?: SearchYearRange
  /** Academic discipline from paper profile - affects source filtering */
  discipline?: string
}



// Chunk types - unified canonical definition
export interface PaperChunk {
  id?: string  // Optional deterministic chunk ID
  paper_id: string
  content: string
  score?: number
  metadata?: Record<string, unknown>
  paper?: PaperWithAuthors  // Optional paper reference for convenience
}

// Section types for production generator
export type SectionKey = 
  | 'literatureReview'
  | 'outline'
  | 'introduction'
  | 'thematicSection'
  | 'methodology'
  | 'results'
  | 'discussion'
  | 'conclusion'
  | 'abstract'

// Removed ProductionGenerationConfig - using simplified unified generation 