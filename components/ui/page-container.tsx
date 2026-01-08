import { cn } from '@/lib/utils'

interface PageContainerProps {
  children: React.ReactNode
  className?: string
}

export function PageContainer({ children, className }: PageContainerProps) {
  return (
    <div 
      className={cn(
        "h-full min-h-[calc(100vh-2rem)] flex flex-col rounded-3xl border-2 border-foreground/10 overflow-hidden bg-background",
        className
      )}
    >
      {children}
    </div>
  )
}
