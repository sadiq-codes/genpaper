import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const email = body?.email
    const password = body?.password

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      console.error('Sign-in error:', error)
      return NextResponse.json(
        { error: error.message || 'Invalid credentials' },
        { status: 401 }
      )
    }

    if (!data.session) {
      return NextResponse.json(
        { error: 'No session created' },
        { status: 401 }
      )
    }

    // Session cookies are automatically set via createServerClient's cookie adapter
    return NextResponse.json({ 
      success: true,
      user: data.user 
    })
  } catch (error) {
    console.error('Sign-in failed:', error)
    const message = error instanceof Error ? error.message : 'Network error - please check your connection'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
