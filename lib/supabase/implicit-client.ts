import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const IMPLICIT_CLIENT_KEY = '__supabaseImplicitClient'

export function createImplicitClient(): SupabaseClient {
  if (typeof window !== 'undefined') {
    const windowWithClient = window as typeof window & {
      [IMPLICIT_CLIENT_KEY]?: SupabaseClient
    }

    if (!windowWithClient[IMPLICIT_CLIENT_KEY]) {
      windowWithClient[IMPLICIT_CLIENT_KEY] = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          flowType: 'implicit',
          detectSessionInUrl: true,
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    }

    return windowWithClient[IMPLICIT_CLIENT_KEY]!
  }

  return createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      flowType: 'implicit',
      detectSessionInUrl: false,
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
