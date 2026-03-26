import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendBulkEmails } from '@/lib/email/service'
import { campaignEmail } from '@/lib/email/templates/campaign-wrapper'

const ADMIN_USER_IDS = [
  'e97fda5f-92d7-4087-be83-ca26aea7faaa',
]

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user || !ADMIN_USER_IDS.includes(user.id)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { subject, bodyHtml } = await request.json()
  if (!subject || !bodyHtml) {
    return NextResponse.json({ error: 'subject and bodyHtml required' }, { status: 400 })
  }

  const svc = createServiceClient()

  // Fetch all users who haven't opted out
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

  // Wrap body in layout for each user
  const result = await sendBulkEmails({
    subject,
    html: campaignEmail({ bodyHtml, userId: '' }),
    recipients,
    emailType: 'campaign',
  })

  // Record campaign
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
