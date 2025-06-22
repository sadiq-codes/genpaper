import { Metadata } from 'next'
import { Suspense } from 'react'
import PaperGenerator from '@/components/PaperGenerator'
import { LoadingSpinner } from '@/components/ui/loading-spinner'

export const metadata: Metadata = {
  title: 'Quick Draft | Genpaper',
  description: 'Generate a complete research paper with AI',
}

function GeneratePageSkeleton() {
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="text-center space-y-2">
        <div className="h-8 bg-muted rounded w-64 mx-auto animate-pulse" />
        <div className="h-4 bg-muted rounded w-96 mx-auto animate-pulse" />
      </div>
      
      <div className="border rounded-lg p-6 space-y-6">
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner text="Loading paper generator..." />
        </div>
      </div>
    </div>
  )
}

export default function QuickGeneratePage() {
  return (
    <div className="min-h-screen bg-background">
      <Suspense fallback={<GeneratePageSkeleton />}>
        <PaperGenerator />
      </Suspense>
    </div>
  )
} 