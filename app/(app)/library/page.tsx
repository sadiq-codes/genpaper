import { Suspense } from 'react'
import { LibraryTab } from '@/components/dashboard/library-tab'
import { LibrarySkeleton } from '@/components/dashboard/skeletons'
import { PageContainer } from '@/components/ui/page-container'
import { PageHeader } from '@/components/ui/page-header'

export default function LibraryPage() {
  return (
    <PageContainer>
      {/* Fixed Header */}
      <PageHeader title="Library" />

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold tracking-tight">Library</h2>
            <p className="text-muted-foreground">Organize your research papers and sources.</p>
          </div>
        </div>

        <Suspense fallback={<LibrarySkeleton />}>
          <LibraryTab />
        </Suspense>
      </div>
    </PageContainer>
  )
}