import { createClient } from '@/lib/supabase/server'
import { cache } from 'react'

/**
 * Check if a user is an admin.
 * 
 * Uses the is_admin column in the profiles table.
 * Cached per request to avoid duplicate database calls.
 */
export const isAdmin = cache(async (userId: string): Promise<boolean> => {
  if (!userId) return false
  
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', userId)
    .single()
  
  return data?.is_admin === true
})

/**
 * Synchronous admin check for cases where we can't await.
 * Falls back to false if uncertain - use isAdmin() when possible.
 * 
 * @deprecated Use isAdmin() instead when possible
 */
export function isAdminSync(userId: string): boolean {
  // Fallback list for sync contexts (e.g., middleware)
  // This should be removed once all usages are async
  const FALLBACK_ADMIN_IDS = [
    'e97fda5f-92d7-4087-be83-ca26aea7faaa',
  ]
  return FALLBACK_ADMIN_IDS.includes(userId)
}
