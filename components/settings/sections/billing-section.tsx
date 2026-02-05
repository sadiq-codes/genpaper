'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { useSubscription, getCheckoutUrl, getPortalUrl } from '@/lib/hooks/use-subscription'
import { TIER_CONFIG } from '@/types/subscription'
import type { SubscriptionTier } from '@/types/subscription'
import { toast } from 'sonner'

interface BillingSectionProps {
  user: {
    id: string
    email: string
  }
}

export function BillingSection({ user }: BillingSectionProps) {
  const { subscription, isLoading, refresh } = useSubscription()
  const [redirectingTier, setRedirectingTier] = useState<'starter' | 'pro' | 'manage' | null>(null)
  const searchParams = useSearchParams()
  
  // Show success toast after checkout
  useEffect(() => {
    const checkoutSuccess = searchParams.get('checkout')
    if (checkoutSuccess === 'success') {
      // Refresh subscription data
      refresh()
      // Show success toast
      toast.success('Welcome to your new plan!', {
        description: 'Your subscription has been activated.',
        icon: <PartyPopper className="h-4 w-4" />,
      })
      // Clean up URL
      const url = new URL(window.location.href)
      url.searchParams.delete('checkout')
      url.searchParams.delete('checkoutId')
      url.searchParams.delete('customer_session_token')
      window.history.replaceState({}, '', url.toString())
    }
  }, [searchParams, refresh])
  
  const handleUpgrade = (tier: 'starter' | 'pro') => {
    setRedirectingTier(tier)
    window.location.href = getCheckoutUrl(tier, {
      email: user.email,
      userId: user.id,
    })
  }
  
  const handleManageSubscription = () => {
    setRedirectingTier('manage')
    window.location.href = getPortalUrl()
  }
  
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Billing & Subscription
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }
  
  const currentTier = subscription?.tier || 'free'
  const tierConfig = TIER_CONFIG[currentTier]
  const isPaid = currentTier !== 'free'
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          Billing & Subscription
        </CardTitle>
        <CardDescription>
          Manage your subscription and view usage
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current Plan */}
        <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
          <div className="flex items-center gap-3">
            {currentTier === 'pro' ? (
              <Crown className="h-6 w-6 text-primary" />
            ) : currentTier === 'starter' ? (
              <Zap className="h-6 w-6 text-primary" />
            ) : (
              <Sparkles className="h-6 w-6 text-muted-foreground" />
            )}
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{tierConfig.name}</span>
                {isPaid && (
                  <Badge variant="secondary">
                    ${tierConfig.price}/month
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {tierConfig.description}
              </p>
            </div>
          </div>
          {isPaid && (
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleManageSubscription}
              disabled={redirectingTier !== null}
            >
              {redirectingTier === 'manage' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  Manage
                  <ExternalLink className="h-3 w-3 ml-1" />
                </>
              )}
            </Button>
          )}
        </div>
        
        {/* Usage */}
        {subscription && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Papers this month</span>
              <span className="font-medium">
                {subscription.papersUsed} / {subscription.papersLimit}
              </span>
            </div>
            <Progress 
              value={(subscription.papersUsed / subscription.papersLimit) * 100} 
              className="h-2"
            />
            {subscription.periodEndsAt && (
              <p className="text-xs text-muted-foreground">
                Resets on {new Date(subscription.periodEndsAt).toLocaleDateString()}
              </p>
            )}
          </div>
        )}
        
        <Separator />
        
        {/* Upgrade Options */}
        {currentTier === 'free' && (
          <div className="space-y-4">
            <h4 className="font-medium">Upgrade your plan</h4>
            <div className="grid gap-4 md:grid-cols-2">
              {/* Starter */}
              <PlanCard
                tier="starter"
                isCurrentTier={false}
                onUpgrade={() => handleUpgrade('starter')}
                isRedirecting={redirectingTier === 'starter'}
                isDisabled={redirectingTier !== null}
              />
              {/* Pro */}
              <PlanCard
                tier="pro"
                isCurrentTier={false}
                onUpgrade={() => handleUpgrade('pro')}
                isRedirecting={redirectingTier === 'pro'}
                isDisabled={redirectingTier !== null}
                recommended
              />
            </div>
          </div>
        )}
        
        {currentTier === 'starter' && (
          <div className="space-y-4">
            <h4 className="font-medium">Upgrade to Pro</h4>
            <PlanCard
              tier="pro"
              isCurrentTier={false}
              onUpgrade={() => handleUpgrade('pro')}
              isRedirecting={redirectingTier === 'pro'}
              isDisabled={redirectingTier !== null}
              recommended
            />
          </div>
        )}
        
        {currentTier === 'pro' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle className="h-4 w-4 text-green-500" />
            You're on our highest tier. Thank you for your support!
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PlanCard({
  tier,
  isCurrentTier,
  onUpgrade,
  isRedirecting,
  isDisabled,
  recommended,
}: {
  tier: SubscriptionTier
  isCurrentTier: boolean
  onUpgrade: () => void
  isRedirecting: boolean
  isDisabled?: boolean
  recommended?: boolean
}) {
  const config = TIER_CONFIG[tier]
  
  return (
    <div className={`relative p-4 rounded-lg border ${recommended ? 'border-primary' : ''}`}>
      {recommended && (
        <Badge className="absolute -top-2 left-4">Recommended</Badge>
      )}
      <div className="space-y-3">
        <div>
          <h5 className="font-semibold">{config.name}</h5>
          <p className="text-2xl font-bold">
            ${config.price}<span className="text-sm font-normal text-muted-foreground">/mo</span>
          </p>
        </div>
        <ul className="space-y-1.5 text-sm">
          {config.features.slice(0, 4).map((feature, i) => (
            <li key={i} className="flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
        <Button 
          onClick={onUpgrade} 
          disabled={isCurrentTier || isDisabled}
          className="w-full"
          variant={recommended ? 'default' : 'outline'}
        >
          {isRedirecting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isCurrentTier ? (
            'Current Plan'
          ) : (
            `Upgrade to ${config.name}`
          )}
        </Button>
      </div>
    </div>
  )
}
