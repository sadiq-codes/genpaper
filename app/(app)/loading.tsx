import { PageContainer } from '@/components/ui/page-container'
import { Skeleton } from '@/components/ui/skeleton'

export default function AppLoading() {
  return (
    <PageContainer>
      {/* Header skeleton */}
      <div className="h-14 border-b border-border/50 flex items-center px-4 bg-background/95">
        <Skeleton className="h-8 w-8 rounded" />
        <div className="h-6 w-px bg-border mx-3" />
        <Skeleton className="h-7 w-7 rounded-lg" />
        <div className="h-6 w-px bg-border mx-3" />
        <Skeleton className="h-4 w-24" />
      </div>
      
      {/* Content skeleton */}
      <div className="flex-1 p-6 space-y-6">
        <div className="animate-pulse">
          <div className="h-64 bg-muted rounded-lg" />
        </div>
      </div>
    </PageContainer>
  )
}