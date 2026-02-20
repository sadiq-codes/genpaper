/**
 * Content Module Barrel File
 * 
 * Centralized exports for all content-related functionality
 */

// Error classes
export {
  ContentRetrievalError,
  NoRelevantContentError,
  ContentQualityError,
  IngestionError,
  ChunkingError,
  isContentError,
  createContentError
} from './errors'

// Processing status helpers
export {
  normalizePaperProcessingStatus,
  isChunkReadyStatus,
  isFullTextReadyStatus,
  canMarkFullTextReady,
  FULL_TEXT_READY_MIN_CHARS,
  type PaperProcessingStatus,
} from './processing-status'

export { setPaperProcessingStatus } from './processing-status-service'

// Ingestion functions
export {
  getContentStatus,
  getPaperProcessingStatusMap,
  ensurePapersExist,
  createChunksForPaper,
  ensureBulkContentIngestion,
  checkContentAvailability,
  type ContentStatus,
  type IngestionOptions,
  type IngestionResult,
  type BulkIngestionSummary
} from './ingestion' 