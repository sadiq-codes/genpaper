import { emailLayout } from './layout'

export function campaignEmail(opts: {
  bodyHtml: string
  userId: string
}): string {
  return emailLayout({
    userId: opts.userId,
    body: opts.bodyHtml,
  })
}
