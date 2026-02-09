'use client'

import { SidebarTrigger } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  description?: string
  actions?: React.ReactNode
  className?: string
}

export function PageHeader({ 
  title, 
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header 
      className={cn(
        "h-12 border-b border-border/30 flex items-center justify-between px-4 bg-background",
        className
      )}
    >
      {/* Left: Sidebar Trigger + Title */}
      <div className="flex items-center gap-2.5">
        <SidebarTrigger className="h-7 w-7 rounded-full" />

        <div className="h-4 w-px bg-border/40" />

        {/* Page Title */}
        <div className="flex items-center gap-2">
          <span className="font-instrument text-sm tracking-tight text-foreground/80 truncate max-w-[200px] sm:max-w-[300px]">
            {title}
          </span>
          {description && (
            <span className="text-[11px] text-muted-foreground/40 hidden md:inline">
              {description}
            </span>
          )}
        </div>
      </div>

      {/* Right: Actions */}
      {actions && (
        <div className="flex items-center gap-1">
          {actions}
        </div>
      )}
    </header>
  )
}
