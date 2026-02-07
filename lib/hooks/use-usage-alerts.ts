'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useSubscription } from './use-subscription'
import { FileText, MessageSquare, Sparkles } from 'lucide-react'
import { createElement } from 'react'

/**
 * Hook that shows toast notifications when usage thresholds are crossed
 * 
 * Triggers at:
 * - 25% remaining (warning)
 * - 1 remaining (critical)
 * - 0 remaining (limit reached)
 */
export function useUsageAlerts() {
  const { subscription, dailyUsage, isPaid, isLoading } = useSubscription()
  
  // Track which alerts have been shown to avoid duplicates
  const shownAlerts = useRef<Set<string>>(new Set())
  
  useEffect(() => {
    if (isLoading || isPaid) return
    
    // Check paper usage (monthly)
    if (subscription) {
      const { papersUsed, papersLimit, papersRemaining } = subscription
      checkThreshold('papers', papersUsed, papersLimit, papersRemaining, {
        icon: FileText,
        singular: 'paper',
        plural: 'papers',
        period: 'this month',
      })
    }
    
    // Check daily usage (free tier only)
    if (dailyUsage) {
      // Chat
      if (!dailyUsage.chat.isUnlimited) {
        const chatRemaining = Math.max(0, dailyUsage.chat.limit - dailyUsage.chat.used)
        checkThreshold('chat', dailyUsage.chat.used, dailyUsage.chat.limit, chatRemaining, {
          icon: MessageSquare,
          singular: 'chat message',
          plural: 'chat messages',
          period: 'today',
        })
      }
      
      // Autocomplete
      if (!dailyUsage.autocomplete.isUnlimited) {
        const autocompleteRemaining = Math.max(0, dailyUsage.autocomplete.limit - dailyUsage.autocomplete.used)
        checkThreshold('autocomplete', dailyUsage.autocomplete.used, dailyUsage.autocomplete.limit, autocompleteRemaining, {
          icon: Sparkles,
          singular: 'autocomplete',
          plural: 'autocompletes',
          period: 'today',
        })
      }
    }
  }, [subscription, dailyUsage, isPaid, isLoading])
  
  function checkThreshold(
    type: string,
    used: number,
    limit: number,
    remaining: number,
    config: {
      icon: React.ComponentType<{ className?: string }>
      singular: string
      plural: string
      period: string
    }
  ) {
    const percentRemaining = (remaining / limit) * 100
    
    // Determine alert level
    let alertKey: string | null = null
    let message: string | null = null
    let variant: 'warning' | 'error' = 'warning'
    
    if (remaining === 0) {
      alertKey = `${type}-0`
      message = `You've used all ${limit} ${config.plural} ${config.period}.`
      variant = 'error'
    } else if (remaining === 1) {
      alertKey = `${type}-1`
      message = `Only 1 ${config.singular} remaining ${config.period}.`
      variant = 'warning'
    } else if (percentRemaining <= 25 && percentRemaining > 0) {
      alertKey = `${type}-25`
      message = `${remaining} ${remaining === 1 ? config.singular : config.plural} remaining ${config.period}.`
      variant = 'warning'
    }
    
    // Show alert if not already shown
    if (alertKey && !shownAlerts.current.has(alertKey)) {
      shownAlerts.current.add(alertKey)
      
      if (variant === 'error') {
        toast.error(message, {
          icon: createElement(config.icon, { className: 'h-4 w-4' }),
          description: 'Upgrade for more.',
          duration: 5000,
        })
      } else {
        toast.warning(message, {
          icon: createElement(config.icon, { className: 'h-4 w-4' }),
          duration: 4000,
        })
      }
    }
  }
  
  // Return function to manually reset alerts (e.g., after period reset)
  return {
    resetAlerts: () => {
      shownAlerts.current.clear()
    },
  }
}
