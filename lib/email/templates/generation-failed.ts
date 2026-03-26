import { emailLayout, ctaButton } from './layout'
import { getBaseUrl } from '@/lib/email/service'

export function generationFailedEmail(opts: {
  name: string
  userId: string
  projectTitle: string
  projectId: string
  errorSummary: string
}): string {
  const base = getBaseUrl()
  const firstName = opts.name.split(' ')[0] || 'there'

  return emailLayout({
    userId: opts.userId,
    body: `
      <p style="margin:0 0 16px 0;font-size:16px;">Hi ${firstName},</p>
      <p style="margin:0 0 16px 0;color:#444444;">Your paper generation for <strong>${opts.projectTitle}</strong> ran into an issue and couldn't complete.</p>
      <div style="background:#fef2f2;padding:16px;border-radius:6px;border:1px solid #fecaca;margin:16px 0;">
        <p style="margin:0;color:#991b1b;font-size:14px;">${opts.errorSummary}</p>
      </div>
      <p style="margin:0 0 16px 0;color:#444444;">This is usually temporary. You can try generating again — it often works on the second attempt.</p>
      ${ctaButton('Try Again', `${base}/editor/${opts.projectId}`)}
      <p style="margin:16px 0 0 0;color:#999999;font-size:13px;">If this keeps happening, the topic may need to be more specific or there may not be enough sources available.</p>
    `,
  })
}
