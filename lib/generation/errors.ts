/**
 * Error Classification System for Paper Generation Pipeline
 * 
 * Provides structured error types with retry guidance for robust error handling.
 */

export enum ErrorCategory {
  /** Transient errors that may succeed on retry (network, rate limits) */
  TRANSIENT = 'transient',
  /** Quality errors that may succeed with relaxed parameters */
  QUALITY = 'quality',
  /** Errors requiring user intervention (no papers, invalid input) */
  USER_ACTION = 'user_action',
  /** Fatal errors that cannot be recovered (auth, validation) */
  FATAL = 'fatal'
}

export interface ErrorMetadata {
  category: ErrorCategory
  retryable: boolean
  maxRetries: number
  backoffMs: number
  userMessage: string
  technicalDetails?: Record<string, unknown>
}

/**
 * Base class for all pipeline errors with classification metadata
 */
export class PipelineError extends Error {
  readonly category: ErrorCategory
  readonly retryable: boolean
  readonly maxRetries: number
  readonly backoffMs: number
  readonly userMessage: string
  readonly technicalDetails?: Record<string, unknown>

  constructor(message: string, metadata: Partial<ErrorMetadata> = {}) {
    super(message)
    this.name = 'PipelineError'
    this.category = metadata.category ?? ErrorCategory.FATAL
    this.retryable = metadata.retryable ?? false
    this.maxRetries = metadata.maxRetries ?? 0
    this.backoffMs = metadata.backoffMs ?? 1000
    this.userMessage = metadata.userMessage ?? message
    this.technicalDetails = metadata.technicalDetails
  }
}

/**
 * Transient errors - network issues, rate limits, temporary failures
 */
export class TransientError extends PipelineError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, {
      category: ErrorCategory.TRANSIENT,
      retryable: true,
      maxRetries: 3,
      backoffMs: 1000,
      userMessage: 'A temporary error occurred. Retrying...',
      technicalDetails: details
    })
    this.name = 'TransientError'
  }
}

/**
 * Quality errors - low scores, insufficient content
 */
export class QualityError extends PipelineError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, {
      category: ErrorCategory.QUALITY,
      retryable: true,
      maxRetries: 2,
      backoffMs: 500,
      userMessage: 'Content quality check failed. Adjusting parameters and retrying...',
      technicalDetails: details
    })
    this.name = 'QualityError'
  }
}

/**
 * User action required - no papers, invalid topic
 */
export class UserActionError extends PipelineError {
  constructor(message: string, userMessage: string, details?: Record<string, unknown>) {
    super(message, {
      category: ErrorCategory.USER_ACTION,
      retryable: false,
      maxRetries: 0,
      backoffMs: 0,
      userMessage,
      technicalDetails: details
    })
    this.name = 'UserActionError'
  }
}

/**
 * Fatal errors - auth failures, validation errors
 */
export class FatalError extends PipelineError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, {
      category: ErrorCategory.FATAL,
      retryable: false,
      maxRetries: 0,
      backoffMs: 0,
      userMessage: 'An unexpected error occurred. Please try again later.',
      technicalDetails: details
    })
    this.name = 'FatalError'
  }
}

/**
 * Timeout error - operation took too long
 */
export class TimeoutError extends PipelineError {
  constructor(operation: string, timeoutMs: number, details?: Record<string, unknown>) {
    super(`Operation '${operation}' timed out after ${timeoutMs}ms`, {
      category: ErrorCategory.TRANSIENT,
      retryable: true,
      maxRetries: 2,
      backoffMs: 2000,
      userMessage: `The ${operation} is taking longer than expected. Retrying...`,
      technicalDetails: { operation, timeoutMs, ...details }
    })
    this.name = 'TimeoutError'
  }
}

/**
 * Cancellation error - user or system cancelled the operation
 */
export class CancellationError extends PipelineError {
  constructor(reason?: string) {
    super(`Operation cancelled${reason ? `: ${reason}` : ''}`, {
      category: ErrorCategory.FATAL,
      retryable: false,
      maxRetries: 0,
      backoffMs: 0,
      userMessage: 'The operation was cancelled.'
    })
    this.name = 'CancellationError'
  }
}

/**
 * Classify an unknown error into a PipelineError
 */
export function classifyError(error: unknown): PipelineError {
  // Already classified
  if (error instanceof PipelineError) {
    return error
  }

  // Convert to Error if needed
  const err = error instanceof Error ? error : new Error(String(error))
  const message = err.message.toLowerCase()

  // Rate limit errors
  if (message.includes('rate limit') || message.includes('429') || message.includes('too many requests')) {
    return new TransientError(`Rate limit exceeded: ${err.message}`, { originalError: err.message })
  }

  // Network errors
  if (message.includes('network') || message.includes('econnreset') || message.includes('etimedout') || 
      message.includes('fetch failed') || message.includes('connection')) {
    return new TransientError(`Network error: ${err.message}`, { originalError: err.message })
  }

  // Timeout errors
  if (message.includes('timeout') || message.includes('aborted')) {
    return new TimeoutError('operation', 0, { originalError: err.message })
  }

  // Quality errors
  if (message.includes('quality') || message.includes('relevance') || message.includes('score')) {
    return new QualityError(err.message, { originalError: err.message })
  }

  // Content errors
  if (message.includes('no papers') || message.includes('no content') || message.includes('no relevant')) {
    return new UserActionError(
      err.message,
      'No relevant content found. Please add more papers to your project.',
      { originalError: err.message }
    )
  }

  // Auth errors
  if (message.includes('unauthorized') || message.includes('authentication') || message.includes('401')) {
    return new FatalError(`Authentication error: ${err.message}`, { originalError: err.message })
  }

  // Default to fatal
  return new FatalError(err.message, { originalError: err.message, stack: err.stack })
}

/**
 * Check if an error is retryable
 */
export function isRetryable(error: unknown): boolean {
  const classified = classifyError(error)
  return classified.retryable
}

/**
 * Get retry configuration for an error
 */
export function getRetryConfig(error: unknown): { maxRetries: number; backoffMs: number } {
  const classified = classifyError(error)
  return {
    maxRetries: classified.maxRetries,
    backoffMs: classified.backoffMs
  }
}
