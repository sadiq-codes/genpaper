import 'server-only'
import { Resend } from 'resend'
import { createServiceClient } from '@/lib/supabase/service'
import { createHmac } from 'crypto'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://genpaper.ai'
const FROM_ADDRESS = 'GenPaper <noreply@genpaper.ai>'

let resend: Resend | null = null

function getResend(): Resend | null {
  if (resend) return resend
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[Email] RESEND_API_KEY not configured')
    return null
  }
  resend = new Resend(apiKey)
  return resend
}

async function logEmail(userId: string | null, emailType: string, subject: string) {
  try {
    const supabase = createServiceClient()
    await supabase.from('email_log').insert({
      user_id: userId,
      email_type: emailType,
      subject,
    })
  } catch (e) {
    console.error('[Email] Failed to log email send:', e)
  }
}

export async function sendEmail(opts: {
  to: string
  subject: string
  html: string
  userId?: string | null
  emailType?: string
}): Promise<boolean> {
  const client = getResend()
  if (!client) {
    console.log(`[Email] Would send "${opts.subject}" to ${opts.to} (Resend not configured)`)
    return false
  }

  try {
    const { error } = await client.emails.send({
      from: FROM_ADDRESS,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    })
    if (error) {
      console.error('[Email] Send failed:', error)
      return false
    }
    await logEmail(opts.userId ?? null, opts.emailType ?? 'transactional', opts.subject)
    return true
  } catch (e) {
    console.error('[Email] Unexpected send error:', e)
    return false
  }
}

export async function sendBulkEmails(opts: {
  subject: string
  html: string
  recipients: { email: string; userId: string }[]
  emailType?: string
}): Promise<{ sent: number; failed: number }> {
  const client = getResend()
  if (!client) {
    console.log(`[Email] Would send bulk "${opts.subject}" to ${opts.recipients.length} recipients (Resend not configured)`)
    return { sent: 0, failed: 0 }
  }

  let sent = 0
  let failed = 0

  // Resend batch API accepts up to 100 emails per call
  const batchSize = 100
  for (let i = 0; i < opts.recipients.length; i += batchSize) {
    const batch = opts.recipients.slice(i, i + batchSize)
    try {
      const { error } = await client.batch.send(
        batch.map((r) => ({
          from: FROM_ADDRESS,
          to: r.email,
          subject: opts.subject,
          html: opts.html,
        }))
      )
      if (error) {
        console.error('[Email] Batch send error:', error)
        failed += batch.length
      } else {
        sent += batch.length
        for (const r of batch) {
          await logEmail(r.userId, opts.emailType ?? 'campaign', opts.subject)
        }
      }
    } catch (e) {
      console.error('[Email] Batch send exception:', e)
      failed += batch.length
    }
  }

  return { sent, failed }
}

export function getBaseUrl(): string {
  return BASE_URL
}

export function buildUnsubscribeUrl(userId: string): string {
  const secret = process.env.CRON_SECRET || 'fallback-secret'
  const token = createHmac('sha256', secret).update(userId).digest('hex')
  return `${BASE_URL}/api/email/unsubscribe?uid=${userId}&token=${token}`
}
