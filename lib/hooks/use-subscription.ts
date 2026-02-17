'use client'

import { useState, useEffect, useCallback } from 'react'
import type { SubscriptionTier, BillingInterval } from '@/types/subscription'

// =============================================================================
// Types
// =============================================================================

export interface DailyUsageStats {
  chat: {
    used: number
    limit: number
    remaining: number | 'unlimited'
    isUnlimited: boolean
  }
  autocomplete: {
    used: number
    limit: number
    remaining: number | 'unlimited'
    isUnlimited: boolean
  }
  resetsAt: string
}

export interface SubscriptionData {
  tier: SubscriptionTier
  tierName: string
  papersUsed: number
  papersLimit: number
  papersRemaining: number
  periodEndsAt: string | null
  features: string[]
}

export interface UseSubscriptionResult {
  /** Current subscription data */
  subscription: SubscriptionData | null
  /** Daily usage stats (chat/autocomplete limits) */
  dailyUsage: DailyUsageStats | null
  /** Loading state */
  isLoading: boolean
  /** Error message if fetch failed */
  error: string | null
  /** Refresh subscription data */
  refresh: () => Promise<void>
  /** Refresh daily usage only (faster, for UI updates) */
  refreshUsage: () => Promise<void>
  /** Check if user can generate another paper */
  canGenerate: boolean
  /** Check if user has a paid subscription */
  isPaid: boolean
  /** Check if user can send chat messages */
  canChat: boolean
  /** Check if user can use autocomplete */
  canAutocomplete: boolean
}

interface BillingStatusPayload {
  subscription: SubscriptionData | null
  dailyUsage: DailyUsageStats | null
}

const BILLING_STATUS_TTL_MS = 2 * 60 * 1000
let billingStatusCache: { value: BillingStatusPayload; timestamp: number } | null = null
let billingStatusInFlight: Promise<BillingStatusPayload> | null = null

async function fetchBillingStatus(force = false): Promise<BillingStatusPayload> {
  const now = Date.now()
  if (
    !force &&
    billingStatusCache &&
    now - billingStatusCache.timestamp < BILLING_STATUS_TTL_MS
  ) {
    return billingStatusCache.value
  }

  if (!force && billingStatusInFlight) {
    return billingStatusInFlight
  }

  const request = (async (): Promise<BillingStatusPayload> => {
    const response = await fetch('/api/billing/status')

    if (!response.ok) {
      if (response.status === 401) {
        return { subscription: null, dailyUsage: null }
      }
      throw new Error('Failed to fetch subscription')
    }

    const data = await response.json()
    return {
      subscription: data.subscription ?? null,
      dailyUsage: data.dailyUsage ?? null,
    }
  })()

  billingStatusInFlight = request
  try {
    const value = await request
    billingStatusCache = { value, timestamp: Date.now() }
    return value
  } finally {
    if (billingStatusInFlight === request) {
      billingStatusInFlight = null
    }
  }
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to access current user's subscription status
 * 
 * @example
 * const { subscription, canGenerate, isPaid } = useSubscription()
 * 
 * if (!canGenerate) {
 *   return <UpgradePrompt />
 * }
 */
export function useSubscription(): UseSubscriptionResult {
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null)
  const [dailyUsage, setDailyUsage] = useState<DailyUsageStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  const fetchUsage = useCallback(async () => {
    try {
      const response = await fetch('/api/billing/usage')
      if (response.ok) {
        const data = await response.json()
        setDailyUsage(data)
      }
    } catch {
      // Non-critical - don't set error for usage fetch failures
      console.warn('Failed to fetch daily usage')
    }
  }, [])
  
  const fetchSubscription = useCallback(async (force = false) => {
    try {
      setIsLoading(true)
      setError(null)

      // Shared cache + in-flight request dedupe across all hook consumers.
      const data = await fetchBillingStatus(force)
      setSubscription(data.subscription)
      setDailyUsage(data.dailyUsage)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setSubscription(null)
      setDailyUsage(null)
    } finally {
      setIsLoading(false)
    }
  }, [])
  
  useEffect(() => {
    fetchSubscription()
  }, [fetchSubscription])
  
  // Computed values
  const canGenerate = subscription ? subscription.papersRemaining > 0 : false
  const isPaid = subscription ? subscription.tier !== 'free' : false
  
  // Daily usage computed values
  const canChat = dailyUsage 
    ? (dailyUsage.chat.isUnlimited || (typeof dailyUsage.chat.remaining === 'number' && dailyUsage.chat.remaining > 0))
    : true // Default to true when loading
  const canAutocomplete = dailyUsage
    ? (dailyUsage.autocomplete.isUnlimited || (typeof dailyUsage.autocomplete.remaining === 'number' && dailyUsage.autocomplete.remaining > 0))
    : true // Default to true when loading
  
  return {
    subscription,
    dailyUsage,
    isLoading,
    error,
    refresh: () => fetchSubscription(true),
    refreshUsage: fetchUsage,
    canGenerate,
    isPaid,
    canChat,
    canAutocomplete,
  }
}

// =============================================================================
// Utility Functions (client-safe)
// =============================================================================

/**
 * Get checkout URL for a specific tier and billing interval
 */
// Product IDs - these get inlined at build time by Next.js
const PRODUCT_IDS = {
  starter: process.env.NEXT_PUBLIC_POLAR_PRODUCT_STARTER,
  starter_yearly: process.env.NEXT_PUBLIC_POLAR_PRODUCT_STARTER_YEARLY,
  pro: process.env.NEXT_PUBLIC_POLAR_PRODUCT_PRO,
  pro_yearly: process.env.NEXT_PUBLIC_POLAR_PRODUCT_PRO_YEARLY,
} as const

export function getCheckoutUrl(
  tier: 'starter' | 'pro',
  options?: {
    email?: string
    userId?: string
    interval?: BillingInterval
  }
): string {
  const interval = options?.interval || 'monthly'
  
  // Map tier + interval to product ID
  let productId: string | undefined
  if (tier === 'pro') {
    productId = interval === 'yearly'
      ? PRODUCT_IDS.pro_yearly
      : PRODUCT_IDS.pro
  } else {
    productId = interval === 'yearly'
      ? PRODUCT_IDS.starter_yearly
      : PRODUCT_IDS.starter
  }
  
  // Debug: log if product ID is missing
  if (!productId) {
    console.error(`[Checkout] Missing product ID for tier=${tier}, interval=${interval}`, PRODUCT_IDS)
  }
  
  const params = new URLSearchParams()
  params.set('products', productId || '')
  
  if (options?.email) {
    params.set('customerEmail', options.email)
  }
  
  if (options?.userId) {
    params.set('customerExternalId', options.userId)
  }
  
  return `/api/billing/checkout?${params.toString()}`
}

/**
 * Get customer portal URL
 */
export function getPortalUrl(): string {
  return '/api/billing/portal'
}
