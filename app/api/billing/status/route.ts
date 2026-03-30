import { NextResponse } from 'next/server'
import { getSubscriptionForDisplay } from '@/lib/billing/gates'
import { getDailyUsageStats } from '@/lib/billing/usage-limits'
import { handleError, requireAuth } from '@/lib/api/helpers'

/**
 * GET /api/billing/status
 * 
 * Combined endpoint that returns subscription + daily usage in a single request.
 * Avoids the double auth check + double DB round-trip of calling
 * /api/billing/subscription and /api/billing/usage separately.
 */
export async function GET() {
  try {
    const user = await requireAuth()
    
    // Fetch subscription and daily usage in parallel (single auth check)
    const [subscription, dailyStats] = await Promise.all([
      getSubscriptionForDisplay(user.id),
      getDailyUsageStats(user.id),
    ])
    
    return NextResponse.json({
      subscription: subscription ?? {
        tier: 'free',
        tierName: 'Free',
        papersUsed: 0,
        papersLimit: 1,
        papersRemaining: 1,
        periodEndsAt: null,
        features: ['1 literature review per month', 'Short papers only'],
      },
      dailyUsage: {
        chat: {
          used: dailyStats.chat.used,
          limit: dailyStats.chat.limit,
          remaining: dailyStats.chat.isUnlimited ? 'unlimited' : dailyStats.chat.remaining,
          isUnlimited: dailyStats.chat.isUnlimited,
        },
        autocomplete: {
          used: dailyStats.autocomplete.used,
          limit: dailyStats.autocomplete.limit,
          remaining: dailyStats.autocomplete.isUnlimited ? 'unlimited' : dailyStats.autocomplete.remaining,
          isUnlimited: dailyStats.autocomplete.isUnlimited,
        },
        resetsAt: dailyStats.resetsAt.toISOString(),
      },
    })
    
  } catch (error) {
    return handleError(error, 'Failed to fetch billing status')
  }
}
