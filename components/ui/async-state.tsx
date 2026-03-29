'use client'

import type { ReactNode } from 'react'
import { AlertCircle, Inbox } from 'lucide-react'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import { cn } from '@/lib/utils'

interface AsyncStateProps {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
  className?: string
}

export function SectionLoadingState({
  title = 'Loading...',
  description,
  className,
}: {
  title?: string
  description?: string
  className?: string
}) {
  return (
    <div className={cn('flex min-h-[240px] items-center justify-center rounded-2xl border border-border/40 bg-card/50 px-6 py-10', className)}>
      <div className="flex max-w-sm flex-col items-center text-center">
        <LoadingSpinner text={title} />
        {description ? (
          <p className="mt-3 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </div>
  )
}

export function SectionErrorState({
  title,
  description,
  action,
  icon,
  className,
}: AsyncStateProps) {
  return (
    <div className={cn('flex min-h-[240px] items-center justify-center rounded-2xl border border-destructive/20 bg-destructive/5 px-6 py-10', className)}>
      <div className="flex max-w-sm flex-col items-center text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-destructive/20 bg-background/70">
          {icon ?? <AlertCircle className="h-5 w-5 text-destructive/70" aria-hidden="true" />}
        </div>
        <h3 className="font-instrument text-lg tracking-tight">{title}</h3>
        {description ? (
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        ) : null}
        {action ? <div className="mt-5">{action}</div> : null}
      </div>
    </div>
  )
}

export function SectionEmptyState({
  title,
  description,
  action,
  icon,
  className,
}: AsyncStateProps) {
  return (
    <div className={cn('flex min-h-[240px] items-center justify-center rounded-2xl border border-border/40 bg-card/30 px-6 py-10', className)}>
      <div className="flex max-w-sm flex-col items-center text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border/40 bg-background/70">
          {icon ?? <Inbox className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
        </div>
        <h3 className="font-instrument text-lg tracking-tight">{title}</h3>
        {description ? (
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        ) : null}
        {action ? <div className="mt-5">{action}</div> : null}
      </div>
    </div>
  )
}
