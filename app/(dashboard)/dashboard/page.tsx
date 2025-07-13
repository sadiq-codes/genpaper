import { Metadata } from 'next'
import { Suspense } from 'react'
import HomeDashboard from '@/components/HomeDashboard'
import { LoadingSpinner } from '@/components/ui/loading-spinner'

export const metadata: Metadata = {
  title: 'Dashboard | Genpaper',
  description: 'Manage your research papers, drafts, and library',
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardPageSkeleton />}>
      <HomeDashboard />
    </Suspense>
  )
}

function DashboardPageSkeleton() {
  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-8 bg-muted rounded w-48 animate-pulse" />
          <div className="h-4 bg-muted rounded w-72 animate-pulse" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 bg-muted rounded w-32 animate-pulse" />
          <div className="h-9 bg-muted rounded w-24 animate-pulse" />
        </div>
      </div>
      
      <div className="flex space-x-1 bg-muted p-1 rounded-lg">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-8 bg-muted-foreground/20 rounded w-24 animate-pulse" />
        ))}
      </div>
      
      <div className="border rounded-lg p-6">
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner text="Loading dashboard..." />
        </div>
      </div>
    </div>
  )
} 