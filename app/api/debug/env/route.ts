import { NextResponse } from 'next/server'

/**
 * Debug endpoint to check if NEXT_PUBLIC env vars are embedded
 * REMOVE THIS AFTER DEBUGGING
 */
export async function GET() {
  return NextResponse.json({
    // Only show if they're set (not the actual values for security)
    NEXT_PUBLIC_POLAR_PRODUCT_STARTER: process.env.NEXT_PUBLIC_POLAR_PRODUCT_STARTER ? 'SET' : 'NOT_SET',
    NEXT_PUBLIC_POLAR_PRODUCT_PRO: process.env.NEXT_PUBLIC_POLAR_PRODUCT_PRO ? 'SET' : 'NOT_SET',
    NEXT_PUBLIC_POLAR_PRODUCT_STARTER_YEARLY: process.env.NEXT_PUBLIC_POLAR_PRODUCT_STARTER_YEARLY ? 'SET' : 'NOT_SET',
    NEXT_PUBLIC_POLAR_PRODUCT_PRO_YEARLY: process.env.NEXT_PUBLIC_POLAR_PRODUCT_PRO_YEARLY ? 'SET' : 'NOT_SET',
    // Show first 8 chars of each (enough to verify, not enough to expose)
    STARTER_PREFIX: process.env.NEXT_PUBLIC_POLAR_PRODUCT_STARTER?.substring(0, 8) || 'EMPTY',
    PRO_PREFIX: process.env.NEXT_PUBLIC_POLAR_PRODUCT_PRO?.substring(0, 8) || 'EMPTY',
  })
}
