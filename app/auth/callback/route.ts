import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAbsoluteUrlFromHeaders } from '@/lib/config'

/**
 * Auth Callback Handler
 * 
 * Handles OAuth and magic link callbacks from Supabase.
 * Profile creation is now handled by a database trigger (see migration).
 */

function sanitizeNextPath(raw: string | null): string {
  const fallback = '/projects'
  if (!raw || typeof raw !== 'string') return fallback
  const trimmed = raw.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return fallback
  if (trimmed.includes('\0') || trimmed.includes('\n')) return fallback
  return trimmed
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const next = sanitizeNextPath(searchParams.get('next'))
  const type = searchParams.get('type')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')
  
  const toUrl = (path: string) => getAbsoluteUrlFromHeaders(request.headers, path)

  // Handle OAuth errors
  if (error) {
    const params = new URLSearchParams({
      error,
      error_description: errorDescription || 'Authentication failed',
    })
    return NextResponse.redirect(toUrl(`/login?${params.toString()}`))
  }

  // No code = direct navigation to callback (shouldn't happen)
  if (!code) {
    return NextResponse.redirect(toUrl('/login'))
  }

  // Exchange code for session
  const supabase = await createClient()
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError) {
    console.error('[auth/callback] Code exchange failed:', exchangeError.message)
    const params = new URLSearchParams({
      error: 'exchange_failed',
      error_description: 'Sign-in link is invalid or expired. Please try again.',
    })
    return NextResponse.redirect(toUrl(`/login?${params.toString()}`))
  }

  // Handle password recovery flow
  if (type === 'recovery') {
    return NextResponse.redirect(toUrl('/reset-password'))
  }

  // Success - redirect to destination
  return NextResponse.redirect(toUrl(next))
}
