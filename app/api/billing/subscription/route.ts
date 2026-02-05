import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSubscriptionForDisplay } from '@/lib/billing/gates'

/**
 * GET /api/billing/subscription
 * 
 * Returns the current user's subscription info for display in the UI.
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    
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
    console.error('Failed to fetch subscription:', error)
    return NextResponse.json(
      { error: 'Failed to fetch subscription' },
      { status: 500 }
    )
  }
}
