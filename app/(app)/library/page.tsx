import { Suspense } from 'react'
import { LibraryTab } from '@/components/dashboard/library-tab'
import { LibrarySkeleton, DashboardHeaderSkeleton } from '@/components/dashboard/skeletons'

export default function LibraryPage() {
  return (
    <div className="space-y-6">
      <Suspense fallback={<DashboardHeaderSkeleton />}>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold tracking-tight">Library</h2>
            <p className="text-muted-foreground">Organize your research papers and sources.</p>
          </div>
        </div>
      </Suspense>

      <Suspense fallback={<LibrarySkeleton />}>
        <LibraryTab />
      </Suspense>
    </div>
  )
}