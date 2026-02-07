'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Sparkles, Zap, Crown } from 'lucide-react'
import { getCheckoutUrl } from '@/lib/hooks/use-subscription'
import { TIER_CONFIG } from '@/types/subscription'
import type { SubscriptionTier } from '@/types/subscription'

interface UpgradePromptProps {
  /** Current user's tier */
  currentTier: SubscriptionTier
  /** The tier required for the blocked feature */
  requiredTier: SubscriptionTier
  /** What feature/action was blocked */
  blockedFeature?: string
  /** Custom message to display */
  message?: string
  /** User's email for pre-filling checkout */
  userEmail?: string
  /** User's ID for linking Polar customer */
  userId?: string
  /** Callback when upgrade is clicked (for tracking) */
  onUpgradeClick?: () => void
  /** Variant: inline (small), or card (full) */
  variant?: 'inline' | 'card'
}

/**
 * Displays an upgrade prompt when user hits a subscription limit
 */
export function UpgradePrompt({
  currentTier,
  requiredTier,
  blockedFeature,
  message,
  userEmail,
  userId,
  onUpgradeClick,
  variant = 'card',
}: UpgradePromptProps) {
  const requiredConfig = TIER_CONFIG[requiredTier]
  
  const handleUpgrade = () => {
    onUpgradeClick?.()
    // Navigate to checkout (default to yearly for better value)
    const checkoutUrl = getCheckoutUrl(requiredTier as 'starter' | 'pro', {
      email: userEmail,
      userId,
      interval: 'yearly',
    })
    window.location.href = checkoutUrl
  }
  
  const TierIcon = requiredTier === 'pro' ? Crown : Zap
  
  if (variant === 'inline') {
    return (
      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
        <TierIcon className="h-5 w-5 text-primary" />
        <div className="flex-1 text-sm">
          <span className="text-muted-foreground">
            {message || blockedFeature 
              ? `${blockedFeature} requires ${requiredConfig.name}` 
              : `Upgrade to ${requiredConfig.name}`}
          </span>
        </div>
        <Button size="sm" onClick={handleUpgrade}>
          Upgrade
        </Button>
      </div>
    )
  }
  
  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <TierIcon className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">
            Upgrade to {requiredConfig.name}
          </CardTitle>
          <Badge variant="secondary">${Math.round(requiredConfig.yearlyPrice / 12)}/mo</Badge>
        </div>
        <CardDescription>
          {message || (blockedFeature 
            ? `${blockedFeature} requires a ${requiredConfig.name} subscription.`
            : `Unlock more features with ${requiredConfig.name}.`)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-2">
          {requiredConfig.features.slice(0, 4).map((feature, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4 text-primary" />
              {feature}
            </li>
          ))}
        </ul>
        <Button onClick={handleUpgrade} className="w-full">
          Upgrade to {requiredConfig.name}
        </Button>
      </CardContent>
    </Card>
  )
}
