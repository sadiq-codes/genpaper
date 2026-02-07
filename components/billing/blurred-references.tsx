'use client'

import { Button } from '@/components/ui/button'
import { Lock } from 'lucide-react'
import { getCheckoutUrl } from '@/lib/hooks/use-subscription'
import { cn } from '@/lib/utils'

interface BlurredReferencesProps {
  /** All references */
  references: Array<{
    id: string
    citation: string
    title?: string
  }>
  /** Number of references to show (rest are blurred) */
  visibleCount: number
  /** User's email for checkout */
  userEmail?: string
  /** User's ID for linking */
  userId?: string
  /** Additional className */
  className?: string
}

/**
 * Displays references with free tier blur effect
 * Shows first N references clearly, blurs the rest with upgrade CTA
 */
export function BlurredReferences({
  references,
  visibleCount,
  userEmail,
  userId,
  className,
}: BlurredReferencesProps) {
  const visibleRefs = references.slice(0, visibleCount)
  const blurredRefs = references.slice(visibleCount)
  const hasBlurred = blurredRefs.length > 0
  
  const handleUpgrade = () => {
    window.location.href = getCheckoutUrl('starter', { email: userEmail, userId, interval: 'yearly' })
  }
  
  return (
    <div className={cn("space-y-4", className)}>
      {/* Visible references */}
      <ol className="list-decimal list-inside space-y-2">
        {visibleRefs.map((ref, index) => (
          <li key={ref.id} className="text-sm leading-relaxed">
            {ref.citation}
          </li>
        ))}
      </ol>
      
      {/* Blurred references with upgrade overlay */}
      {hasBlurred && (
        <div className="relative">
          {/* Blurred content */}
          <div className="space-y-2 select-none" style={{ filter: 'blur(4px)' }}>
            {blurredRefs.slice(0, 5).map((ref, index) => (
              <div key={ref.id} className="text-sm leading-relaxed text-muted-foreground">
                {visibleCount + index + 1}. {ref.citation || ref.title || 'Reference details hidden...'}
              </div>
            ))}
            {blurredRefs.length > 5 && (
              <div className="text-sm text-muted-foreground">
                ... and {blurredRefs.length - 5} more references
              </div>
            )}
          </div>
          
          {/* Upgrade overlay */}
          <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-[2px]">
            <div className="text-center space-y-3 p-4">
              <div className="flex items-center justify-center gap-2 text-sm font-medium">
                <Lock className="h-4 w-4" />
                <span>{blurredRefs.length} more references</span>
              </div>
              <Button size="sm" onClick={handleUpgrade}>
                Upgrade to See All
              </Button>
            </div>
          </div>
        </div>
      )}
      
      {/* Total count */}
      <p className="text-xs text-muted-foreground text-center">
        {hasBlurred 
          ? `Showing ${visibleCount} of ${references.length} references`
          : `${references.length} references`}
      </p>
    </div>
  )
}
