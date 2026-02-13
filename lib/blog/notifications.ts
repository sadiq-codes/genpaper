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
    // Use Resend's default domain until genpaper.ai is verified
    // To verify: go to https://resend.com/domains and add genpaper.ai
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'GenPaper <onboarding@resend.dev>'
    
    const { error } = await client.emails.send({
      from: fromEmail,
      to: adminEmail,
      subject: `[GenPaper] New blog draft: ${post.title}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 24px;">New Blog Draft</h1>
            </div>
            
            <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
              <p style="margin-top: 0;">A new blog post draft has been created by your AI agent:</p>
              
              <div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #e5e7eb; margin: 20px 0;">
                <h2 style="margin: 0 0 10px 0; font-size: 18px;">${post.title}</h2>
                <p style="color: #6b7280; margin: 0;">${post.description}</p>
              </div>
              
              <a href="${BASE_URL}/admin/blog/${post.slug}" 
                 style="display: inline-block; background: #4f46e5; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">
                Review & Publish
              </a>
              
              <p style="color: #6b7280; font-size: 14px; margin-top: 20px;">
                This post is saved as a draft and won't be visible on your blog until you publish it.
              </p>
            </div>
            
            <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 20px;">
              Sent from GenPaper Blog System
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
