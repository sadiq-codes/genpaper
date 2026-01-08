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
        "h-14 border-b border-border/50 flex items-center justify-between px-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60",
        className
      )}
    >
      {/* Left: Sidebar Trigger + Title */}
      <div className="flex items-center gap-2">
        <SidebarTrigger className="h-8 w-8" />

        <div className="h-6 w-px bg-border mx-1" />

        {/* Page Title */}
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-foreground/80 truncate max-w-[150px] sm:max-w-[250px]">
            {title}
          </span>
          {description && (
            <span className="text-sm text-muted-foreground hidden md:inline">
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
