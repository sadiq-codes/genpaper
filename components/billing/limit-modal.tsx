'use client'

import { useState, useEffect, createContext, useContext, useCallback } from 'react'
import Link from 'next/link'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { 
  FileText, 
  MessageSquare, 
  Sparkles, 
  Zap, 
  Crown,
  ArrowRight,
  Clock,
} from 'lucide-react'
import { useSubscription, getCheckoutUrl } from '@/lib/hooks/use-subscription'
import { TIER_CONFIG } from '@/types/subscription'

// =============================================================================
// Types
// =============================================================================

export type LimitType = 'papers' | 'chat' | 'autocomplete'

interface LimitModalState {
  open: boolean
  limitType: LimitType | null
}

interface LimitModalContextValue {
  showLimitModal: (type: LimitType) => void
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
  
  const hideLimitModal = useCallback(() => {
    setState({ open: false, limitType: null })
  }, [])
  
  return (
    <LimitModalContext.Provider value={{ showLimitModal, hideLimitModal }}>
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
  const { subscription, dailyUsage, isPaid } = useSubscription()
  
  if (!limitType) return null
  
  const config = getLimitConfig(limitType, subscription, dailyUsage, isPaid)
  
  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className={`w-12 h-12 rounded-full ${config.iconBg} flex items-center justify-center mb-2`}>
            {config.icon}
          </div>
          <DialogTitle className="text-xl">{config.title}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          {/* Current Usage */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{config.usageLabel}</span>
              <span className="font-medium text-destructive">
                {config.used} / {config.limit}
              </span>
            </div>
            <Progress value={100} className="h-2 [&>div]:bg-destructive" />
            {config.resetsAt && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>{config.resetsAt}</span>
              </div>
            )}
          </div>
          
          {/* Upgrade Options */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium">Upgrade for more</h4>
            
            {/* Starter Plan */}
            {subscription?.tier === 'free' && (
              <UpgradeOption
                name="Starter"
                price={TIER_CONFIG.starter.price}
                yearlyPrice={TIER_CONFIG.starter.yearlyPrice}
                benefit={config.starterBenefit}
                icon={<Zap className="h-4 w-4" />}
                href={getCheckoutUrl('starter', { interval: 'yearly' })}
              />
            )}
            
            {/* Pro Plan */}
            <UpgradeOption
              name="Pro"
              price={TIER_CONFIG.pro.price}
              yearlyPrice={TIER_CONFIG.pro.yearlyPrice}
              benefit={config.proBenefit}
              icon={<Crown className="h-4 w-4" />}
              href={getCheckoutUrl('pro', { interval: 'yearly' })}
              recommended={subscription?.tier === 'starter'}
            />
          </div>
        </div>
        
        {/* Actions */}
        <div className="flex flex-col gap-2">
          <Button variant="outline" onClick={onClose}>
            Maybe Later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// Helpers
// =============================================================================

function UpgradeOption({
  name,
  price,
  yearlyPrice,
  benefit,
  icon,
  href,
  recommended,
}: {
  name: string
  price: number
  yearlyPrice: number
  benefit: string
  icon: React.ReactNode
  href: string
  recommended?: boolean
}) {
  const effectiveMonthly = Math.round(yearlyPrice / 12)
  
  return (
    <Link
      href={href}
      className={`block p-3 rounded-lg border transition-colors hover:bg-muted/50 ${
        recommended ? 'border-primary bg-primary/5' : 'border-border'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded ${recommended ? 'bg-primary/10 text-primary' : 'bg-muted'}`}>
            {icon}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{name}</span>
              {recommended && (
                <Badge variant="default" className="text-[10px] px-1.5 py-0">
                  Recommended
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{benefit}</p>
          </div>
        </div>
        <div className="text-right">
          <div className="font-semibold">${effectiveMonthly}/mo</div>
          <div className="text-xs text-muted-foreground">billed yearly</div>
        </div>
      </div>
    </Link>
  )
}

interface LimitConfig {
  icon: React.ReactNode
  iconBg: string
  title: string
  description: string
  usageLabel: string
  used: number
  limit: number
  resetsAt: string | null
  starterBenefit: string
  proBenefit: string
}

function getLimitConfig(
  type: LimitType,
  subscription: ReturnType<typeof useSubscription>['subscription'],
  dailyUsage: ReturnType<typeof useSubscription>['dailyUsage'],
  isPaid: boolean
): LimitConfig {
  const baseConfig = {
    papers: {
      icon: <FileText className="h-6 w-6 text-destructive" />,
      iconBg: 'bg-destructive/10',
      title: "You've reached your paper limit",
      description: "You've used all your papers for this month. Upgrade to generate more research papers.",
      usageLabel: 'Papers this month',
      used: subscription?.papersUsed || 0,
      limit: subscription?.papersLimit || 1,
      resetsAt: subscription?.periodEndsAt 
        ? `Resets ${new Date(subscription.periodEndsAt).toLocaleDateString()}`
        : null,
      starterBenefit: '5 papers per month',
      proBenefit: '15 papers per month',
    },
    chat: {
      icon: <MessageSquare className="h-6 w-6 text-destructive" />,
      iconBg: 'bg-destructive/10',
      title: "Daily chat limit reached",
      description: "You've used all your AI chat messages for today. Upgrade for unlimited chat.",
      usageLabel: 'Chat messages today',
      used: dailyUsage?.chat.used || 0,
      limit: dailyUsage?.chat.limit || 10,
      resetsAt: 'Resets at midnight UTC',
      starterBenefit: 'Unlimited chat messages',
      proBenefit: 'Unlimited chat messages',
    },
    autocomplete: {
      icon: <Sparkles className="h-6 w-6 text-destructive" />,
      iconBg: 'bg-destructive/10',
      title: "Daily autocomplete limit reached",
      description: "You've used all your autocomplete requests for today. Upgrade for unlimited autocomplete.",
      usageLabel: 'Autocomplete requests today',
      used: dailyUsage?.autocomplete.used || 0,
      limit: dailyUsage?.autocomplete.limit || 10,
      resetsAt: 'Resets at midnight UTC',
      starterBenefit: 'Unlimited autocomplete',
      proBenefit: 'Unlimited autocomplete',
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
