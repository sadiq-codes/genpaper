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

// Global key for storing client on window (survives HMR)
const SUPABASE_CLIENT_KEY = '__supabaseClient'

// Create cached browser client
// Uses window storage to persist across Hot Module Replacement (HMR) during development
// This prevents logout on hot reload by keeping the same client instance with its auth state
function getCachedBrowserClient(): SupabaseClient {
  // In browser, store on window to survive HMR module re-execution
  if (typeof window !== 'undefined') {
    if (!(window as unknown as Record<string, SupabaseClient>)[SUPABASE_CLIENT_KEY]) {
      (window as unknown as Record<string, SupabaseClient>)[SUPABASE_CLIENT_KEY] = 
        createBrowserClient(supabaseUrl, supabaseAnonKey)
    }
    return (window as unknown as Record<string, SupabaseClient>)[SUPABASE_CLIENT_KEY]
  }
  
  // SSR fallback (should rarely be used - server components should use server.ts)
  return createBrowserClient(supabaseUrl, supabaseAnonKey)
}

// Primary export - optimized cached client
export const supabase = getCachedBrowserClient()

// Export a function that returns the cached client for consistency with server client
export const createClient = (): SupabaseClient => getCachedBrowserClient()

// Optimized helper to get cached client directly (matches server getSB pattern)
export const getSB = (): SupabaseClient => getCachedBrowserClient()

// Force refresh client (useful for testing or auth state changes)
export function clearClientCache(): void {
  if (typeof window !== 'undefined') {
    delete (window as unknown as Record<string, SupabaseClient | undefined>)[SUPABASE_CLIENT_KEY]
  }
} 