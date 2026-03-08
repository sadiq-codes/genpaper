'use client'

import { AlertCircle, Clock } from 'lucide-react'
import { useSubscription } from '@/lib/hooks/use-subscription'
import { UpgradeButton } from '@/components/billing/upgrade-button'
import { cn } from '@/lib/utils'

interface ChatLimitBannerProps {
  /** Error from API, if any */
  error?: Error | null
  /** Whether to show usage stats even without error */
  showUsageStats?: boolean
  className?: string
}

/**
 * Banner shown when chat limits are reached or to display current usage.
 * Handles the CHAT_LIMIT_REACHED and AUTOCOMPLETE_LIMIT_REACHED errors.
 */
export function ChatLimitBanner({ 
  error, 
  showUsageStats = false,
  className 
}: ChatLimitBannerProps) {
  const { dailyUsage, isPaid, subscription } = useSubscription()
  
  // Parse error to check if it's a rate limit error
  const errorMessage = error?.message || ''
  const isRateLimitError = errorMessage.includes('CHAT_LIMIT_REACHED') || 
                           errorMessage.includes('AUTOCOMPLETE_LIMIT_REACHED') ||
                           errorMessage.includes('Daily chat limit') ||
                           errorMessage.includes('Daily autocomplete limit')
  
  // Show full upgrade prompt for rate limit errors
  if (isRateLimitError) {
    return (
      <div className={cn(
        "flex flex-col gap-3 p-4 bg-warning-muted border border-warning/20 rounded-lg",
        className
      )}>
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-warning-foreground">
              Daily limit reached
            </p>
            <p className="text-xs text-warning/80 mt-1">
              You've used all your free daily {errorMessage.includes('AUTOCOMPLETE') ? 'autocomplete requests' : 'chat messages'}. 
              Upgrade for unlimited access!
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <UpgradeButton label="Upgrade to Starter" size="sm" />
          
          {dailyUsage && !dailyUsage.chat.isUnlimited && (
            <span className="text-xs text-warning flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Resets at midnight UTC
            </span>
          )}
        </div>
      </div>
    )
  }
  
  // Show usage stats if requested (for free tier users)
  if (showUsageStats && !isPaid && dailyUsage && !dailyUsage.chat.isUnlimited) {
    const chatRemaining = typeof dailyUsage.chat.remaining === 'number' 
      ? dailyUsage.chat.remaining 
      : Infinity
    const chatLimit = dailyUsage.chat.limit
    
    // Only show if usage is getting low (< 50% remaining)
    if (chatRemaining > chatLimit / 2) {
      return null
    }
    
    const isLow = chatRemaining <= 3
    const isEmpty = chatRemaining === 0
    
    return (
      <div className={cn(
        "flex items-center justify-between px-3 py-2 text-xs rounded-lg",
        isEmpty 
          ? "bg-destructive/10 border border-destructive/20 text-destructive"
          : isLow 
            ? "bg-warning-muted border border-warning/20 text-warning"
            : "bg-muted/50 text-muted-foreground",
        className
      )}>
        <span className="flex items-center gap-1.5">
          {isEmpty ? (
            <AlertCircle className="h-3.5 w-3.5" />
          ) : (
            <span className="font-medium">{chatRemaining}</span>
          )}
          {isEmpty 
            ? 'No messages left today' 
            : `message${chatRemaining !== 1 ? 's' : ''} left today`}
        </span>
        
        <UpgradeButton size="inline" />
      </div>
    )
  }
  
  return null
}

/**
 * Small inline usage indicator for chat input area
 */
export function ChatUsageIndicator({ className }: { className?: string }) {
  const { dailyUsage, isPaid } = useSubscription()
  
  // Don't show for paid users (unlimited)
  if (isPaid || !dailyUsage || dailyUsage.chat.isUnlimited) {
    return null
  }
  
  const remaining = typeof dailyUsage.chat.remaining === 'number' 
    ? dailyUsage.chat.remaining 
    : Infinity
  const limit = dailyUsage.chat.limit
  
  // Show when below 50% or at 5 or fewer
  if (remaining > Math.max(limit / 2, 5)) {
    return null
  }
  
  const isLow = remaining <= 3
  const isEmpty = remaining === 0
  
  return (
    <span className={cn(
      "text-[10px] font-medium px-1.5 py-0.5 rounded",
      isEmpty 
        ? "bg-destructive/10 text-destructive"
        : isLow 
          ? "bg-warning-muted text-warning"
          : "bg-muted text-muted-foreground",
      className
    )}>
      {isEmpty ? '0 left' : `${remaining} left`}
    </span>
  )
}
