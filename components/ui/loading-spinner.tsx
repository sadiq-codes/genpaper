import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  text?: string
  className?: string
  fullScreen?: boolean
}

export function LoadingSpinner({ 
  size = 'md', 
  text = 'Loading...', 
  className,
  fullScreen = false 
}: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-6 w-6', 
    lg: 'h-8 w-8'
  }

  const textSizeClasses = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg'
  }

  const content = (
    <div className={cn(
      "flex items-center gap-2",
      textSizeClasses[size],
      className
    )}>
      <Sparkles className={cn(sizeClasses[size], "animate-spin text-primary")} />
      <span>{text}</span>
    </div>
  )

  if (fullScreen) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        {content}
      </div>
    )
  }

  return content
} 