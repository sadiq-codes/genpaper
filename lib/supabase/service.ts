import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Create a Supabase client with service role privileges
 * This bypasses RLS policies and should only be used for trusted server-side operations
 * like content ingestion and chunk processing
 */
export function createServiceClient(): SupabaseClient<Database> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing Supabase environment variables for service client')
  }
  
  return createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })
}

/**
 * Singleton instance of the service client
 */
let serviceClient: SupabaseClient<Database> | null = null

/**
 * Get the service client instance
 * Uses singleton pattern to avoid creating multiple clients
 */
export function getServiceClient(): SupabaseClient<Database> {
  if (!serviceClient) {
    serviceClient = createServiceClient()
  }
  return serviceClient
} 