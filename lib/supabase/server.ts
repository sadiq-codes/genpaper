import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'

// Cached client to avoid recreation on every call
let _cachedClient: SupabaseClient | null = null

export async function createClient() {
  // Return cached client if available and still valid
  if (_cachedClient) {
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

  return _cachedClient
}

// Helper to get cached client directly (for performance)
export const getSB = () => _cachedClient ?? createClient() 