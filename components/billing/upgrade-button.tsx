'use client'

import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLimitModal } from '@/components/billing/limit-modal'
import { cn } from '@/lib/utils'

type UpgradeButtonSize = 'sm' | 'default' | 'inline'

interface UpgradeButtonProps {
  /** Button label. Defaults to "Upgrade" */
  label?: string
  /** Size variant */
  size?: UpgradeButtonSize
  className?: string
}

/**
 * Consistent upgrade CTA used across the entire app.
 * Opens the plan chooser modal so the user can pick Starter or Pro.
 *
 * Variants:
 *  - `default`  — standard button (popover CTAs, overlays)
 *  - `sm`       — compact button (banners, inline prompts)
 *  - `inline`   — minimal outline-style (tight spaces like dropdown menus)
 */
export function UpgradeButton({
  label = 'Upgrade',
  size = 'default',
  className,
}: UpgradeButtonProps) {
  const { showUpgradeModal } = useLimitModal()

  if (size === 'inline') {
    return (
      <Button
        variant="outline"
        size="sm"
        className={cn('h-6 text-xs px-2 gap-1 font-medium text-foreground', className)}
        onClick={showUpgradeModal}
      >
        <Sparkles className="h-3 w-3" />
        {label}
      </Button>
    )
  }

  return (
    <Button
      size={size === 'sm' ? 'sm' : 'default'}
      className={cn('gap-1.5', className)}
      onClick={showUpgradeModal}
    >
      <Sparkles className="h-3.5 w-3.5" />
      {label}
    </Button>
  )
}
