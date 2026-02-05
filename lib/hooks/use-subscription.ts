'use client'

import { useState, useEffect, useCallback } from 'react'
import type { SubscriptionTier } from '@/types/subscription'

// =============================================================================
// Types
// =============================================================================

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
  /** Loading state */
  isLoading: boolean
  /** Error message if fetch failed */
  error: string | null
  /** Refresh subscription data */
  refresh: () => Promise<void>
  /** Check if user can generate another paper */
  canGenerate: boolean
  /** Check if user has a paid subscription */
  isPaid: boolean
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
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  const fetchSubscription = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      
      const response = await fetch('/api/billing/subscription')
      
      if (!response.ok) {
        if (response.status === 401) {
          // Not logged in - that's fine, just no subscription
          setSubscription(null)
          return
        }
        throw new Error('Failed to fetch subscription')
      }
      
      const data = await response.json()
      setSubscription(data)
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setSubscription(null)
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
  
  return {
    subscription,
    isLoading,
    error,
    refresh: fetchSubscription,
    canGenerate,
    isPaid,
  }
}

// =============================================================================
// Utility Functions (client-safe)
// =============================================================================

/**
 * Get checkout URL for a specific tier
 */
export function getCheckoutUrl(
  tier: 'starter' | 'pro',
  options?: {
    email?: string
    userId?: string
  }
): string {
  const productId = tier === 'pro' 
    ? process.env.NEXT_PUBLIC_POLAR_PRODUCT_PRO 
    : process.env.NEXT_PUBLIC_POLAR_PRODUCT_STARTER
  
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
