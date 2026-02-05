'use client'

import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { FileText } from 'lucide-react'
import { useSubscription } from '@/lib/hooks/use-subscription'
import { cn } from '@/lib/utils'

interface UsageMeterProps {
  /** Show compact version */
  compact?: boolean
  /** Additional className */
  className?: string
}

/**
 * Displays paper usage for current billing period
 */
export function UsageMeter({ compact = false, className }: UsageMeterProps) {
  const { subscription, isLoading } = useSubscription()
  
  if (isLoading) {
    return (
      <div className={cn("animate-pulse h-8 bg-muted rounded", className)} />
    )
  }
  
  if (!subscription) {
    return null
  }
  
  const { papersUsed, papersLimit, papersRemaining, tierName } = subscription
  const usagePercent = Math.min(100, (papersUsed / papersLimit) * 100)
  const isNearLimit = papersRemaining <= 1 && papersLimit > 1
  const isAtLimit = papersRemaining === 0
  
  if (compact) {
    return (
      <div className={cn("flex items-center gap-2 text-sm", className)}>
        <FileText className="h-4 w-4 text-muted-foreground" />
        <span className={cn(
          "font-medium",
          isAtLimit && "text-destructive",
          isNearLimit && !isAtLimit && "text-warning"
        )}>
          {papersUsed}/{papersLimit}
        </span>
        <span className="text-muted-foreground">papers</span>
      </div>
    )
  }
  
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">Paper Usage</span>
          <Badge variant="outline" className="text-xs">
            {tierName}
          </Badge>
        </div>
        <span className={cn(
          "font-medium",
          isAtLimit && "text-destructive",
          isNearLimit && !isAtLimit && "text-yellow-600 dark:text-yellow-500"
        )}>
          {papersUsed} / {papersLimit}
        </span>
      </div>
      
      <Progress 
        value={usagePercent} 
        className={cn(
          "h-2",
          isAtLimit && "[&>div]:bg-destructive",
          isNearLimit && !isAtLimit && "[&>div]:bg-yellow-500"
        )}
      />
      
      <p className="text-xs text-muted-foreground">
        {isAtLimit 
          ? "You've reached your limit. Upgrade to generate more papers."
          : `${papersRemaining} paper${papersRemaining === 1 ? '' : 's'} remaining this month`}
      </p>
    </div>
  )
}
