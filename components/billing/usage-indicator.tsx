'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { FileText, MessageSquare, Sparkles, ChevronRight } from 'lucide-react'
import { UpgradeButton } from '@/components/billing/upgrade-button'
import { useSubscription } from '@/lib/hooks/use-subscription'
import { cn } from '@/lib/utils'

/**
 * Compact usage indicator for page headers
 * Shows paper usage with expandable popover for details
 * Includes upgrade CTA for free tier
 */
export function UsageIndicator({ className }: { className?: string }) {
  const { subscription, dailyUsage, isLoading, isPaid } = useSubscription()
  const [open, setOpen] = useState(false)
  
  if (isLoading) {
    return (
      <div className={cn("animate-pulse h-8 w-24 bg-muted rounded", className)} />
    )
  }
  
  if (!subscription) {
    return null
  }
  
  const { papersUsed, papersLimit, papersRemaining, tier } = subscription
  const usagePercent = Math.min(100, (papersUsed / papersLimit) * 100)
  const isAtLimit = papersRemaining === 0
  const isLow = papersRemaining <= 1 && papersLimit > 1
  
  // Color based on usage level
  const getStatusColor = () => {
    if (isAtLimit) return 'text-destructive'
    if (isLow) return 'text-warning'
    return 'text-muted-foreground'
  }
  
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm" 
          className={cn(
            "h-8 gap-2 px-2",
            isAtLimit && "border-destructive/50 bg-destructive/5",
            className
          )}
        >
          <FileText className={cn("h-4 w-4", getStatusColor())} />
          <span className={cn("text-sm font-medium", getStatusColor())}>
            {papersUsed}/{papersLimit}
          </span>
          {!isPaid && (
            <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
              Free
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      
      <PopoverContent className="w-72 p-4" align="end">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">Usage This Month</h4>
            <Badge variant="outline" className="text-xs">
              {subscription.tierName}
            </Badge>
          </div>
          
          {/* Paper Usage */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span>Papers</span>
              </div>
              <span className={cn("font-medium", getStatusColor())}>
                {papersUsed} / {papersLimit}
              </span>
            </div>
            <Progress 
              value={usagePercent} 
              className={cn(
                "h-1.5",
                isAtLimit && "[&>div]:bg-destructive",
                isLow && !isAtLimit && "[&>div]:bg-warning"
              )}
            />
            <p className="text-xs text-muted-foreground">
              {isAtLimit 
                ? "Limit reached"
                : `${papersRemaining} remaining`}
            </p>
          </div>
          
          {/* Daily Usage (Free tier only) */}
          {!isPaid && dailyUsage && (
            <>
              <div className="h-px bg-border" />
              
              <div className="space-y-3">
                <h5 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Daily Limits
                </h5>
                
                {/* Chat */}
                <DailyUsageRow
                  icon={<MessageSquare className="h-3.5 w-3.5" />}
                  label="Chat"
                  used={dailyUsage.chat.used}
                  limit={dailyUsage.chat.limit}
                  isUnlimited={dailyUsage.chat.isUnlimited}
                />
                
                {/* Autocomplete */}
                <DailyUsageRow
                  icon={<Sparkles className="h-3.5 w-3.5" />}
                  label="Autocomplete"
                  used={dailyUsage.autocomplete.used}
                  limit={dailyUsage.autocomplete.limit}
                  isUnlimited={dailyUsage.autocomplete.isUnlimited}
                />
              </div>
            </>
          )}
          
          {/* Upgrade CTA (Free tier only) */}
          {!isPaid && (
            <>
              <div className="h-px bg-border" />
              <UpgradeButton label="Upgrade for More" size="sm" className="w-full" />
            </>
          )}
          
          {/* Manage link (Paid tier) */}
          {isPaid && (
            <Button asChild variant="ghost" size="sm" className="w-full">
              <Link href="/settings#billing">
                Manage Subscription
                <ChevronRight className="h-4 w-4 ml-auto" />
              </Link>
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function DailyUsageRow({
  icon,
  label,
  used,
  limit,
  isUnlimited,
}: {
  icon: React.ReactNode
  label: string
  used: number
  limit: number
  isUnlimited: boolean
}) {
  if (isUnlimited) {
    return (
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        <span className="text-xs text-muted-foreground">Unlimited</span>
      </div>
    )
  }
  
  const remaining = Math.max(0, limit - used)
  const isLow = remaining <= 3
  const isOut = remaining === 0
  
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <span className={cn(
        "text-xs font-medium",
        isOut && "text-destructive",
        isLow && !isOut && "text-warning"
      )}>
        {remaining}/{limit} left
      </span>
    </div>
  )
}
