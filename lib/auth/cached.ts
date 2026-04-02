/**
 * Cached Auth Utilities
 * 
 * Uses React's cache() function to deduplicate auth calls within a single request.
 * This prevents multiple database calls when multiple components need user data.
 * 
 * Usage:
 *   import { getUser, getUserOrRedirect } from '@/lib/auth/cached'
 *   
 *   // In a server component:
 *   const user = await getUser()
 *   if (!user) redirect('/login')
 *   
 *   // Or use the helper that handles redirect:
 *   const user = await getUserOrRedirect()
 */

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import type { User } from '@supabase/supabase-js'
import { ServiceUnavailableError } from '@/lib/errors'
import { isTransientAuthNetworkError } from '@/lib/supabase/transient-auth-fetch'

function hasSupabaseAuthCookie(cookieNames: string[]): boolean {
  return cookieNames.some((name) => {
    // Supabase SSR default cookie names look like:
    // sb-<project-ref>-auth-token (sometimes chunked as .0/.1)
    return name.startsWith('sb-') && name.includes('-auth-token')
  })
}

/**
 * Get the current user, cached per request.
 * Returns null if not authenticated.
 */
export const getUser = cache(async (): Promise<User | null> => {
  // Fast path: unauthenticated requests (for example /login or /signup) should
  // not block on a network auth check when no Supabase auth cookie exists.
  try {
    const cookieStore = await cookies()
    const cookieNames = cookieStore.getAll().map((cookie) => cookie.name)
    if (!hasSupabaseAuthCookie(cookieNames)) {
      return null
    }
  } catch {
    // Ignore missing request context and continue with normal auth check.
  }

  const supabase = await createClient()
  try {
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error) {
      if (isTransientAuthNetworkError(error)) {
        throw new ServiceUnavailableError('Authentication service temporarily unavailable', 'supabase-auth')
      }
      return null
    }
    if (!user) return null
    return user
  } catch (error) {
    if (isTransientAuthNetworkError(error)) {
      throw new ServiceUnavailableError('Authentication service temporarily unavailable', 'supabase-auth')
    }
    throw error
  }
})

/**
 * Get the current user or redirect to login.
 * Use this in protected routes.
 */
export const getUserOrRedirect = cache(async (): Promise<User> => {
  const user = await getUser()
  
  if (!user) {
    redirect('/login')
  }
  
  return user
})

/**
 * Get user ID only, cached per request.
 * Returns null if not authenticated.
 */
export const getUserId = cache(async (): Promise<string | null> => {
  const user = await getUser()
  return user?.id ?? null
})
