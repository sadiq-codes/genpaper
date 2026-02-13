/**
 * Blog Notification Service
 * 
 * Sends email notifications when new blog drafts are created
 */

import { Resend } from 'resend'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://genpaper.ai'

let resend: Resend | null = null

function getResend(): Resend | null {
  if (resend) return resend
  
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[Blog Notifications] RESEND_API_KEY not configured')
    return null
  }
  
  resend = new Resend(apiKey)
  return resend
}

/**
 * Send notification when a new draft post is created
 */
export async function sendDraftNotification(post: {
  title: string
  slug: string
  description: string
}): Promise<boolean> {
  const adminEmail = process.env.CONTACT_EMAIL || process.env.ADMIN_EMAIL
  
  if (!adminEmail) {
    console.warn('[Blog Notifications] No admin email configured (CONTACT_EMAIL or ADMIN_EMAIL)')
    return false
  }
  
  const client = getResend()
  
  if (!client) {
    // Log for debugging when Resend is not configured
    console.log(`[Blog Notifications] New draft post (email not sent - Resend not configured):
    Title: ${post.title}
    Slug: ${post.slug}
    Review URL: ${BASE_URL}/admin/blog/${post.slug}`)
    return false
  }
  
  try {
    const { error } = await client.emails.send({
      from: 'GenPaper <noreply@genpaper.ai>',
      to: adminEmail,
      subject: `New blog draft: ${post.title}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 480px; margin: 0 auto; padding: 40px 20px; background-color: #fafafa;">
            <div style="background: #ffffff; border-radius: 8px; border: 1px solid #e5e5e5; padding: 40px;">
              <div style="text-align: center; margin-bottom: 32px;">
                <h1 style="font-size: 20px; font-weight: 600; margin: 0; letter-spacing: -0.02em;">GenPaper</h1>
              </div>
              
              <p style="margin: 0 0 16px 0; color: #1a1a1a;">New blog draft created</p>
              
              <p style="margin: 0 0 24px 0; color: #666666;">Your AI agent has created a new blog post draft for review.</p>
              
              <div style="background: #fafafa; padding: 16px; border-radius: 6px; border: 1px solid #e5e5e5; margin: 24px 0;">
                <p style="margin: 0 0 4px 0; font-weight: 500; color: #1a1a1a;">${post.title}</p>
                <p style="margin: 0; color: #666666; font-size: 14px;">${post.description}</p>
              </div>
              
              <div style="text-align: center; margin: 32px 0;">
                <a href="${BASE_URL}/admin/blog/${post.slug}" style="display: inline-block; background: #1a1a1a; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500;">Review & publish</a>
              </div>
              
              <p style="margin: 24px 0 0 0; color: #999999; font-size: 13px;">This draft won't be visible until you publish it.</p>
            </div>
            
            <p style="color: #999999; font-size: 12px; text-align: center; margin-top: 24px;">
              <a href="https://genpaper.ai" style="color: #999999; text-decoration: none;">genpaper.ai</a>
            </p>
          </body>
        </html>
      `,
    })
    
    if (error) {
      console.error('[Blog Notifications] Failed to send email:', error)
      return false
    }
    
    console.log(`[Blog Notifications] Draft notification sent to ${adminEmail}`)
    return true
    
  } catch (err) {
    console.error('[Blog Notifications] Error sending email:', err)
    return false
  }
}
