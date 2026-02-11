import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  checkAndIncrementAutocompleteUsage,
  formatTimeUntilReset,
} from '@/lib/billing/usage-limits'

export async function POST(_request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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
    console.error('Autocomplete accept usage error:', error)
    return NextResponse.json({ error: 'Failed to record autocomplete accept' }, { status: 500 })
  }
}
