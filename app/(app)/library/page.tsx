import { PageContainer } from '@/components/ui/page-container'
import { PageHeader } from '@/components/ui/page-header'
import { LibraryPage as LibraryContent } from '@/components/library/LibraryPage'

export default function LibraryPage() {
  return (
    <PageContainer>
      {/* Fixed Header */}
      <PageHeader title="My Library" />

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="space-y-1">
            <h2 className="font-instrument text-3xl tracking-tight">My Library</h2>
            <p className="text-[13px] text-muted-foreground/50">
              Your uploaded papers and bookmarked references — all in one place.
            </p>
          </div>

          <LibraryContent />
        </div>
      </div>
    </PageContainer>
  )
}