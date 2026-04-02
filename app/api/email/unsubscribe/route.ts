import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { createServiceClient } from '@/lib/supabase/service'

function verifyToken(userId: string, token: string): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const expected = createHmac('sha256', secret).update(userId).digest('hex')
  return token === expected
}

export async function GET(request: NextRequest) {
  const uid = request.nextUrl.searchParams.get('uid')
  const token = request.nextUrl.searchParams.get('token')

  if (!uid || !token || !verifyToken(uid, token)) {
    return new NextResponse('Invalid or expired unsubscribe link.', {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  try {
    const supabase = createServiceClient()
    await supabase
      .from('profiles')
      .update({
        marketing_email_opt_out: true,
        onboarding_email_paused: true,
      })
      .eq('id', uid)

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Unsubscribed</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#fafafa;">
<div style="text-align:center;max-width:400px;padding:40px;">
  <h1 style="font-size:20px;font-weight:600;margin:0 0 16px 0;">You've been unsubscribed</h1>
  <p style="color:#666;margin:0 0 24px 0;">You won't receive any more emails from GenPaper.</p>
  <a href="https://genpaper.ai" style="color:#1a1a1a;text-decoration:underline;">Back to GenPaper</a>
</div>
</body></html>`

    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  } catch (e) {
    console.error('[Unsubscribe] Error:', e)
    return new NextResponse('Something went wrong. Please try again.', {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
}
