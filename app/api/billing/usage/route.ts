import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getDailyUsageStats } from '@/lib/billing/usage-limits'

/**
 * GET /api/billing/usage
 * 
 * Returns the current user's daily usage stats for chat and autocomplete.
 * Used by the client to display remaining uses and upgrade prompts.
 */
export async function GET() {
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const stats = await getDailyUsageStats(user.id)
    
    return NextResponse.json({
      chat: {
        used: stats.chat.used,
        limit: stats.chat.limit,
        remaining: stats.chat.isUnlimited ? 'unlimited' : stats.chat.remaining,
        isUnlimited: stats.chat.isUnlimited,
      },
      autocomplete: {
        used: stats.autocomplete.used,
        limit: stats.autocomplete.limit,
        remaining: stats.autocomplete.isUnlimited ? 'unlimited' : stats.autocomplete.remaining,
        isUnlimited: stats.autocomplete.isUnlimited,
      },
      resetsAt: stats.resetsAt.toISOString(),
    })
  } catch (error) {
    console.error('Failed to get usage stats:', error)
    return NextResponse.json(
      { error: 'Failed to get usage stats' },
      { status: 500 }
    )
  }
}
