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

function getAppUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL
  if (!url && process.env.NODE_ENV === 'production') {
    throw new Error('NEXT_PUBLIC_APP_URL is required in production')
  }
  return url || 'http://localhost:3000'
}

function getPolarAccessToken(): string {
  const token = process.env.POLAR_ACCESS_TOKEN
  if (!token) {
    throw new Error('POLAR_ACCESS_TOKEN is required for billing')
  }
  return token
}

export const GET = Checkout({
  accessToken: getPolarAccessToken(),
  // Note: Query params must come before hash fragment for proper parsing
  successUrl: `${getAppUrl()}/settings?checkout=success#billing`,
  server: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox',
})
