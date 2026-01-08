import type { PaperWithAuthors, GenerationConfig, GenerationProgress } from '@/types/simplified'
import type { CSLItem } from '@/lib/utils/csl'
import type { PaperTypeKey } from '@/lib/prompts/types'

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