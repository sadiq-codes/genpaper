import 'server-only'

import { getServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { info, warn } from '@/lib/utils/logger'
import { getTierLimits, type SubscriptionTier } from '@/types/subscription'

// =============================================================================
// Types
// =============================================================================

export interface UsageCheckResult {
  /** Whether the action is allowed */
  allowed: boolean
  /** Current number of uses today */
  currentUses: number
  /** Daily limit (-1 means unlimited) */
  dailyLimit: number
  /** When the daily limit resets (midnight UTC) */
  resetsAt: Date
  /** Whether the user has unlimited access */
  isUnlimited: boolean
}

export interface DailyUsageStats {
  chat: {
    used: number
    limit: number
    remaining: number
    isUnlimited: boolean
  }
  autocomplete: {
    used: number
    limit: number
    remaining: number
    isUnlimited: boolean
  }
  resetsAt: Date
}

// =============================================================================
// Server-Side Usage Checks (with increment)
// =============================================================================

/**
 * Check if user can use chat and increment counter if allowed.
 * Call this BEFORE processing the chat request.
 */
export async function checkAndIncrementChatUsage(userId: string): Promise<UsageCheckResult> {
  const supabase = getServiceClient()
  
  const limits = await getUserTierLimits(userId)
  const chatLimit = limits?.dailyChatLimit === 'unlimited' ? -1 : (limits?.dailyChatLimit ?? 10)
  
  const { data, error } = await supabase.rpc('check_and_increment_chat_usage', {
    p_user_id: userId,
    p_daily_limit: chatLimit === -1 ? 999999 : chatLimit, // Use high number for unlimited
  })
  
  if (error || !data || data.length === 0) {
    warn({ userId, error }, 'Failed to check chat usage, allowing by default')
    return {
      allowed: true,
      currentUses: 0,
      dailyLimit: chatLimit,
      resetsAt: getNextMidnightUTC(),
      isUnlimited: chatLimit === -1,
    }
  }
  
  const result = data[0]
  const isUnlimited = result.daily_limit === -1
  
  if (!result.allowed) {
    info({ userId, currentUses: result.current_uses, limit: result.daily_limit }, 'Chat daily limit reached')
  }
  
  return {
    allowed: result.allowed,
    currentUses: result.current_uses,
    dailyLimit: result.daily_limit,
    resetsAt: new Date(result.resets_at),
    isUnlimited,
  }
}

/**
 * Check if user can use autocomplete and increment counter if allowed.
 * Call this BEFORE processing the autocomplete request.
 */
export async function checkAndIncrementAutocompleteUsage(userId: string): Promise<UsageCheckResult> {
  const supabase = getServiceClient()
  
  const limits = await getUserTierLimits(userId)
  const autocompleteLimit = limits?.dailyAutocompleteLimit === 'unlimited' ? -1 : (limits?.dailyAutocompleteLimit ?? 10)
  
  const { data, error } = await supabase.rpc('check_and_increment_autocomplete_usage', {
    p_user_id: userId,
    p_daily_limit: autocompleteLimit === -1 ? 999999 : autocompleteLimit,
  })
  
  if (error || !data || data.length === 0) {
    warn({ userId, error }, 'Failed to check autocomplete usage, allowing by default')
    return {
      allowed: true,
      currentUses: 0,
      dailyLimit: autocompleteLimit,
      resetsAt: getNextMidnightUTC(),
      isUnlimited: autocompleteLimit === -1,
    }
  }
  
  const result = data[0]
  const isUnlimited = result.daily_limit === -1
  
  if (!result.allowed) {
    info({ userId, currentUses: result.current_uses, limit: result.daily_limit }, 'Autocomplete daily limit reached')
  }
  
  return {
    allowed: result.allowed,
    currentUses: result.current_uses,
    dailyLimit: result.daily_limit,
    resetsAt: new Date(result.resets_at),
    isUnlimited,
  }
}

// =============================================================================
// Read-Only Usage Stats
// =============================================================================

/**
 * Get current daily usage stats without incrementing.
 * Use this for displaying usage info in the UI.
 */
export async function getDailyUsageStats(userId: string): Promise<DailyUsageStats> {
  const supabase = getServiceClient()
  
  const { data, error } = await supabase.rpc('get_daily_usage_stats', {
    p_user_id: userId,
  })
  
  if (error || !data || data.length === 0) {
    warn({ userId, error }, 'Failed to get daily usage stats')
    // Return default values for free tier
    return {
      chat: { used: 0, limit: 10, remaining: 10, isUnlimited: false },
      autocomplete: { used: 0, limit: 10, remaining: 10, isUnlimited: false },
      resetsAt: getNextMidnightUTC(),
    }
  }
  
  const result = data[0]
  const isUnlimited = result.is_unlimited
  
  return {
    chat: {
      used: result.chat_used,
      limit: result.chat_limit,
      remaining: isUnlimited ? Infinity : Math.max(0, result.chat_limit - result.chat_used),
      isUnlimited,
    },
    autocomplete: {
      used: result.autocomplete_used,
      limit: result.autocomplete_limit,
      remaining: isUnlimited ? Infinity : Math.max(0, result.autocomplete_limit - result.autocomplete_used),
      isUnlimited,
    },
    resetsAt: new Date(result.resets_at),
  }
}

/**
 * Get daily usage stats for the current authenticated user.
 */
export async function getCurrentUserDailyUsage(): Promise<DailyUsageStats | null> {
  const supabase = await createClient()
  
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return null
  }
  
  return getDailyUsageStats(user.id)
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get tier limits for a user
 */
async function getUserTierLimits(userId: string) {
  const supabase = getServiceClient()
  
  const { data, error } = await supabase
    .from('profiles')
    .select('subscription_tier')
    .eq('id', userId)
    .single()
  
  if (error || !data) {
    return null
  }
  
  return getTierLimits(data.subscription_tier as SubscriptionTier)
}

/**
 * Get the next midnight UTC timestamp
 */
function getNextMidnightUTC(): Date {
  const now = new Date()
  const tomorrow = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ))
  return tomorrow
}

/**
 * Format remaining time until reset in human-readable form
 */
export function formatTimeUntilReset(resetsAt: Date): string {
  const now = new Date()
  const diffMs = resetsAt.getTime() - now.getTime()
  
  if (diffMs <= 0) return 'now'
  
  const hours = Math.floor(diffMs / (1000 * 60 * 60))
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}
