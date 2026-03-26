import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendBulkEmails } from '@/lib/email/service'
import { campaignEmail } from '@/lib/email/templates/campaign-wrapper'
import { isAdmin } from '@/lib/admin'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user || !isAdmin(user.id)) return null
  return user
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const svc = createServiceClient()

  const [{ data: campaigns }, { count: recipientCount }] = await Promise.all([
    svc
      .from('email_campaigns')
      .select('id, subject, recipient_count, sent_at')
      .order('sent_at', { ascending: false })
      .limit(20),
    svc
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('marketing_email_opt_out', false)
      .not('email', 'eq', ''),
  ])

  return NextResponse.json({
    campaigns: campaigns || [],
    recipientCount: recipientCount || 0,
  })
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { subject, bodyHtml } = await request.json()
  if (!subject || !bodyHtml) {
    return NextResponse.json({ error: 'subject and bodyHtml required' }, { status: 400 })
  }

  const svc = createServiceClient()

  const { data: profiles, error: fetchErr } = await svc
    .from('profiles')
    .select('id, email')
    .eq('marketing_email_opt_out', false)
    .not('email', 'eq', '')

  if (fetchErr || !profiles) {
    return NextResponse.json({ error: 'Failed to fetch recipients' }, { status: 500 })
  }

  const recipients = profiles.map((p) => ({
    email: p.email,
    userId: p.id,
  }))

  const result = await sendBulkEmails({
    subject,
    html: campaignEmail({ bodyHtml, userId: '' }),
    recipients,
    emailType: 'campaign',
  })

  await svc.from('email_campaigns').insert({
    subject,
    body_html: bodyHtml,
    recipient_count: recipients.length,
    sent_at: new Date().toISOString(),
  })

  return NextResponse.json({
    sent: result.sent,
    failed: result.failed,
    total: recipients.length,
  })
}
