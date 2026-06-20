'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import { 
  CreditCard, 
  Sparkles, 
  Zap, 
  Crown, 
  ExternalLink, 
  Loader2,
  CheckCircle,
  PartyPopper
} from 'lucide-react'
import { getCheckoutUrl, getPortalUrl, type SubscriptionData } from '@/lib/hooks/use-subscription'
import { TIER_CONFIG } from '@/types/subscription'
import type { SubscriptionTier, BillingInterval } from '@/types/subscription'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { SectionErrorState } from '@/components/ui/async-state'

interface BillingSectionProps {
  user: {
    id: string
    email: string
  }
  /** Server-prefetched subscription data — renders instantly, no loading spinner */
  initialSubscription?: {
    tier: string
    tierName: string
    papersUsed: number
    papersLimit: number
    papersRemaining: number
    purchasedPapers?: number
    totalPapersAvailable?: number
    periodEndsAt: string | null
    features: string[]
  } | null
}

export function BillingSection({ user, initialSubscription }: BillingSectionProps) {
  // Use server-prefetched data directly — no client-side fetch needed for initial render
  const [subscription, setSubscription] = useState<SubscriptionData | null>(
    initialSubscription
      ? { 
          ...initialSubscription, 
          tier: initialSubscription.tier as SubscriptionData['tier'],
          purchasedPapers: initialSubscription.purchasedPapers ?? 0,
          totalPapersAvailable: initialSubscription.totalPapersAvailable ?? initialSubscription.papersRemaining,
        }
      : null
  )
  const [redirectingTier, setRedirectingTier] = useState<'starter' | 'pro' | 'manage' | null>(null)
  const [billingInterval, setBillingInterval] = useState<BillingInterval>('yearly')
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const searchParams = useSearchParams()
  
  // Refresh subscription data from API (only called after checkout success)
  const refresh = async () => {
    try {
      setRefreshError(null)
      const response = await fetch('/api/billing/subscription')
      if (!response.ok) {
        throw new Error('Failed to refresh subscription')
      }

      const data = await response.json()
      setSubscription(data)
    } catch (error) {
      console.warn('Failed to refresh subscription', error)
      setRefreshError(error instanceof Error ? error.message : 'Failed to refresh subscription')
    }
  }

  // Show success toast after checkout
  useEffect(() => {
    const checkoutSuccess = searchParams.get('checkout')
    if (checkoutSuccess === 'success') {
      refresh()
      toast.success('Welcome to your new plan!', {
        description: 'Your subscription has been activated.',
        icon: <PartyPopper className="h-4 w-4" />,
      })
      const url = new URL(window.location.href)
      url.searchParams.delete('checkout')
      url.searchParams.delete('checkoutId')
      url.searchParams.delete('customer_session_token')
      window.history.replaceState({}, '', url.toString())
    }
  }, [searchParams])
  
  const handleUpgrade = (tier: 'starter' | 'pro') => {
    setRedirectingTier(tier)
    window.location.href = getCheckoutUrl(tier, {
      email: user.email,
      userId: user.id,
      interval: billingInterval,
    })
  }
  
  const handleManageSubscription = () => {
    setRedirectingTier('manage')
    window.location.href = getPortalUrl()
  }
  
  const currentTier = subscription?.tier || 'free'
  const tierConfig = TIER_CONFIG[currentTier]
  const isPaid = currentTier !== 'free'
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-instrument text-xl tracking-tight">Billing & Subscription</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Manage your subscription and view usage
        </p>
      </div>

      <div className="rounded-xl border border-border/70 p-5 sm:p-6 space-y-6">
        {refreshError ? (
          <SectionErrorState
            title="Could not refresh billing status"
            description="Your latest subscription change may not be reflected yet."
            className="min-h-[180px]"
            action={(
              <button
                onClick={() => void refresh()}
                className="h-8 px-4 text-xs font-medium rounded-full border border-border/40 text-muted-foreground hover:text-foreground hover:border-border/60 transition-colors"
              >
                Try again
              </button>
            )}
          />
        ) : null}

        {/* Current Plan */}
        <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border border-border/60">
          <div className="flex items-center gap-3">
            {currentTier === 'pro' ? (
              <div className="w-9 h-9 rounded-lg bg-foreground/5 flex items-center justify-center">
                <Crown className="h-5 w-5 text-foreground" />
              </div>
            ) : currentTier === 'starter' ? (
              <div className="w-9 h-9 rounded-lg bg-foreground/5 flex items-center justify-center">
                <Zap className="h-5 w-5 text-foreground" />
              </div>
            ) : (
              <div className="w-9 h-9 rounded-lg bg-muted/70 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <span className="font-instrument text-base tracking-tight">{tierConfig.name}</span>
                {isPaid && (
                  <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    ${tierConfig.price}/month
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {tierConfig.description}
              </p>
            </div>
          </div>
          {isPaid && (
            <button
              onClick={handleManageSubscription}
              disabled={redirectingTier !== null}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-border/60 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors disabled:opacity-50"
            >
              {redirectingTier === 'manage' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <>
                  Manage
                  <ExternalLink className="h-3 w-3" />
                </>
              )}
            </button>
          )}
        </div>
        
        {/* Usage */}
        {subscription && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Papers this month</span>
              <span className="font-medium text-foreground">
                {subscription.papersUsed} / {subscription.papersLimit}
              </span>
            </div>
            <Progress 
              value={(subscription.papersUsed / subscription.papersLimit) * 100} 
              className="h-1.5"
            />
            {subscription.periodEndsAt && (
              <p className="text-[11px] text-muted-foreground">
                Resets on {new Date(subscription.periodEndsAt).toLocaleDateString()}
              </p>
            )}
          </div>
        )}
        
        <Separator className="bg-border/30" />
        
        {/* Upgrade Options */}
        {currentTier === 'free' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-instrument text-sm tracking-tight">Upgrade your plan</h4>
              <div className="flex items-center gap-2">
                <span className={`text-[11px] ${billingInterval === 'monthly' ? 'text-foreground' : 'text-muted-foreground'}`}>
                  Monthly
                </span>
                <Switch
                  checked={billingInterval === 'yearly'}
                  onCheckedChange={(checked) => setBillingInterval(checked ? 'yearly' : 'monthly')}
                />
                <span className={`text-[11px] ${billingInterval === 'yearly' ? 'text-foreground' : 'text-muted-foreground'}`}>
                  Yearly
                </span>
                {billingInterval === 'yearly' && (
                  <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">Save 33%</span>
                )}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <PlanCard
                tier="starter"
                isCurrentTier={false}
                onUpgrade={() => handleUpgrade('starter')}
                isRedirecting={redirectingTier === 'starter'}
                isDisabled={redirectingTier !== null}
                billingInterval={billingInterval}
              />
              <PlanCard
                tier="pro"
                isCurrentTier={false}
                onUpgrade={() => handleUpgrade('pro')}
                isRedirecting={redirectingTier === 'pro'}
                isDisabled={redirectingTier !== null}
                billingInterval={billingInterval}
                recommended
              />
            </div>
          </div>
        )}
        
        {currentTier === 'starter' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-instrument text-sm tracking-tight">Upgrade to Pro</h4>
              <div className="flex items-center gap-2">
                <span className={`text-[11px] ${billingInterval === 'monthly' ? 'text-foreground' : 'text-muted-foreground'}`}>
                  Monthly
                </span>
                <Switch
                  checked={billingInterval === 'yearly'}
                  onCheckedChange={(checked) => setBillingInterval(checked ? 'yearly' : 'monthly')}
                />
                <span className={`text-[11px] ${billingInterval === 'yearly' ? 'text-foreground' : 'text-muted-foreground'}`}>
                  Yearly
                </span>
                {billingInterval === 'yearly' && (
                  <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">Save 33%</span>
                )}
              </div>
            </div>
            <PlanCard
              tier="pro"
              isCurrentTier={false}
              onUpgrade={() => handleUpgrade('pro')}
              isRedirecting={redirectingTier === 'pro'}
              isDisabled={redirectingTier !== null}
              billingInterval={billingInterval}
              recommended
            />
          </div>
        )}
        
        {currentTier === 'pro' && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle className="h-4 w-4 text-emerald-500" />
            You&apos;re on our highest tier. Thank you for your support!
          </div>
        )}
      </div>
    </div>
  )
}

function PlanCard({
  tier,
  isCurrentTier,
  onUpgrade,
  isRedirecting,
  isDisabled,
  billingInterval,
  recommended,
}: {
  tier: SubscriptionTier
  isCurrentTier: boolean
  onUpgrade: () => void
  isRedirecting: boolean
  isDisabled?: boolean
  billingInterval: BillingInterval
  recommended?: boolean
}) {
  const config = TIER_CONFIG[tier]
  
  const isYearly = billingInterval === 'yearly'
  const displayPrice = tier === 'free' 
    ? 0 
    : isYearly 
      ? Math.round(config.yearlyPrice / 12)
      : config.price
  const yearlyTotal = config.yearlyPrice
  
  return (
    <div className={`relative rounded-xl border p-4 transition-all duration-200 ${
      recommended 
        ? 'border-foreground/50 hover:border-foreground/70' 
        : 'border-border/70 hover:border-border'
    }`}>
      {recommended && (
        <span className="absolute -top-2.5 left-4 text-[10px] font-medium bg-foreground/80 text-background px-2 py-0.5 rounded-full">
          Recommended
        </span>
      )}
      <div className="space-y-3">
        <div>
          <h5 className="font-instrument text-base tracking-tight">{config.name}</h5>
          <p className="text-2xl font-instrument tracking-tight mt-0.5">
            ${displayPrice}<span className="text-xs font-normal text-muted-foreground">/mo</span>
          </p>
          {tier !== 'free' && isYearly && (
            <p className="text-[11px] text-muted-foreground">
              ${yearlyTotal} billed yearly
            </p>
          )}
        </div>
        <ul className="space-y-1.5 text-xs text-muted-foreground">
          {config.features.slice(0, 4).map((feature, i) => (
            <li key={i} className="flex items-start gap-2">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
        <button
          onClick={onUpgrade}
          disabled={isCurrentTier || isDisabled}
          className={`w-full h-9 rounded-full text-xs font-medium transition-colors disabled:opacity-50 ${
            recommended 
              ? 'bg-foreground/80 text-background hover:bg-foreground' 
              : 'border border-border/60 text-muted-foreground hover:text-foreground hover:border-border'
          }`}
        >
          {isRedirecting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mx-auto" />
          ) : isCurrentTier ? (
            'Current Plan'
          ) : (
            `Upgrade to ${config.name}`
          )}
        </button>
      </div>
    </div>
  )
}
