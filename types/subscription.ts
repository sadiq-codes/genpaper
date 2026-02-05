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
  
  /** Maximum paper length */
  maxPaperLength: 'short' | 'medium' | 'long'
  
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
    limits: {
      papersPerMonth: 1,
      allowedPaperTypes: ['literatureReview'],
      maxPaperLength: 'short',
      referencesVisible: 3,
      editorChatEnabled: true, // Enabled with daily limits
      pdfExport: false,
      priorityGeneration: false,
      dailyChatLimit: 10,
      dailyAutocompleteLimit: 10,
    },
    features: [
      '1 literature review per month',
      'Short papers only',
      'Preview of references (3 visible)',
      'Basic generation',
      '10 AI chat messages per day',
      '10 autocompletes per day',
    ],
  },
  
  starter: {
    name: 'Starter',
    description: 'For students and casual users',
    price: 15,
    limits: {
      papersPerMonth: 5,
      allowedPaperTypes: ['literatureReview', 'researchArticle', 'capstoneProject'],
      maxPaperLength: 'medium',
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
      'Short & medium length papers',
      'Full references visible',
      'Unlimited AI editor chat',
      'Unlimited autocomplete',
      'PDF export',
    ],
  },
  
  pro: {
    name: 'Pro',
    description: 'For researchers and professionals',
    price: 39,
    limits: {
      papersPerMonth: 15,
      allowedPaperTypes: 'all',
      maxPaperLength: 'long',
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
      'All paper lengths',
      'Full references visible',
      'Unlimited AI editor chat',
      'Unlimited autocomplete',
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
 * Check if a paper length is allowed for a tier
 */
export function isPaperLengthAllowed(
  tier: SubscriptionTier, 
  length: 'short' | 'medium' | 'long'
): boolean {
  const maxLength = TIER_CONFIG[tier].limits.maxPaperLength
  const lengthOrder = { short: 1, medium: 2, long: 3 }
  return lengthOrder[length] <= lengthOrder[maxLength]
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

/**
 * Get the tier needed to unlock a specific paper length
 */
export function getTierRequiredForPaperLength(length: 'short' | 'medium' | 'long'): SubscriptionTier {
  if (isPaperLengthAllowed('free', length)) return 'free'
  if (isPaperLengthAllowed('starter', length)) return 'starter'
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
