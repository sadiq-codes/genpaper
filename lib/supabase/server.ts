/**
 * Server-side Supabase Client
 * 
 * Usage Guidelines:
 * - Use `getSB()` or `createClient()` in server components, API routes, and server actions
 * - Both functions return the same client - use whichever reads better in context
 * - The client automatically handles cookie-based auth when available
 * - Falls back to anonymous access when called outside request context (e.g., background tasks)
 * 
 * Example:
 *   const supabase = await getSB()
 *   const { data } = await supabase.from('papers').select()
 */

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function createClient(): Promise<SupabaseClient> {
  // `cookies()` is only available inside a Route Handler / Server Component execution context.
  // When we call Supabase helpers from background async tasks (e.g., inside a ReadableStream),
  // it throws an error.  In such cases we still want a working Supabase client, just without
  // per-request cookie management.

  let cookieStore: Awaited<ReturnType<typeof cookies>> | null = null
  try {
    cookieStore = await cookies()
  } catch {
    // No request context – fall back to a stub implementation.
  }

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore ? cookieStore.getAll() : []
        },
        setAll(cookiesToSet) {
          if (!cookieStore) return // Nothing to persist in a background context
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            /* ignore */
          }
        },
      },
    }
  )
}

// Helper to get client - maintains consistent API  
export async function getSB(): Promise<SupabaseClient> {
  return await createClient()
} 