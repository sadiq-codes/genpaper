/**
 * Subscription Types and Configuration
 * 
 * Defines subscription tiers, limits, and feature gating for GenPaper.
 * Integrated with Polar.sh for payment processing.
 */

import type { PaperTypeKey } from './simplified'

// =============================================================================
// Core Types
// =============================================================================

export type SubscriptionTier = 'free' | 'starter' | 'pro'

export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing'

export type BillingInterval = 'monthly' | 'yearly'

export interface UserSubscription {
  tier: SubscriptionTier
  status: SubscriptionStatus
  polarCustomerId: string | null
  polarSubscriptionId: string | null
  papersUsedThisPeriod: number
  periodStartedAt: string | null
  periodEndsAt: string | null
}

// =============================================================================
// Tier Configuration
// =============================================================================

export interface TierLimits {
  /** Maximum papers per billing period */
  papersPerMonth: number
  
  /** Paper types available on this tier */
  allowedPaperTypes: PaperTypeKey[] | 'all'
  
  /** Number of references visible (rest blurred), or 'all' */
  referencesVisible: number | 'all'
  
  /** Whether AI editor chat is enabled */
  editorChatEnabled: boolean
  
  /** Whether PDF export is available */
  pdfExport: boolean
  
  /** Whether user gets priority generation queue */
  priorityGeneration: boolean
  
  /** Daily chat messages limit, or 'unlimited' for paid tiers */
  dailyChatLimit: number | 'unlimited'
  
  /** Daily autocomplete requests limit, or 'unlimited' for paid tiers */
  dailyAutocompleteLimit: number | 'unlimited'
}

export interface TierInfo {
  name: string
  description: string
  price: number // Monthly price in USD, 0 for free
  yearlyPrice: number // Yearly price in USD, 0 for free
  limits: TierLimits
  features: string[] // Marketing feature list
}

/**
 * Complete tier configuration
 * Single source of truth for all tier-related logic
 */
export const TIER_CONFIG: Record<SubscriptionTier, TierInfo> = {
  free: {
    name: 'Free',
    description: 'Try GenPaper with limited features',
    price: 0,
    yearlyPrice: 0,
    limits: {
      papersPerMonth: 1,
      allowedPaperTypes: ['literatureReview'],
      referencesVisible: 1,
      editorChatEnabled: true, // Enabled with daily limits
      pdfExport: false,
      priorityGeneration: false,
      dailyChatLimit: 10,
      dailyAutocompleteLimit: 10,
    },
    features: [
      '1 literature review per month',
      'Preview of references (1 visible)',
      'Basic generation',
      '10 AI chat messages per day',
      '10 autocompletes per day',
    ],
  },
  
  starter: {
    name: 'Starter',
    description: 'For students and casual users',
    price: 19,
    yearlyPrice: 156, // $13/mo effective (33% off, 4 months free)
    limits: {
      papersPerMonth: 5,
      allowedPaperTypes: ['literatureReview', 'researchArticle', 'capstoneProject'],
      referencesVisible: 'all',
      editorChatEnabled: true,
      pdfExport: true,
      priorityGeneration: false,
      dailyChatLimit: 'unlimited',
      dailyAutocompleteLimit: 'unlimited',
    },
    features: [
      '5 papers per month',
      'Literature reviews, research articles & capstones',
      'Full references visible',
      'Unlimited autocomplete',
      'Unlimited AI editor chat',
      'PDF export',
    ],
  },
  
  pro: {
    name: 'Pro',
    description: 'For researchers and professionals',
    price: 49,
    yearlyPrice: 396, // $33/mo effective (33% off, 4 months free)
    limits: {
      papersPerMonth: 15,
      allowedPaperTypes: 'all',
      referencesVisible: 'all',
      editorChatEnabled: true,
      pdfExport: true,
      priorityGeneration: true,
      dailyChatLimit: 'unlimited',
      dailyAutocompleteLimit: 'unlimited',
    },
    features: [
      '15 papers per month',
      'All paper types including theses',
      'Full references visible',
      'Unlimited autocomplete',
      'Unlimited AI editor chat',
      'PDF export',
      'Priority generation queue',
    ],
  },
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get limits for a specific tier
 */
export function getTierLimits(tier: SubscriptionTier): TierLimits {
  return TIER_CONFIG[tier].limits
}

/**
 * Check if a paper type is allowed for a tier
 */
export function isPaperTypeAllowed(tier: SubscriptionTier, paperType: PaperTypeKey): boolean {
  const { allowedPaperTypes } = TIER_CONFIG[tier].limits
  if (allowedPaperTypes === 'all') return true
  return allowedPaperTypes.includes(paperType)
}

/**
 * Get the number of papers remaining for a user
 */
export function getPapersRemaining(tier: SubscriptionTier, used: number): number {
  const limit = TIER_CONFIG[tier].limits.papersPerMonth
  return Math.max(0, limit - used)
}

/**
 * Check if user can generate another paper
 */
export function canGeneratePaper(tier: SubscriptionTier, used: number): boolean {
  return getPapersRemaining(tier, used) > 0
}

/**
 * Get visible references count for a tier
 */
export function getVisibleReferencesCount(tier: SubscriptionTier): number | 'all' {
  return TIER_CONFIG[tier].limits.referencesVisible
}

/**
 * Get the tier needed to unlock a specific paper type
 */
export function getTierRequiredForPaperType(paperType: PaperTypeKey): SubscriptionTier {
  if (isPaperTypeAllowed('free', paperType)) return 'free'
  if (isPaperTypeAllowed('starter', paperType)) return 'starter'
  return 'pro'
}

// =============================================================================
// Subscription Events (for audit trail)
// =============================================================================

export type SubscriptionEventType = 
  | 'subscription_created'
  | 'subscription_activated'
  | 'subscription_canceled'
  | 'subscription_revoked'
  | 'subscription_renewed'
  | 'tier_upgraded'
  | 'tier_downgraded'
  | 'payment_succeeded'
  | 'payment_failed'
  | 'paper_generated'

export interface SubscriptionEvent {
  id: string
  userId: string
  eventType: SubscriptionEventType
  tier: SubscriptionTier | null
  polarSubscriptionId: string | null
  polarEventId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}
