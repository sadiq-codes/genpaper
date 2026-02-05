import 'server-only'

import { getUserSubscription, incrementPaperUsage } from './subscription-service'
import { 
  getTierLimits,
  isPaperTypeAllowed,
  isPaperLengthAllowed,
  canGeneratePaper as canGeneratePaperByLimit,
  getPapersRemaining,
  getTierRequiredForPaperType,
  getTierRequiredForPaperLength,
  TIER_CONFIG,
} from '@/types/subscription'
import type { SubscriptionTier, UserSubscription } from '@/types/subscription'
import type { PaperTypeKey } from '@/types/simplified'
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
  
  const { tier, papersUsedThisPeriod, status } = subscription
  
  // Check subscription status
  if (status !== 'active' && status !== 'trialing') {
    return {
      allowed: false,
      reason: 'Your subscription is not active',
      currentTier: tier,
    }
  }
  
  // Check paper limit
  const papersRemaining = getPapersRemaining(tier, papersUsedThisPeriod)
  
  if (!canGeneratePaperByLimit(tier, papersUsedThisPeriod)) {
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
 * Check if user can use a specific paper length
 */
export async function checkCanUsePaperLength(
  userId: string, 
  length: 'short' | 'medium' | 'long'
): Promise<GateCheckResult> {
  const subscription = await getUserSubscription(userId)
  
  if (!subscription) {
    return {
      allowed: false,
      reason: 'Unable to verify subscription status',
    }
  }
  
  const { tier } = subscription
  
  if (!isPaperLengthAllowed(tier, length)) {
    const requiredTier = getTierRequiredForPaperLength(length)
    return {
      allowed: false,
      reason: `${length} papers require ${TIER_CONFIG[requiredTier].name} plan`,
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
 * Validates quota, paper type, and length in one call
 */
export async function checkCanStartGeneration(
  userId: string,
  paperType: PaperTypeKey,
  length: 'short' | 'medium' | 'long'
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
  
  // Check length
  const lengthCheck = await checkCanUsePaperLength(userId, length)
  if (!lengthCheck.allowed) {
    return lengthCheck
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
 */
export async function recordPaperGenerated(userId: string): Promise<boolean> {
  return incrementPaperUsage(userId)
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
  
  const tierConfig = TIER_CONFIG[subscription.tier]
  const papersRemaining = getPapersRemaining(subscription.tier, subscription.papersUsedThisPeriod)
  
  return {
    tier: subscription.tier,
    tierName: tierConfig.name,
    papersUsed: subscription.papersUsedThisPeriod,
    papersLimit: tierConfig.limits.papersPerMonth,
    papersRemaining,
    periodEndsAt: subscription.periodEndsAt,
    features: tierConfig.features,
  }
}
