import { NextRequest, NextResponse } from 'next/server'
import { handleError, requireAuth } from '@/lib/api/helpers'
import {
  checkAndIncrementAutocompleteUsage,
  formatTimeUntilReset,
} from '@/lib/billing/usage-limits'

export async function POST(_request: NextRequest) {
  try {
    const user = await requireAuth()

    const usageCheck = await checkAndIncrementAutocompleteUsage(user.id)
    if (!usageCheck.allowed) {
      const timeUntilReset = formatTimeUntilReset(usageCheck.resetsAt)
      return NextResponse.json(
        {
          error: 'Daily autocomplete limit reached',
          code: 'AUTOCOMPLETE_LIMIT_REACHED',
          message: `You've used all ${usageCheck.dailyLimit} daily autocomplete accepts. Upgrade to a paid plan for unlimited autocomplete, or wait ${timeUntilReset} for your limit to reset.`,
          usage: {
            current: usageCheck.currentUses,
            limit: usageCheck.dailyLimit,
            resetsAt: usageCheck.resetsAt.toISOString(),
          },
        },
        { status: 429 }
      )
    }

    return NextResponse.json({
      ok: true,
      usage: {
        current: usageCheck.currentUses,
        limit: usageCheck.dailyLimit,
        resetsAt: usageCheck.resetsAt.toISOString(),
      },
    })
  } catch (error) {
    return handleError(error, 'Autocomplete accept usage error')
  }
}
