import 'server-only'

import { getUserSubscription, incrementPaperUsage } from './subscription-service'
import { 
  getTierLimits,
  isPaperTypeAllowed,
  getPapersRemaining,
  getTierRequiredForPaperType,
  TIER_CONFIG,
} from '@/types/subscription'
import type { SubscriptionTier, UserSubscription } from '@/types/subscription'
import type { PaperTypeKey } from '@/types/simplified'
import { createServiceClient } from '@/lib/supabase/service'
import { warn } from '@/lib/utils/logger'

// =============================================================================
// Gate Check Results
// =============================================================================

export interface GateCheckResult {
  allowed: boolean
  reason?: string
  requiredTier?: SubscriptionTier
  currentTier?: SubscriptionTier
  papersRemaining?: number
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

function startOfUtcMonth(base: Date): Date {
  return new Date(Date.UTC(
    base.getUTCFullYear(),
    base.getUTCMonth(),
    1,
    0,
    0,
    0,
    0
  ))
}

function resolveUsageWindow(subscription: UserSubscription): { start: Date; end: Date } {
  const now = new Date()
  const monthStart = startOfUtcMonth(now)

  const parsedStart = subscription.periodStartedAt ? new Date(subscription.periodStartedAt) : null
  const parsedEnd = subscription.periodEndsAt ? new Date(subscription.periodEndsAt) : null

  const hasValidStart = Boolean(parsedStart && !Number.isNaN(parsedStart.getTime()))
  const hasValidEnd = Boolean(parsedEnd && !Number.isNaN(parsedEnd.getTime()))

  // Free-tier fallback should always remain calendar-month based.
  if (subscription.tier === 'free' && (!hasValidStart || !hasValidEnd)) {
    const start = monthStart
    const end = addUtcMonths(start, 1)
    return { start, end }
  }

  const start = hasValidStart ? (parsedStart as Date) : monthStart
  let end = hasValidEnd ? (parsedEnd as Date) : addUtcMonths(start, 1)
  if (end <= start) {
    end = addUtcMonths(start, 1)
  }
  return { start, end }
}

async function getAuthoritativePapersUsedThisPeriod(
  userId: string,
  subscription: UserSubscription
): Promise<number> {
  const supabase = createServiceClient()
  const { start, end } = resolveUsageWindow(subscription)

  const { count, error } = await supabase
    .from('research_projects')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'complete')
    .not('completed_at', 'is', null)
    .gte('completed_at', start.toISOString())
    .lt('completed_at', end.toISOString())

  if (error) {
    warn({ userId, error }, 'Failed to compute authoritative paper usage; falling back to profile counter')
    return subscription.papersUsedThisPeriod
  }

  const authoritativeUsed = count ?? 0
  const effectiveUsed = Math.max(authoritativeUsed, subscription.papersUsedThisPeriod)

  // Self-heal stale counters so UI and gate checks stay aligned.
  if (effectiveUsed !== subscription.papersUsedThisPeriod) {
    const { error: syncError } = await supabase
      .from('profiles')
      .update({
        papers_used_this_period: effectiveUsed,
        period_started_at: start.toISOString(),
        period_ends_at: end.toISOString(),
      })
      .eq('id', userId)

    if (syncError) {
      warn({ userId, error: syncError }, 'Failed to sync profile usage counter from authoritative project count')
    }
  }

  return effectiveUsed
}

// =============================================================================
// Paper Generation Gates
// =============================================================================

/**
 * Check if user can generate a paper (has papers remaining in their quota)
 */
export async function checkCanGeneratePaper(userId: string): Promise<GateCheckResult> {
  const subscription = await getUserSubscription(userId)
  
  if (!subscription) {
    warn({ userId }, 'No subscription found for user')
    return {
      allowed: false,
      reason: 'Unable to verify subscription status',
    }
  }
  
  const { tier, status } = subscription
  
  // Check subscription status
  if (status !== 'active' && status !== 'trialing') {
    return {
      allowed: false,
      reason: 'Your subscription is not active',
      currentTier: tier,
    }
  }
  
  const papersUsedThisPeriod = await getAuthoritativePapersUsedThisPeriod(userId, subscription)

  // Check paper limit
  const papersRemaining = getPapersRemaining(tier, papersUsedThisPeriod)
  
  if (papersRemaining <= 0) {
    const limit = TIER_CONFIG[tier].limits.papersPerMonth
    return {
      allowed: false,
      reason: `You've reached your limit of ${limit} paper${limit === 1 ? '' : 's'} this month`,
      currentTier: tier,
      papersRemaining: 0,
      requiredTier: tier === 'free' ? 'starter' : tier === 'starter' ? 'pro' : undefined,
    }
  }
  
  return {
    allowed: true,
    currentTier: tier,
    papersRemaining,
  }
}

/**
 * Check if user can use a specific paper type
 */
export async function checkCanUsePaperType(
  userId: string, 
  paperType: PaperTypeKey
): Promise<GateCheckResult> {
  const subscription = await getUserSubscription(userId)
  
  if (!subscription) {
    return {
      allowed: false,
      reason: 'Unable to verify subscription status',
    }
  }
  
  const { tier } = subscription
  
  if (!isPaperTypeAllowed(tier, paperType)) {
    const requiredTier = getTierRequiredForPaperType(paperType)
    return {
      allowed: false,
      reason: `${paperType} requires ${TIER_CONFIG[requiredTier].name} plan`,
      currentTier: tier,
      requiredTier,
    }
  }
  
  return {
    allowed: true,
    currentTier: tier,
  }
}

/**
 * Check if user can use editor AI chat
 */
export async function checkCanUseEditorChat(userId: string): Promise<GateCheckResult> {
  const subscription = await getUserSubscription(userId)
  
  if (!subscription) {
    return {
      allowed: false,
      reason: 'Unable to verify subscription status',
    }
  }
  
  const { tier } = subscription
  const limits = getTierLimits(tier)
  
  if (!limits.editorChatEnabled) {
    return {
      allowed: false,
      reason: 'AI editor chat requires Starter plan or above',
      currentTier: tier,
      requiredTier: 'starter',
    }
  }
  
  return {
    allowed: true,
    currentTier: tier,
  }
}

/**
 * Check if user can export to PDF
 */
export async function checkCanExportPdf(userId: string): Promise<GateCheckResult> {
  const subscription = await getUserSubscription(userId)
  
  if (!subscription) {
    return {
      allowed: false,
      reason: 'Unable to verify subscription status',
    }
  }
  
  const { tier } = subscription
  const limits = getTierLimits(tier)
  
  if (!limits.pdfExport) {
    return {
      allowed: false,
      reason: 'PDF export requires Starter plan or above',
      currentTier: tier,
      requiredTier: 'starter',
    }
  }
  
  return {
    allowed: true,
    currentTier: tier,
  }
}

// =============================================================================
// Combined Pre-Generation Check
// =============================================================================

/**
 * Comprehensive check before starting paper generation
 * Validates quota and paper type in one call
 */
export async function checkCanStartGeneration(
  userId: string,
  paperType: PaperTypeKey,
): Promise<GateCheckResult> {
  // Check paper quota first
  const quotaCheck = await checkCanGeneratePaper(userId)
  if (!quotaCheck.allowed) {
    return quotaCheck
  }
  
  // Check paper type
  const typeCheck = await checkCanUsePaperType(userId, paperType)
  if (!typeCheck.allowed) {
    return typeCheck
  }
  
  return {
    allowed: true,
    currentTier: quotaCheck.currentTier,
    papersRemaining: quotaCheck.papersRemaining,
  }
}

// =============================================================================
// Usage Tracking
// =============================================================================

/**
 * Record that a paper was generated (increments usage counter)
 * Call this after successful paper generation
 * @deprecated Use recordProjectGenerated instead for accurate billing
 */
export async function recordPaperGenerated(userId: string): Promise<boolean> {
  return incrementPaperUsage(userId)
}

/**
 * Mark a project as generated and increment billing counter
 * This is the correct way to track billing - it uses the project's has_generated flag
 * to ensure we only count the first successful generation.
 * 
 * @returns true if this was the first generation (billing incremented)
 * @returns false if already generated or project not found
 */
export async function recordProjectGenerated(projectId: string, userId: string): Promise<boolean> {
  const { info, warn: logWarn, error: logError } = await import('@/lib/utils/logger')
  
  const supabase = createServiceClient()

  // Atomic compare-and-set: only the first successful generation of a project
  // can flip has_generated from false -> true and trigger billing increment.
  const { data: markedRows, error: markError } = await supabase
    .from('research_projects')
    .update({ has_generated: true })
    .eq('id', projectId)
    .eq('user_id', userId)
    .eq('has_generated', false)
    .select('id')
    .limit(1)

  if (markError) {
    logError({ projectId, userId, error: markError }, 'Failed to atomically mark project as generated')
    return false
  }

  const wasFirstGeneration = Array.isArray(markedRows) && markedRows.length > 0
  if (!wasFirstGeneration) {
    info({ projectId, userId }, 'Project was already generated, no billing change')
    return false
  }

  const incremented = await incrementPaperUsage(userId)
  if (!incremented) {
    // Increment can fail if DB-side usage function is unavailable; generation gate
    // remains protected by authoritative project-count checks.
    logWarn({ projectId, userId }, 'Project marked generated but usage counter increment failed')
    return false
  }

  info({ projectId, userId }, 'Project marked as generated, billing incremented')
  return true
}

// =============================================================================
// Client-Safe Helpers (can be used in API routes that return to client)
// =============================================================================

/**
 * Get subscription info with computed fields for display
 */
export async function getSubscriptionForDisplay(userId: string): Promise<{
  tier: SubscriptionTier
  tierName: string
  papersUsed: number
  papersLimit: number
  papersRemaining: number
  periodEndsAt: string | null
  features: string[]
} | null> {
  const subscription = await getUserSubscription(userId)
  
  if (!subscription) {
    return null
  }

  const papersUsedThisPeriod = await getAuthoritativePapersUsedThisPeriod(userId, subscription)
  
  const tierConfig = TIER_CONFIG[subscription.tier]
  const papersRemaining = getPapersRemaining(subscription.tier, papersUsedThisPeriod)
  
  return {
    tier: subscription.tier,
    tierName: tierConfig.name,
    papersUsed: papersUsedThisPeriod,
    papersLimit: tierConfig.limits.papersPerMonth,
    papersRemaining,
    periodEndsAt: subscription.periodEndsAt,
    features: tierConfig.features,
  }
}
