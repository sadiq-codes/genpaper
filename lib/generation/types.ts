import type { PaperWithAuthors, GenerationConfig, GenerationProgress } from '@/types/simplified'
import type { CSLItem } from '@/lib/utils/csl'

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
  libraryPaperIds?: string[]
  useLibraryOnly?: boolean
  config: GenerationConfig
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