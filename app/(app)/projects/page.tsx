import { Suspense } from 'react'
import { ProjectsTab } from '@/components/dashboard/projects-tab'
import { ProjectsGridSkeleton, DashboardHeaderSkeleton } from '@/components/dashboard/skeletons'

export default function ProjectsPage() {
  return (
    <div className="space-y-6">
      <Suspense fallback={<DashboardHeaderSkeleton />}>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold tracking-tight">Projects</h2>
            <p className="text-muted-foreground">Manage your research projects and track progress.</p>
          </div>
        </div>
      </Suspense>

      <Suspense fallback={<ProjectsGridSkeleton />}>
        <ProjectsTab />
      </Suspense>
    </div>
  )
}