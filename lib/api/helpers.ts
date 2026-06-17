import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { isAppError } from '@/lib/errors'
import { getUser } from '@/lib/auth/cached'

// ============================================================================
// Auth Helpers
// ============================================================================

/**
 * Get the authenticated user from the current request context.
 * Returns null if not authenticated.
 * 
 * Uses React's cache() for request deduplication via lib/auth/cached.ts
 */
export async function getAuthenticatedUser(): Promise<User | null> {
  return getUser()
}

// ============================================================================
// Response Helpers
// ============================================================================

export function unauthorized(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 })
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export function notFound(message = 'Not found') {
  return NextResponse.json({ error: message }, { status: 404 })
}

export function serverError(message = 'Internal server error') {
  return NextResponse.json({ error: message }, { status: 500 })
}

export function success<T>(data: T, status = 200) {
  return NextResponse.json(data, { status })
}

// ============================================================================
// Validation Helpers
// ============================================================================

type ParseResult<T> = 
  | { success: true; data: T }
  | { success: false; error: string }

/**
 * Parse and validate URL query parameters against a Zod schema.
 */
export function parseQuery<T extends z.ZodSchema>(
  request: NextRequest,
  schema: T
): ParseResult<z.infer<T>> {
  const url = new URL(request.url)
  const params = Object.fromEntries(url.searchParams)
  const result = schema.safeParse(params)
  
  if (result.success) {
    return { success: true, data: result.data }
  }
  
  const errorMessage = result.error.errors
    .map(e => `${e.path.join('.')}: ${e.message}`)
    .join(', ')
  return { success: false, error: errorMessage }
}

/**
 * Parse and validate request body against a Zod schema.
 */
export function parseBody<T extends z.ZodSchema>(
  body: unknown,
  schema: T
): ParseResult<z.infer<T>> {
  const result = schema.safeParse(body)
  
  if (result.success) {
    return { success: true, data: result.data }
  }
  
  const errorMessage = result.error.errors
    .map(e => `${e.path.join('.')}: ${e.message}`)
    .join(', ')
  return { success: false, error: errorMessage }
}

// ============================================================================
// Common Schemas
// ============================================================================

export const UuidSchema = z.string().uuid('Invalid UUID format')

export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

export const SortOrderSchema = z.enum(['asc', 'desc']).default('desc')

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Convert any error to an appropriate NextResponse.
 * Use this in catch blocks for consistent error responses.
 * 
 * @example
 * ```ts
 * try {
 *   await someOperation()
 * } catch (error) {
 *   return handleError(error)
 * }
 * ```
 */
export function handleError(error: unknown, logPrefix?: string): NextResponse {
  // Log the error
  if (logPrefix) {
    console.error(`${logPrefix}:`, error)
  }

  // Handle typed AppErrors
  if (isAppError(error)) {
    return NextResponse.json(
      { 
        error: error.message, 
        code: error.code,
      },
      { status: error.statusCode }
    )
  }

  // Handle standard Errors
  if (error instanceof Error) {
    return NextResponse.json(
      { error: error.message, code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }

  // Handle unknown errors
  return NextResponse.json(
    { error: 'An unexpected error occurred', code: 'UNKNOWN_ERROR' },
    { status: 500 }
  )
}

/**
 * Wrapper for API route handlers with automatic error handling.
 * 
 * @example
 * ```ts
 * export const GET = withErrorHandler(async (request) => {
 *   const user = await requireAuth()
 *   const data = await fetchData()
 *   return success(data)
 * })
 * ```
 */
export function withErrorHandler(
  handler: (request: NextRequest) => Promise<NextResponse>
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest) => {
    try {
      return await handler(request)
    } catch (error) {
      return handleError(error)
    }
  }
}

/**
 * Require authentication, throwing AuthenticationError if not authenticated.
 * Use inside withErrorHandler for automatic error response.
 */
export async function requireAuth(): Promise<User> {
  const user = await getAuthenticatedUser()
  if (!user) {
    // Import dynamically to avoid circular dependency
    const { AuthenticationError } = await import('@/lib/errors')
    throw new AuthenticationError()
  }
  return user
}

// ============================================================================
// Resource Ownership Verification
// ============================================================================

/**
 * Verify that a project belongs to the specified user.
 * Throws NotFoundError if project doesn't exist or user doesn't own it.
 * 
 * @example
 * ```ts
 * export const GET = withErrorHandler(async (request) => {
 *   const user = await requireAuth()
 *   await verifyProjectOwnership(projectId, user.id)
 *   // User owns the project, proceed...
 * })
 * ```
 */
export async function verifyProjectOwnership(projectId: string, userId: string): Promise<void> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('research_projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .single()
  
  if (error || !data) {
    // Import dynamically to avoid circular dependency
    const { NotFoundError } = await import('@/lib/errors')
    throw new NotFoundError('Project not found or access denied', 'PROJECT_ACCESS_DENIED')
  }
}

/**
 * Verify that a paper belongs to the specified user.
 * Throws NotFoundError if paper doesn't exist or user doesn't own it.
 */
export async function verifyPaperOwnership(paperId: string, userId: string): Promise<void> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('papers')
    .select('id')
    .eq('id', paperId)
    .eq('user_id', userId)
    .single()
  
  if (error || !data) {
    const { NotFoundError } = await import('@/lib/errors')
    throw new NotFoundError('Paper not found or access denied', 'PAPER_ACCESS_DENIED')
  }
}
