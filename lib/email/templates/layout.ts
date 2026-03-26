import { buildUnsubscribeUrl, getBaseUrl } from '@/lib/email/service'

const BASE_URL = getBaseUrl()

export function emailLayout(opts: {
  body: string
  userId?: string
  showUnsubscribe?: boolean
}): string {
  const unsubLink = opts.userId && opts.showUnsubscribe !== false
    ? `<p style="margin:0;"><a href="${buildUnsubscribeUrl(opts.userId)}" style="color:#999999;text-decoration:underline;">Unsubscribe</a></p>`
    : ''

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#1a1a1a;max-width:480px;margin:0 auto;padding:40px 20px;background-color:#fafafa;">
  <div style="background:#ffffff;border-radius:8px;border:1px solid #e5e5e5;padding:40px;">
    <div style="text-align:center;margin-bottom:32px;">
      <a href="${BASE_URL}" style="text-decoration:none;color:#1a1a1a;">
        <h1 style="font-size:20px;font-weight:600;margin:0;letter-spacing:-0.02em;">GenPaper</h1>
      </a>
    </div>
    ${opts.body}
  </div>
  <div style="text-align:center;margin-top:24px;font-size:12px;color:#999999;">
    <p style="margin:0 0 4px 0;"><a href="${BASE_URL}" style="color:#999999;text-decoration:none;">genpaper.ai</a></p>
    ${unsubLink}
  </div>
</body>
</html>`
}

export function ctaButton(text: string, href: string): string {
  return `<div style="text-align:center;margin:32px 0;">
  <a href="${href}" style="display:inline-block;background:#1a1a1a;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500;">${text}</a>
</div>`
}
