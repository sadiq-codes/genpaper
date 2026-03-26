import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendEmail } from '@/lib/email/service'
import { DRIP_STEPS, TOTAL_DRIP_STEPS } from '@/lib/email/drip-config'

export const runtime = 'nodejs'
export const maxDuration = 60

function verifyCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = request.headers.get('authorization')
  return auth === `Bearer ${secret}`
}

export async function POST(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  // Find users who have pending drip steps
  const { data: users, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, created_at, onboarding_email_step')
    .eq('onboarding_email_paused', false)
    .eq('marketing_email_opt_out', false)
    .lt('onboarding_email_step', TOTAL_DRIP_STEPS)

  if (error) {
    console.error('[Drip Cron] Failed to fetch users:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  if (!users || users.length === 0) {
    return NextResponse.json({ processed: 0, sent: 0 })
  }

  const now = Date.now()
  let sent = 0

  for (const user of users) {
    const step = DRIP_STEPS[user.onboarding_email_step]
    if (!step) continue

    const createdAt = new Date(user.created_at).getTime()
    const delayMs = step.delayDays * 24 * 60 * 60 * 1000
    if (now - createdAt < delayMs) continue

    const html = step.buildHtml({
      name: user.full_name || user.email.split('@')[0],
      userId: user.id,
    })

    const ok = await sendEmail({
      to: user.email,
      subject: step.subject,
      html,
      userId: user.id,
      emailType: 'drip',
    })

    if (ok) {
      await supabase
        .from('profiles')
        .update({ onboarding_email_step: user.onboarding_email_step + 1 })
        .eq('id', user.id)
      sent++
    }
  }

  return NextResponse.json({ processed: users.length, sent })
}
