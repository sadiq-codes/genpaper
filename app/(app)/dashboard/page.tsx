import { Suspense } from 'react'
import { GenerateForm } from '@/components/dashboard/generate-form'
import { DashboardHeaderSkeleton } from '@/components/dashboard/skeletons'

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <Suspense fallback={<DashboardHeaderSkeleton />}>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold tracking-tight">Research Assistant</h2>
            <p className="text-muted-foreground">Analyze papers, extract claims, and identify research gaps.</p>
          </div>
        </div>
      </Suspense>

      <GenerateForm />
    </div>
  )
}
