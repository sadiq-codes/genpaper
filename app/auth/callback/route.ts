import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAbsoluteUrlFromHeaders } from '@/lib/config'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const type = searchParams.get('type')
  const next = searchParams.get('next') ?? '/projects'
  const toRedirectUrl = (path: string) => getAbsoluteUrlFromHeaders(request.headers, path)

  if (code) {
    try {
      const supabase = await createClient()
      
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      
      if (!error) {
        // Get the authenticated user
        const { data: { user } } = await supabase.auth.getUser()
        
        if (user) {
          // Ensure profile exists - create if missing
          const { error: profileError } = await supabase
            .from('profiles')
            .upsert({
              id: user.id,
              email: user.email || '',
              full_name: user.user_metadata?.full_name || user.user_metadata?.name || '',
              created_at: new Date().toISOString()
            }, {
              onConflict: 'id',
              ignoreDuplicates: false
            })
          
          if (profileError) {
            console.error('[auth/callback] Profile upsert error:', profileError)
          }

          // Explicit type param (set in forgot-password redirectTo) is the primary signal.
          // Fall back to recovery_sent_at for emails sent before the redirectTo fix.
          const isRecovery = type === 'recovery' || (
            !searchParams.has('next') &&
            !!user.recovery_sent_at &&
            Date.now() - new Date(user.recovery_sent_at).getTime() < 3_600_000
          )
          if (isRecovery) {
            return NextResponse.redirect(toRedirectUrl('/reset-password'))
          }
        }
        
        // Authentication successful, redirect to destination
        return NextResponse.redirect(toRedirectUrl(next))
      } else {
        console.error('[auth/callback] Code exchange failed:', error.message, error.status)
        return NextResponse.redirect(
          toRedirectUrl(`/login?error=${encodeURIComponent('Authentication failed. Please try again.')}`)
        )
      }
    } catch (error) {
      console.error('[auth/callback] Unexpected error:', error)
      return NextResponse.redirect(
        toRedirectUrl(`/login?error=${encodeURIComponent('Network error. Please check your connection and try again.')}`)
        )
    }
  }

  // Hash-based recovery fallback: server can't read hash fragments, so redirect
  // to the client page which picks them up via the Supabase client SDK.
  if (type === 'recovery') {
    return NextResponse.redirect(toRedirectUrl('/reset-password'))
  }

  // No code provided, redirect to login
  return NextResponse.redirect(toRedirectUrl('/login'))
}
