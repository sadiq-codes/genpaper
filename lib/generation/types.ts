import type { PaperWithAuthors, GenerationConfig, GenerationProgress } from '@/types/simplified'
import type { CSLItem } from '@/lib/utils/csl'
import type { PaperTypeKey } from '@/lib/prompts/types'

// Tool call analytics types
export interface CapturedToolCall {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  result: Record<string, unknown> | null
  timestamp: string
  validated: boolean
  error?: string
}

export interface ToolCallAnalytics {
  totalToolCalls: number
  validatedToolCalls: number
  successfulToolCalls: number
  failedToolCalls: number
  invalidToolCalls: number
  addCitationCalls: number
  successfulCitations: number
  toolCallTimestamps: string[]
  errors: { type: string; toolCallId: string; error?: string }[]
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
}

export interface GenerationResult {
  content: string
  citations: Array<{
    paperId: string
    citationText: string
    positionStart?: number
    positionEnd?: number
    pageRange?: string
    toolCall?: CapturedToolCall
  }>
  citationsMap: Map<string, CSLItem>
  wordCount: number
  sources: PaperWithAuthors[]
  structure: {
    sections: string[]
    abstract: string
  }
  toolCallAnalytics: ToolCallAnalytics
}

// Chunk types
export interface PaperChunk {
  paper_id: string
  content: string
  score?: number
}

export interface PaperWithEvidence {
  paper: PaperWithAuthors
  chunk: PaperChunk | null
}

// Paper types with search scores
export interface PaperWithScores extends PaperWithAuthors {
  semantic_score?: number
  keyword_score?: number
}

// Prompt template types
export interface TemplateVars {
  numProvidedPapers: number
  length: string
  lengthGuidance: string
  paperTypeName: string
  paperTypeDescription: string
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

// Production generator configuration
export interface ProductionGenerationConfig {
  paperType: PaperTypeKey
  section: SectionKey
  topic: string
  contextChunks: string[]
  availablePapers: PaperWithAuthors[]
  expectedWords: number
  enablePlanning: boolean
  enableReflection: boolean
  enableMetrics: boolean
  onProgress?: (stage: string, progress: number, message: string) => void
} 