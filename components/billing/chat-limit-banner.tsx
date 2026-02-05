'use client'

import { AlertCircle, Sparkles, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSubscription, getCheckoutUrl } from '@/lib/hooks/use-subscription'
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
        "flex flex-col gap-3 p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg",
        className
      )}>
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              Daily limit reached
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
              You've used all your free daily {errorMessage.includes('AUTOCOMPLETE') ? 'autocomplete requests' : 'chat messages'}. 
              Upgrade for unlimited access!
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-8 gap-1.5 bg-gradient-to-r from-primary to-primary/80"
            onClick={() => {
              window.location.href = getCheckoutUrl('starter')
            }}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Upgrade to Starter
          </Button>
          
          {dailyUsage && !dailyUsage.chat.isUnlimited && (
            <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
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
          ? "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300"
          : isLow 
            ? "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300"
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
        
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs px-2"
          onClick={() => {
            window.location.href = getCheckoutUrl('starter')
          }}
        >
          <Sparkles className="h-3 w-3 mr-1" />
          Upgrade
        </Button>
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
        ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
        : isLow 
          ? "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
          : "bg-muted text-muted-foreground",
      className
    )}>
      {isEmpty ? '0 left' : `${remaining} left`}
    </span>
  )
}
