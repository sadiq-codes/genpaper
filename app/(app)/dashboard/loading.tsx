import { DashboardHeaderSkeleton, ProjectsGridSkeleton } from '@/components/dashboard/skeletons'

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <DashboardHeaderSkeleton />
      <ProjectsGridSkeleton />
    </div>
  )
}