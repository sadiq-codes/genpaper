'use client'

import { useState, createContext, useContext, useCallback } from 'react'
import Link from 'next/link'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { 
  FileText, 
  MessageSquare, 
  Sparkles, 
  CheckCircle,
  Clock,
} from 'lucide-react'
import { useSubscription, getCheckoutUrl, getPaperCreditCheckoutUrl } from '@/lib/hooks/use-subscription'
import { TIER_CONFIG, PAPER_PRICE, type SubscriptionTier, type BillingInterval } from '@/types/subscription'
import { cn } from '@/lib/utils'

// =============================================================================
// Types
// =============================================================================

export type LimitType = 'papers' | 'chat' | 'autocomplete' | 'upgrade'

interface LimitModalState {
  open: boolean
  limitType: LimitType | null
}

interface LimitModalContextValue {
  showLimitModal: (type: LimitType) => void
  /** Convenience alias: opens the generic plan chooser */
  showUpgradeModal: () => void
  hideLimitModal: () => void
}

// =============================================================================
// Context
// =============================================================================

const LimitModalContext = createContext<LimitModalContextValue | null>(null)

export function useLimitModal() {
  const context = useContext(LimitModalContext)
  if (!context) {
    throw new Error('useLimitModal must be used within LimitModalProvider')
  }
  return context
}

// =============================================================================
// Provider
// =============================================================================

export function LimitModalProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LimitModalState>({ open: false, limitType: null })
  
  const showLimitModal = useCallback((type: LimitType) => {
    setState({ open: true, limitType: type })
  }, [])

  const showUpgradeModal = useCallback(() => {
    setState({ open: true, limitType: 'upgrade' })
  }, [])
  
  const hideLimitModal = useCallback(() => {
    setState({ open: false, limitType: null })
  }, [])
  
  return (
    <LimitModalContext.Provider value={{ showLimitModal, showUpgradeModal, hideLimitModal }}>
      {children}
      {/* Only render modal when open to avoid useSubscription() API calls on every page */}
      {state.open && state.limitType && (
        <LimitModal 
          open={state.open} 
          limitType={state.limitType} 
          onClose={hideLimitModal}
        />
      )}
    </LimitModalContext.Provider>
  )
}

// =============================================================================
// Modal Component
// =============================================================================

interface LimitModalProps {
  open: boolean
  limitType: LimitType | null
  onClose: () => void
}

function LimitModal({ open, limitType, onClose }: LimitModalProps) {
  const { subscription, dailyUsage } = useSubscription()
  const [billingInterval, setBillingInterval] = useState<BillingInterval>('yearly')
  
  if (!limitType) return null

  const isGenericUpgrade = limitType === 'upgrade'
  const isPaperLimit = limitType === 'papers'
  const config = isGenericUpgrade
    ? null
    : getLimitConfig(limitType as Exclude<LimitType, 'upgrade'>, subscription, dailyUsage)

  const currentTier = subscription?.tier || 'free'
  const purchasedPapers = subscription?.purchasedPapers || 0

  // Determine which tiers to show (only tiers above current)
  const tiersToShow: SubscriptionTier[] = []
  if (currentTier === 'free') tiersToShow.push('starter', 'pro')
  else if (currentTier === 'starter') tiersToShow.push('pro')

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl p-0 gap-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4">
          {isPaperLimit || isGenericUpgrade ? (
            <>
              <DialogTitle className="text-xl">Choose a plan to continue</DialogTitle>
              <DialogDescription>Select an option to generate your research paper.</DialogDescription>
            </>
          ) : config ? (
            <>
              <div className={`w-10 h-10 rounded-full ${config.iconBg} flex items-center justify-center mb-1`}>
                {config.icon}
              </div>
              <DialogTitle className="text-lg">{config.title}</DialogTitle>
              <DialogDescription>{config.description}</DialogDescription>
            </>
          ) : null}
        </DialogHeader>

        <div className="px-6 pb-6 space-y-5">
          {/* Usage bar — for chat/autocomplete limits only */}
          {!isGenericUpgrade && config && !isPaperLimit && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{config.usageLabel}</span>
                <span className="font-medium text-destructive">
                  {config.used} / {config.limit}
                </span>
              </div>
              <Progress value={100} className="h-1.5 [&>div]:bg-destructive" />
              {config.resetsAt && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>{config.resetsAt}</span>
                </div>
              )}
            </div>
          )}

          {/* Purchased papers info */}
          {isPaperLimit && purchasedPapers > 0 && (
            <div className="text-sm text-muted-foreground text-center">
              You have <span className="font-semibold text-foreground">{purchasedPapers} purchased paper{purchasedPapers !== 1 ? 's' : ''}</span> available
            </div>
          )}

          {/* Billing toggle for subscriptions */}
          {(isPaperLimit || isGenericUpgrade) && tiersToShow.length > 0 && (
            <div className="flex items-center justify-center gap-3">
              <span className={cn(
                "text-sm font-medium",
                billingInterval === 'monthly' ? 'text-foreground' : 'text-muted-foreground'
              )}>
                Monthly
              </span>
              <Switch
                checked={billingInterval === 'yearly'}
                onCheckedChange={(checked) => setBillingInterval(checked ? 'yearly' : 'monthly')}
                aria-label="Toggle yearly billing"
              />
              <span className={cn(
                "text-sm font-medium",
                billingInterval === 'yearly' ? 'text-foreground' : 'text-muted-foreground'
              )}>
                Yearly
              </span>
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full ml-1">
                Save 33%
              </span>
            </div>
          )}

          {/* All pricing options in one grid */}
          {(isPaperLimit || isGenericUpgrade) && (
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
              {/* Pay per paper card */}
              <PayPerPaperCard />
              
              {/* Subscription cards */}
              {tiersToShow.map((tier) => (
                <PricingCard
                  key={tier}
                  tier={tier}
                  billingInterval={billingInterval}
                  recommended={tier === 'starter'}
                />
              ))}
            </div>
          )}

          {/* Dismiss */}
          <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={onClose}>
            Maybe Later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// Pricing Card (matches landing page design)
// =============================================================================

function PricingCard({
  tier,
  billingInterval,
  recommended,
}: {
  tier: SubscriptionTier
  billingInterval: BillingInterval
  recommended?: boolean
}) {
  const config = TIER_CONFIG[tier]
  const isYearly = billingInterval === 'yearly'
  const displayPrice = isYearly ? Math.round(config.yearlyPrice / 12) : config.price
  const yearlyTotal = config.yearlyPrice
  const monthlyCost = config.price * 12
  const savings = monthlyCost - yearlyTotal

  const href = getCheckoutUrl(tier as 'starter' | 'pro', { interval: billingInterval })

  return (
    <div
      className={cn(
        "relative rounded-2xl border p-5 flex flex-col bg-card transition-all",
        recommended
          ? "border-foreground/20 shadow-lg shadow-black/6 dark:shadow-black/30"
          : "border-border/50"
      )}
    >
      {recommended && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-medium tracking-wide uppercase bg-foreground text-background px-3 py-1 rounded-full">
          Most Popular
        </span>
      )}

      <div className="mb-4">
        <h3 className="font-semibold text-base mb-0.5">{config.name}</h3>
        <p className="text-xs text-muted-foreground">{config.description}</p>
      </div>

      <div className="mb-4">
        <span className="text-3xl font-bold tracking-tight">${displayPrice}</span>
        <span className="text-muted-foreground text-sm">/mo</span>
        {isYearly && (
          <div className="mt-0.5 text-xs text-muted-foreground">
            ${yearlyTotal}/yr &middot;{' '}
            <span className="text-emerald-600 dark:text-emerald-400">Save ${savings}</span>
          </div>
        )}
      </div>

      <ul className="space-y-2 mb-5 flex-1">
        {config.features.slice(0, 4).map((feature, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <CheckCircle className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
            <span className="text-muted-foreground">{feature}</span>
          </li>
        ))}
      </ul>

      <Link
        href={href}
        className={cn(
          "inline-flex items-center justify-center rounded-full px-5 py-2 text-sm font-medium transition-all",
          recommended
            ? "bg-foreground text-background hover:bg-foreground/90 shadow-sm"
            : "border border-border text-foreground hover:bg-muted"
        )}
      >
        Get {config.name}
      </Link>
    </div>
  )
}

// =============================================================================
// Pay Per Paper Card
// =============================================================================

function PayPerPaperCard() {
  const features = [
    'One-time purchase',
    'All paper types',
    'Full references & PDF',
    'Never expires',
  ]

  return (
    <div className="relative rounded-2xl border p-5 flex flex-col bg-card transition-all border-brand/30 shadow-lg shadow-brand/5">
      <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-medium tracking-wide uppercase bg-brand text-brand-foreground px-3 py-1 rounded-full">
        Quick Option
      </span>

      <div className="mb-4">
        <h3 className="font-semibold text-base mb-0.5">Pay Per Paper</h3>
        <p className="text-xs text-muted-foreground">No subscription needed</p>
      </div>

      <div className="mb-4">
        <span className="text-3xl font-bold tracking-tight">${PAPER_PRICE}</span>
        <span className="text-muted-foreground text-sm">/paper</span>
      </div>

      <ul className="space-y-2 mb-5 flex-1">
        {features.map((feature, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <CheckCircle className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
            <span className="text-muted-foreground">{feature}</span>
          </li>
        ))}
      </ul>

      <Link
        href={getPaperCreditCheckoutUrl()}
        className="inline-flex items-center justify-center rounded-full px-5 py-2 text-sm font-medium transition-all bg-brand text-brand-foreground hover:bg-brand/90 shadow-sm"
      >
        Buy Paper
      </Link>
    </div>
  )
}

// =============================================================================
// Helpers
// =============================================================================

interface LimitConfig {
  icon: React.ReactNode
  iconBg: string
  title: string
  description: string
  usageLabel: string
  used: number
  limit: number
  resetsAt: string | null
}

function getLimitConfig(
  type: Exclude<LimitType, 'upgrade'>,
  subscription: ReturnType<typeof useSubscription>['subscription'],
  dailyUsage: ReturnType<typeof useSubscription>['dailyUsage'],
): LimitConfig {
  const baseConfig = {
    papers: {
      icon: <FileText className="h-5 w-5 text-amber-600" />,
      iconBg: 'bg-amber-500/10',
      title: "Generate your paper",
      description: `Buy a paper for $${PAPER_PRICE} or subscribe for monthly papers.`,
      usageLabel: 'Papers available',
      used: subscription?.papersUsed || 0,
      limit: subscription?.papersLimit || 0,
      resetsAt: subscription?.periodEndsAt 
        ? `Subscription resets ${new Date(subscription.periodEndsAt).toLocaleDateString()}`
        : null,
    },
    chat: {
      icon: <MessageSquare className="h-5 w-5 text-destructive" />,
      iconBg: 'bg-destructive/10',
      title: "Daily chat limit reached",
      description: "You've used all your AI chat messages for today. Upgrade for unlimited chat.",
      usageLabel: 'Chat messages today',
      used: dailyUsage?.chat.used || 0,
      limit: dailyUsage?.chat.limit || 10,
      resetsAt: 'Resets at midnight UTC',
    },
    autocomplete: {
      icon: <Sparkles className="h-5 w-5 text-destructive" />,
      iconBg: 'bg-destructive/10',
      title: "Daily autocomplete limit reached",
      description: "You've used all your autocomplete requests for today. Upgrade for unlimited autocomplete.",
      usageLabel: 'Autocomplete requests today',
      used: dailyUsage?.autocomplete.used || 0,
      limit: dailyUsage?.autocomplete.limit || 10,
      resetsAt: 'Resets at midnight UTC',
    },
  }
  
  return baseConfig[type]
}

// =============================================================================
// Standalone Modal (for use without context)
// =============================================================================

export function LimitReachedModal({
  open,
  onOpenChange,
  limitType,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  limitType: LimitType
}) {
  return (
    <LimitModal 
      open={open} 
      limitType={limitType} 
      onClose={() => onOpenChange(false)} 
    />
  )
}
