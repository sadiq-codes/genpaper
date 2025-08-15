// Re-export functions from centralized modules
export {
  getContentStatus,
  checkContentAvailability,
  ensureBulkContentIngestion,
  ContentRetrievalError,
  NoRelevantContentError,
  ContentQualityError
} from '@/lib/content'

export {
  getRelevantChunks,
  assertChunksFound
} from './rag-retrieval'

// Simplified chunks module - now only re-exports centralized functions
// Citation injection logic removed in favor of unified addCitation tool approach

// NOTE: addEvidenceBasedCitations function removed
// Citation handling is now unified through the addCitation tool during generation
// This eliminates redundant citation injection logic and simplifies the pipeline 