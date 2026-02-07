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
      period_ends_at
    `)
    .eq('id', userId)
    .single()
  
  if (error || !data) {
    warn({ userId, error }, 'Failed to fetch user subscription')
    return null
  }
  
  return {
    tier: data.subscription_tier as SubscriptionTier,
    status: data.subscription_status as SubscriptionStatus,
    polarCustomerId: data.polar_customer_id,
    polarSubscriptionId: data.polar_subscription_id,
    papersUsedThisPeriod: data.papers_used_this_period,
    periodStartedAt: data.period_started_at,
    periodEndsAt: data.period_ends_at,
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
