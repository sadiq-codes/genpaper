/**
 * Browser-side Supabase Client
 * 
 * Usage Guidelines:
 * - Use `createClient()` or `getSB()` in client components (files with 'use client')
 * - Both return a cached singleton - safe to call multiple times
 * - Use `supabase` export directly if you don't need a function call
 * - Call `clearClientCache()` after auth state changes if needed
 * 
 * Example:
 *   const supabase = createClient()
 *   const { data } = await supabase.from('papers').select()
 */

import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Cached singleton client for browser-side operations
let _browserClient: SupabaseClient | null = null

// Create cached browser client
function getCachedBrowserClient(): SupabaseClient {
  if (!_browserClient) {
    _browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey)
  }
  return _browserClient
}

// Primary export - optimized cached client
export const supabase = getCachedBrowserClient()

// Export a function that returns the cached client for consistency with server client
export const createClient = (): SupabaseClient => getCachedBrowserClient()

// Optimized helper to get cached client directly (matches server getSB pattern)
export const getSB = (): SupabaseClient => getCachedBrowserClient()

// Force refresh client (useful for testing or auth state changes)
export function clearClientCache(): void {
  _browserClient = null
} 