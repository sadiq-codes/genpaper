import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/projects'

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
        }
        
        // Authentication successful, redirect to destination
        return NextResponse.redirect(new URL(next, request.url))
      } else {
        console.error('Code exchange failed:', error)
        return NextResponse.redirect(
          new URL(`/login?error=${encodeURIComponent('Authentication failed. Please try again.')}`, request.url)
        )
      }
    } catch (error) {
      console.error('Callback error:', error)
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent('Network error. Please check your connection and try again.')}`, request.url)
      )
    }
  }

  // No code provided, redirect to login
  return NextResponse.redirect(new URL('/login', request.url))
} 