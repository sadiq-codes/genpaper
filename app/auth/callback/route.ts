import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAbsoluteUrlFromHeaders } from '@/lib/config'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
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
            console.error('Error creating/updating profile:', profileError)
          } else {
            console.log('✅ Profile ensured for user:', user.id)
          }

          // Auto-detect recovery flow when no explicit `next` was provided
          if (!searchParams.has('next') && user.recovery_sent_at) {
            const elapsed = Date.now() - new Date(user.recovery_sent_at).getTime()
            if (elapsed < 3_600_000) {
              return NextResponse.redirect(toRedirectUrl('/reset-password'))
            }
          }
        }
        
        // Authentication successful, redirect to destination
        return NextResponse.redirect(toRedirectUrl(next))
      } else {
        console.error('Code exchange failed:', error)
        return NextResponse.redirect(
          toRedirectUrl(`/login?error=${encodeURIComponent('Authentication failed. Please try again.')}`)
        )
      }
    } catch (error) {
      console.error('Callback error:', error)
      return NextResponse.redirect(
        toRedirectUrl(`/login?error=${encodeURIComponent('Network error. Please check your connection and try again.')}`)
      )
    }
  }

  // Handle hash-based recovery/signup tokens (Supabase PKCE flow).
  // When the user clicks the email link, Supabase redirects with tokens in the
  // URL hash fragment. The server can't read those, so redirect to the client
  // page which will pick them up automatically via the Supabase client SDK.
  const type = searchParams.get('type')
  if (type === 'recovery') {
    return NextResponse.redirect(toRedirectUrl('/reset-password'))
  }

  // No code provided, redirect to login
  return NextResponse.redirect(toRedirectUrl('/login'))
}
