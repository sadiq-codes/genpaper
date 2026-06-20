import 'server-only'

import { getServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import type { 
  SubscriptionTier, 
  SubscriptionStatus, 
  UserSubscription,
  SubscriptionEventType 
} from '@/types/subscription'
import { info, warn, error as logError } from '@/lib/utils/logger'

// =============================================================================
// Types
// =============================================================================

interface UpdateSubscriptionParams {
  userId: string
  tier: SubscriptionTier
  status: SubscriptionStatus
  polarCustomerId?: string
  polarSubscriptionId?: string
  periodEndsAt?: Date
}

interface ProfileSubscriptionRow {
  subscription_tier: string
  subscription_status: string
  polar_customer_id: string | null
  polar_subscription_id: string | null
  papers_used_this_period: number
  period_started_at: string | null
  period_ends_at: string | null
  paper_credits: number
}

interface LogEventParams {
  userId: string
  eventType: SubscriptionEventType
  tier?: SubscriptionTier
  polarSubscriptionId?: string
  polarEventId?: string
  metadata?: Record<string, unknown>
}

// =============================================================================
// Read Operations
// =============================================================================

/**
 * Get subscription info for the current authenticated user
 */
export async function getCurrentUserSubscription(): Promise<UserSubscription | null> {
  const supabase = await createClient()
  
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return null
  }
  
  return getUserSubscription(user.id)
}

/**
 * Get subscription info for a specific user (server-side, bypasses RLS)
 */
export async function getUserSubscription(userId: string): Promise<UserSubscription | null> {
  const supabase = getServiceClient()
  
  const { data, error } = await supabase
    .from('profiles')
    .select(`
      subscription_tier,
      subscription_status,
      polar_customer_id,
      polar_subscription_id,
      papers_used_this_period,
      period_started_at,
      period_ends_at,
      paper_credits
    `)
    .eq('id', userId)
    .single()
  
  if (error || !data) {
    warn({ userId, error }, 'Failed to fetch user subscription')
    return null
  }

  // Root fix: make monthly usage reset self-healing.
  // This keeps counters correct even if webhooks are delayed/missed.
  const row = data as unknown as ProfileSubscriptionRow
  const alignedRow = await alignUsagePeriodIfNeeded(userId, row)
  
  return {
    tier: alignedRow.subscription_tier as SubscriptionTier,
    status: alignedRow.subscription_status as SubscriptionStatus,
    polarCustomerId: alignedRow.polar_customer_id,
    polarSubscriptionId: alignedRow.polar_subscription_id,
    papersUsedThisPeriod: alignedRow.papers_used_this_period,
    periodStartedAt: alignedRow.period_started_at,
    periodEndsAt: alignedRow.period_ends_at,
    purchasedPapers: alignedRow.paper_credits ?? 0,
  }
}

/**
 * Get user ID by Polar customer ID (for webhook handling)
 */
export async function getUserIdByPolarCustomerId(polarCustomerId: string): Promise<string | null> {
  const supabase = getServiceClient()
  
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('polar_customer_id', polarCustomerId)
    .single()
  
  if (error || !data) {
    warn({ polarCustomerId, error }, 'Failed to find user by Polar customer ID')
    return null
  }
  
  return data.id
}

/**
 * Get user by email (for linking Polar customer)
 */
export async function getUserIdByEmail(email: string): Promise<string | null> {
  const supabase = getServiceClient()
  
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single()
  
  if (error || !data) {
    return null
  }
  
  return data.id
}

// =============================================================================
// Write Operations
// =============================================================================

/**
 * Update user subscription (called by webhook handlers)
 */
export async function updateSubscription(params: UpdateSubscriptionParams): Promise<boolean> {
  const supabase = getServiceClient()
  
  const updateData: Record<string, unknown> = {
    subscription_tier: params.tier,
    subscription_status: params.status,
  }
  
  if (params.polarCustomerId !== undefined) {
    updateData.polar_customer_id = params.polarCustomerId
  }
  
  if (params.polarSubscriptionId !== undefined) {
    updateData.polar_subscription_id = params.polarSubscriptionId
  }
  
  if (params.periodEndsAt !== undefined) {
    updateData.period_ends_at = params.periodEndsAt.toISOString()
  }
  
  const { error } = await supabase
    .from('profiles')
    .update(updateData)
    .eq('id', params.userId)
  
  if (error) {
    logError({ userId: params.userId, error, params }, 'Failed to update subscription')
    return false
  }
  
  info({ userId: params.userId, tier: params.tier, status: params.status }, 'Subscription updated')
  return true
}

/**
 * Link a Polar customer ID to a user
 */
export async function linkPolarCustomer(userId: string, polarCustomerId: string): Promise<boolean> {
  const supabase = getServiceClient()
  
  const { error } = await supabase
    .from('profiles')
    .update({ polar_customer_id: polarCustomerId })
    .eq('id', userId)
  
  if (error) {
    logError({ userId, polarCustomerId, error }, 'Failed to link Polar customer')
    return false
  }
  
  info({ userId, polarCustomerId }, 'Polar customer linked')
  return true
}

/**
 * Reset paper usage for a new billing period
 */
export async function resetPaperUsage(userId: string, periodEndsAt: Date): Promise<boolean> {
  const supabase = getServiceClient()
  
  const { error } = await supabase.rpc('reset_paper_usage', {
    p_user_id: userId,
    p_period_ends_at: periodEndsAt.toISOString(),
  })
  
  if (error) {
    logError({ userId, error }, 'Failed to reset paper usage')
    return false
  }
  
  info({ userId, periodEndsAt }, 'Paper usage reset')
  return true
}

/**
 * Ensure usage period boundaries are current and reset counters when a period elapsed.
 * This is authoritative for both free and paid tiers:
 * - free: monthly rolling period (UTC) even without billing webhooks
 * - paid: fallback reset if period has elapsed and webhook was missed
 */
async function alignUsagePeriodIfNeeded(
  userId: string,
  row: ProfileSubscriptionRow
): Promise<ProfileSubscriptionRow> {
  const now = new Date()
  const tier = row.subscription_tier as SubscriptionTier

  const parsedPeriodEnd = row.period_ends_at ? new Date(row.period_ends_at) : null
  const parsedPeriodStart = row.period_started_at ? new Date(row.period_started_at) : null

  let shouldReset = false
  let nextPeriodEnd: Date | null = null

  // Free users don't rely on subscription webhooks; enforce monthly periods here.
  if (tier === 'free') {
    const effectiveStart = parsedPeriodStart || now
    const effectiveEnd = parsedPeriodEnd || addUtcMonths(effectiveStart, 1)
    if (!row.period_started_at || !row.period_ends_at || now >= effectiveEnd) {
      shouldReset = true
      nextPeriodEnd = addUtcMonths(now, 1)
    }
  } else {
    // Paid users should be updated by webhook period ends, but if not, self-heal.
    if (!parsedPeriodEnd || now >= parsedPeriodEnd) {
      shouldReset = true
      nextPeriodEnd = addUtcMonths(now, 1)
    }
  }

  if (!shouldReset || !nextPeriodEnd) {
    return row
  }

  const resetOk = await resetPaperUsage(userId, nextPeriodEnd)
  if (!resetOk) {
    return row
  }

  const supabase = getServiceClient()
  const { data: refreshed } = await supabase
    .from('profiles')
    .select(`
      subscription_tier,
      subscription_status,
      polar_customer_id,
      polar_subscription_id,
      papers_used_this_period,
      period_started_at,
      period_ends_at,
      paper_credits
    `)
    .eq('id', userId)
    .single()

  return (refreshed as ProfileSubscriptionRow) || row
}

/**
 * Increment paper usage count
 * Returns true if increment succeeded, false if limit reached
 */
export async function incrementPaperUsage(userId: string): Promise<boolean> {
  const supabase = getServiceClient()
  
  const { data, error } = await supabase.rpc('increment_paper_usage', {
    p_user_id: userId,
  })
  
  if (error) {
    logError({ userId, error }, 'Failed to increment paper usage')
    return false
  }
  
  const success = data as boolean
  if (!success) {
    info({ userId }, 'Paper usage limit reached')
  }
  
  return success
}

/**
 * Downgrade user to free tier (on subscription end/revoke)
 */
export async function downgradeToFree(userId: string): Promise<boolean> {
  return updateSubscription({
    userId,
    tier: 'free',
    status: 'active',
    polarSubscriptionId: undefined,
    periodEndsAt: undefined,
  })
}

// =============================================================================
// Purchased Papers (Pay-Per-Paper)
// =============================================================================

/**
 * Get the number of purchased papers a user has available
 */
export async function getPurchasedPapers(userId: string): Promise<number> {
  const supabase = getServiceClient()
  
  const { data, error } = await supabase.rpc('get_paper_credits', {
    p_user_id: userId,
  })
  
  if (error) {
    warn({ userId, error }, 'Failed to get purchased papers')
    return 0
  }
  
  return data as number
}

/**
 * Add purchased paper to a user (called after successful $7.99 payment)
 */
export async function addPurchasedPaper(userId: string): Promise<number> {
  const supabase = getServiceClient()
  
  const { data, error } = await supabase.rpc('increment_paper_credits', {
    p_user_id: userId,
    p_amount: 1,
  })
  
  if (error) {
    logError({ userId, error }, 'Failed to add purchased paper')
    return 0
  }
  
  const newTotal = data as number
  info({ userId, newTotal }, 'Purchased paper added')
  
  // Log the event
  await logSubscriptionEvent({
    userId,
    eventType: 'paper_credit_purchased',
    metadata: { newTotal },
  })
  
  return newTotal
}

/**
 * Consume a purchased paper for generation
 * Returns true if successful, false if no papers available
 */
export async function consumePurchasedPaper(userId: string): Promise<boolean> {
  const supabase = getServiceClient()
  
  const { data, error } = await supabase.rpc('use_paper_credit', {
    p_user_id: userId,
  })
  
  if (error) {
    logError({ userId, error }, 'Failed to use purchased paper')
    return false
  }
  
  const success = data as boolean
  
  if (success) {
    info({ userId }, 'Purchased paper used for generation')
    
    // Log the event
    await logSubscriptionEvent({
      userId,
      eventType: 'paper_credit_used',
    })
  } else {
    info({ userId }, 'No purchased papers available')
  }
  
  return success
}

// =============================================================================
// Event Logging
// =============================================================================

/**
 * Log a subscription event for audit trail
 */
export async function logSubscriptionEvent(params: LogEventParams): Promise<void> {
  const supabase = getServiceClient()
  
  const { error } = await supabase
    .from('subscription_events')
    .insert({
      user_id: params.userId,
      event_type: params.eventType,
      tier: params.tier,
      polar_subscription_id: params.polarSubscriptionId,
      polar_event_id: params.polarEventId,
      metadata: params.metadata,
    })
  
  if (error) {
    // Non-fatal - log but don't fail the operation
    warn({ params, error }, 'Failed to log subscription event')
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Determine the tier from a Polar product ID
 * Maps Polar product IDs to our internal tier names
 * Supports both monthly and yearly products
 */
export function getTierFromPolarProduct(productId: string): SubscriptionTier {
  // Monthly products
  const starterProductId = process.env.POLAR_PRODUCT_STARTER
  const proProductId = process.env.POLAR_PRODUCT_PRO
  // Yearly products
  const starterYearlyProductId = process.env.POLAR_PRODUCT_STARTER_YEARLY
  const proYearlyProductId = process.env.POLAR_PRODUCT_PRO_YEARLY
  
  if (productId === proProductId || productId === proYearlyProductId) return 'pro'
  if (productId === starterProductId || productId === starterYearlyProductId) return 'starter'
  
  // Default to starter if unknown product
  warn({ productId }, 'Unknown Polar product ID, defaulting to starter')
  return 'starter'
}

function addUtcMonths(base: Date, months: number): Date {
  return new Date(Date.UTC(
    base.getUTCFullYear(),
    base.getUTCMonth() + months,
    base.getUTCDate(),
    base.getUTCHours(),
    base.getUTCMinutes(),
    base.getUTCSeconds(),
    base.getUTCMilliseconds()
  ))
}
