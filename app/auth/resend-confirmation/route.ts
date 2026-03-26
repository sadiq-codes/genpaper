import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const supabase = await createClient()
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: `${new URL(request.url).origin}/auth/callback?next=%2Fprojects`,
      },
    })

    if (error) {
      console.error('[resend-confirmation] Supabase resend failed:', error.message, error.status, (error as { code?: string }).code)
      return NextResponse.json(
        { error: 'Could not send confirmation email. Please try "Forgot your password?" as a fallback.' },
        { status: 400 }
      )
    }

    // Always return success to avoid account enumeration.
    return NextResponse.json({
      success: true,
      message: 'If this account exists and is unconfirmed, a new confirmation email has been sent.',
    })
  } catch (error) {
    console.error('Resend confirmation failed:', error)
    return NextResponse.json({ error: 'Unable to resend confirmation email' }, { status: 500 })
  }
}
