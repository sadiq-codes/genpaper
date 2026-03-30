import { NextResponse } from 'next/server'
import { getSubscriptionForDisplay } from '@/lib/billing/gates'
import { handleError, requireAuth } from '@/lib/api/helpers'

/**
 * GET /api/billing/subscription
 * 
 * Returns the current user's subscription info for display in the UI.
 */
export async function GET() {
  try {
    const user = await requireAuth()
    
    const subscription = await getSubscriptionForDisplay(user.id)
    
    if (!subscription) {
      // Return default free tier if no subscription found
      return NextResponse.json({
        tier: 'free',
        tierName: 'Free',
        papersUsed: 0,
        papersLimit: 1,
        papersRemaining: 1,
        periodEndsAt: null,
        features: ['1 literature review per month', 'Short papers only'],
      })
    }
    
    return NextResponse.json(subscription)
    
  } catch (error) {
    return handleError(error, 'Failed to fetch subscription')
  }
}
