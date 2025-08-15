/**
 * Unified API Error Handling
 * 
 * Centralized error handling for API routes to ensure consistent responses
 */

import { NextResponse } from 'next/server'

export interface ApiErrorResponse {
  error: string
  message?: string
  details?: unknown
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Create standardized error responses
 */
export function createErrorResponse(
  error: unknown,
  defaultMessage: string = 'An unexpected error occurred'
): NextResponse<ApiErrorResponse> {
  // Handle ApiError with specific status codes
  if (error instanceof ApiError) {
    return NextResponse.json({
      error: error.message,
      details: error.details
    }, { status: error.status })
  }

  // Handle general errors
  if (error instanceof Error) {
    console.error('API Error:', error.message, error.stack)
    
    // Check for common error patterns
    if (error.message.includes('not found') || error.message.includes('Not found')) {
      return NextResponse.json({
        error: 'Resource not found'
      }, { status: 404 })
    }
    
    if (error.message.includes('unauthorized') || error.message.includes('Unauthorized')) {
      return NextResponse.json({
        error: 'Unauthorized access'
      }, { status: 401 })
    }
    
    if (error.message.includes('validation') || error.message.includes('Invalid')) {
      return NextResponse.json({
        error: 'Validation failed',
        message: error.message
      }, { status: 400 })
    }

    return NextResponse.json({
      error: 'Internal server error',
      message: error.message
    }, { status: 500 })
  }

  // Handle unknown errors
  console.error('Unknown API Error:', error)
  return NextResponse.json({
    error: 'Internal server error',
    message: defaultMessage
  }, { status: 500 })
}

/**
 * Wrapper for API route handlers with unified error handling
 */
export function withErrorHandling<T>(
  handler: () => Promise<T>
): Promise<T | NextResponse<ApiErrorResponse>> {
  return handler().catch(error => createErrorResponse(error))
}

/**
 * Quick error creators for common cases
 */
export const ApiErrors = {
  notFound: (message: string = 'Resource not found') => 
    new ApiError(404, message),
  
  unauthorized: (message: string = 'Unauthorized access') => 
    new ApiError(401, message),
  
  validation: (message: string, details?: unknown) => 
    new ApiError(400, message, details),
  
  internal: (message: string = 'Internal server error') => 
    new ApiError(500, message),
  
  methodNotAllowed: (method: string) => 
    new ApiError(405, `Method ${method} not allowed`)
}
