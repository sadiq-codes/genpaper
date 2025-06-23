/**
 * Centralized Content-Related Error Classes
 * 
 * All content ingestion, retrieval, and processing errors are defined here
 * to avoid duplication across the codebase.
 */

export class ContentRetrievalError extends Error {
  constructor(message: string, public readonly context?: Record<string, unknown>) {
    super(message)
    this.name = 'ContentRetrievalError'
  }
}

export class NoRelevantContentError extends Error {
  constructor(message: string, public readonly context?: Record<string, unknown>) {
    super(message)
    this.name = 'NoRelevantContentError'
  }
}

export class ContentQualityError extends Error {
  constructor(message: string, public readonly context?: Record<string, unknown>) {
    super(message)
    this.name = 'ContentQualityError'
  }
}

export class IngestionError extends Error {
  constructor(message: string, public readonly context?: Record<string, unknown>) {
    super(message)
    this.name = 'IngestionError'
  }
}

export class ChunkingError extends Error {
  constructor(message: string, public readonly context?: Record<string, unknown>) {
    super(message)
    this.name = 'ChunkingError'
  }
}

/**
 * Type guard to check if an error is a content-related error
 */
export function isContentError(error: unknown): error is ContentRetrievalError | NoRelevantContentError | ContentQualityError | IngestionError | ChunkingError {
  return error instanceof Error && (
    error instanceof ContentRetrievalError ||
    error instanceof NoRelevantContentError ||
    error instanceof ContentQualityError ||
    error instanceof IngestionError ||
    error instanceof ChunkingError
  )
}

/**
 * Helper to create context-aware error messages
 */
export function createContentError(
  type: 'retrieval' | 'quality' | 'ingestion' | 'chunking' | 'no-content',
  message: string,
  context?: Record<string, unknown>
) {
  switch (type) {
    case 'retrieval':
      return new ContentRetrievalError(message, context)
    case 'quality':
      return new ContentQualityError(message, context)
    case 'ingestion':
      return new IngestionError(message, context)
    case 'chunking':
      return new ChunkingError(message, context)
    case 'no-content':
      return new NoRelevantContentError(message, context)
    default:
      return new ContentRetrievalError(message, context)
  }
} 