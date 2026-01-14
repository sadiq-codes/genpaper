/**
 * Typed Error Hierarchy
 * 
 * Use these errors throughout the codebase for consistent error handling.
 * API routes can catch and map these to appropriate HTTP responses.
 * 
 * @example
 * ```ts
 * // Throwing
 * throw new ValidationError('Invalid paper ID', 'INVALID_PAPER_ID')
 * 
 * // Catching in API route
 * try {
 *   await someOperation()
 * } catch (error) {
 *   if (error instanceof AppError) {
 *     return NextResponse.json(
 *       { error: error.message, code: error.code },
 *       { status: error.statusCode }
 *     )
 *   }
 *   throw error
 * }
 * ```
 */

// ============================================================================
// Base Error
// ============================================================================

export class AppError extends Error {
  public readonly code: string
  public readonly statusCode: number
  public readonly isOperational: boolean

  constructor(
    message: string,
    code: string = 'INTERNAL_ERROR',
    statusCode: number = 500,
    isOperational: boolean = true
  ) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.statusCode = statusCode
    this.isOperational = isOperational

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace(this, this.constructor)
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
    }
  }
}

// ============================================================================
// Client Errors (4xx)
// ============================================================================

/**
 * 400 Bad Request - Invalid input from client
 */
export class ValidationError extends AppError {
  public readonly field?: string

  constructor(message: string, code: string = 'VALIDATION_ERROR', field?: string) {
    super(message, code, 400)
    this.field = field
  }
}

/**
 * 401 Unauthorized - Missing or invalid authentication
 */
export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required', code: string = 'UNAUTHENTICATED') {
    super(message, code, 401)
  }
}

/**
 * 403 Forbidden - Authenticated but not authorized
 */
export class AuthorizationError extends AppError {
  constructor(message: string = 'Access denied', code: string = 'FORBIDDEN') {
    super(message, code, 403)
  }
}

/**
 * 404 Not Found - Resource doesn't exist
 */
export class NotFoundError extends AppError {
  public readonly resource?: string

  constructor(message: string = 'Resource not found', code: string = 'NOT_FOUND', resource?: string) {
    super(message, code, 404)
    this.resource = resource
  }
}

/**
 * 409 Conflict - Resource already exists or state conflict
 */
export class ConflictError extends AppError {
  constructor(message: string, code: string = 'CONFLICT') {
    super(message, code, 409)
  }
}

/**
 * 429 Too Many Requests - Rate limit exceeded
 */
export class RateLimitError extends AppError {
  public readonly retryAfter?: number

  constructor(message: string = 'Rate limit exceeded', retryAfter?: number) {
    super(message, 'RATE_LIMITED', 429)
    this.retryAfter = retryAfter
  }
}

// ============================================================================
// Server Errors (5xx)
// ============================================================================

/**
 * 500 Internal Server Error - Unexpected server failure
 */
export class InternalError extends AppError {
  constructor(message: string = 'Internal server error', code: string = 'INTERNAL_ERROR') {
    super(message, code, 500)
  }
}

/**
 * 503 Service Unavailable - Dependency failure
 */
export class ServiceUnavailableError extends AppError {
  public readonly service?: string

  constructor(message: string = 'Service temporarily unavailable', service?: string) {
    super(message, 'SERVICE_UNAVAILABLE', 503)
    this.service = service
  }
}

// ============================================================================
// Domain-Specific Errors
// ============================================================================

/**
 * Insufficient sources for paper generation
 */
export class InsufficientSourcesError extends ValidationError {
  public readonly required: number
  public readonly available: number

  constructor(required: number, available: number, paperType?: string) {
    const message = paperType
      ? `Insufficient sources for ${paperType}: need ${required}, have ${available}`
      : `Insufficient sources: need ${required}, have ${available}`
    super(message, 'INSUFFICIENT_SOURCES')
    this.required = required
    this.available = available
  }
}

/**
 * Paper content could not be retrieved
 */
export class ContentRetrievalError extends AppError {
  public readonly paperId?: string

  constructor(message: string = 'Failed to retrieve paper content', paperId?: string) {
    super(message, 'CONTENT_RETRIEVAL_FAILED', 500)
    this.paperId = paperId
  }
}

/**
 * AI/LLM service failure
 */
export class AIServiceError extends ServiceUnavailableError {
  public readonly model?: string

  constructor(message: string = 'AI service unavailable', model?: string) {
    super(message, 'ai')
    this.model = model
  }
}

/**
 * Paper search yielded no results
 */
export class NoResultsError extends NotFoundError {
  public readonly query?: string

  constructor(message: string = 'No papers found', query?: string) {
    super(message, 'NO_RESULTS', 'papers')
    this.query = query
  }
}

/**
 * Generation was cancelled by user
 */
export class GenerationCancelledError extends AppError {
  constructor(message: string = 'Generation cancelled') {
    super(message, 'GENERATION_CANCELLED', 499) // 499 = Client Closed Request
  }
}

/**
 * Project is in an invalid state for the operation
 */
export class InvalidProjectStateError extends ConflictError {
  public readonly currentState?: string
  public readonly expectedState?: string

  constructor(message: string, currentState?: string, expectedState?: string) {
    super(message, 'INVALID_PROJECT_STATE')
    this.currentState = currentState
    this.expectedState = expectedState
  }
}

// ============================================================================
// Error Utilities
// ============================================================================

/**
 * Type guard to check if error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

/**
 * Type guard to check if error is operational (expected) vs programmer error
 */
export function isOperationalError(error: unknown): boolean {
  if (isAppError(error)) {
    return error.isOperational
  }
  return false
}

/**
 * Wrap unknown errors in AppError for consistent handling
 */
export function wrapError(error: unknown, fallbackMessage: string = 'An error occurred'): AppError {
  if (isAppError(error)) {
    return error
  }
  if (error instanceof Error) {
    return new InternalError(error.message)
  }
  return new InternalError(fallbackMessage)
}
