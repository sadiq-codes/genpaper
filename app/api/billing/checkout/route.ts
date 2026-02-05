import { Checkout } from '@polar-sh/nextjs'

/**
 * Polar Checkout Route
 * 
 * Redirects users to Polar's hosted checkout page.
 * 
 * Query params:
 * - products: Product ID (required) - e.g., ?products=xxx
 * - customerEmail: Pre-fill email (optional)
 * - customerExternalId: Link to our user ID (optional)
 * 
 * Example: /api/billing/checkout?products=xxx&customerEmail=user@example.com
 */

const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export const GET = Checkout({
  accessToken: process.env.POLAR_ACCESS_TOKEN!,
  successUrl: `${appUrl}/settings#billing?checkout=success`,
  server: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox',
})
