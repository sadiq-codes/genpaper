import { emailLayout, ctaButton } from './layout'
import { getBaseUrl } from '@/lib/email/service'

export function welcomeEmail(opts: { name: string; userId: string }): string {
  const base = getBaseUrl()
  const firstName = opts.name.split(' ')[0] || 'there'

  return emailLayout({
    userId: opts.userId,
    body: `
      <p style="margin:0 0 16px 0;font-size:16px;">Hi ${firstName},</p>
      <p style="margin:0 0 16px 0;color:#444444;">Welcome to GenPaper! You now have an AI research assistant that can write complete papers with real sources and proper citations.</p>
      <p style="margin:0 0 8px 0;font-weight:500;">Here's what you can do:</p>
      <ul style="margin:0 0 16px 0;padding-left:20px;color:#444444;">
        <li style="margin-bottom:6px;">Enter a topic and generate a full paper in minutes</li>
        <li style="margin-bottom:6px;">Search real academic databases for trusted sources</li>
        <li style="margin-bottom:6px;">Get perfect APA, MLA, or Chicago citations</li>
        <li style="margin-bottom:6px;">Export to Word, PDF, or LaTeX</li>
      </ul>
      ${ctaButton('Create Your First Paper', `${base}/projects`)}
      <p style="margin:0;color:#999999;font-size:13px;">Just enter a topic and GenPaper handles the rest.</p>
    `,
  })
}
