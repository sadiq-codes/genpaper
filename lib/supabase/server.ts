import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'

// Cached client to avoid recreation on every call
let _cachedClient: SupabaseClient | null = null
let _cacheTimestamp: number = 0

// Cache duration in milliseconds (5 minutes)
const CACHE_DURATION = 5 * 60 * 1000

export async function createClient() {
  // Check if cached client exists and is still valid
  const now = Date.now()
  if (_cachedClient && (now - _cacheTimestamp) < CACHE_DURATION) {
    return _cachedClient
  }

  const cookieStore = await cookies()

  _cachedClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )

  _cacheTimestamp = now
  return _cachedClient
}

// Optimized helper to get cached client - handles async properly
export async function getSB(): Promise<SupabaseClient> {
  if (_cachedClient && (Date.now() - _cacheTimestamp) < CACHE_DURATION) {
    return _cachedClient
  }
  return await createClient()
}

// Force refresh client (useful for testing or when auth state changes)
export function clearClientCache(): void {
  _cachedClient = null
  _cacheTimestamp = 0
} 