import { DashboardHeaderSkeleton } from '@/components/dashboard/skeletons'

export default function AppLoading() {
  return (
    <div className="space-y-6">
      <DashboardHeaderSkeleton />
      <div className="animate-pulse">
        <div className="h-64 bg-muted rounded-lg" />
      </div>
    </div>
  )
}