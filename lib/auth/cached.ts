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
import type { User } from '@supabase/supabase-js'

/**
 * Get the current user, cached per request.
 * Returns null if not authenticated.
 */
export const getUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  
  if (error || !user) {
    return null
  }
  
  return user
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
