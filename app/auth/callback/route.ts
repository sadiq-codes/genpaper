import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/generate'

  if (code) {
    const supabase = await createClient()
    
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    
    if (!error) {
      // Email verification successful, redirect to generate page
      return NextResponse.redirect(new URL(next, request.url))
    } else {
      // Email verification failed, redirect to login with error
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent('Email verification failed. Please try again.')}`, request.url)
      )
    }
  }

  // No code provided, redirect to login
  return NextResponse.redirect(new URL('/login', request.url))
} 