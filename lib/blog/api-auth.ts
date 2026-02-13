/**
 * Blog API Authentication
 * 
 * Supports two authentication methods:
 * 1. API Key (for AI agents like OpenClaw)
 * 2. Session (for admin UI - logged-in users with admin role)
 */

import { createClient } from '@/lib/supabase/server'

export interface AuthResult {
  authenticated: boolean
  method: 'api_key' | 'session' | null
  userId?: string
  error?: string
}

// Admin user IDs (you can also use a database table for this)
const ADMIN_USER_IDS = [
  'e97fda5f-92d7-4087-be83-ca26aea7faaa', // Your user ID
]

/**
 * Validate API key from Authorization header
 */
function validateApiKey(authHeader: string | null): boolean {
  if (!authHeader) return false
  
  const apiKey = process.env.BLOG_API_KEY
  if (!apiKey) {
    console.error('[Blog Auth] BLOG_API_KEY not configured')
    return false
  }
  
  // Support both "Bearer <key>" and just "<key>"
  const providedKey = authHeader.replace(/^Bearer\s+/i, '')
  
  return providedKey === apiKey
}

/**
 * Validate session and check if user is admin
 */
async function validateSession(): Promise<{ valid: boolean; userId?: string }> {
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    
    if (error || !user) {
      return { valid: false }
    }
    
    // Check if user is admin
    const isAdmin = ADMIN_USER_IDS.includes(user.id)
    
    return { valid: isAdmin, userId: user.id }
  } catch {
    return { valid: false }
  }
}

/**
 * Authenticate a request for blog API access
 * 
 * Checks API key first, then falls back to session auth
 */
export async function authenticateBlogRequest(
  request: Request
): Promise<AuthResult> {
  const authHeader = request.headers.get('authorization')
  
  // Try API key first
  if (authHeader && validateApiKey(authHeader)) {
    return {
      authenticated: true,
      method: 'api_key',
    }
  }
  
  // Try session auth
  const sessionResult = await validateSession()
  if (sessionResult.valid) {
    return {
      authenticated: true,
      method: 'session',
      userId: sessionResult.userId,
    }
  }
  
  // Neither worked
  return {
    authenticated: false,
    method: null,
    error: 'Unauthorized. Provide valid API key or log in as admin.',
  }
}

/**
 * Check if request is from API key (vs session)
 */
export function isApiKeyAuth(request: Request): boolean {
  const authHeader = request.headers.get('authorization')
  return authHeader ? validateApiKey(authHeader) : false
}
