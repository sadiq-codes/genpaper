import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LibraryManager from '@/components/LibraryManager'
import { Suspense } from 'react'
import { LoadingSpinner } from '@/components/ui/loading-spinner'

export const metadata: Metadata = {
  title: 'Research Library | Genpaper',
  description: 'Manage your research papers, collections, and notes',
}

export default async function LibraryPage() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-background">
      <Suspense fallback={<LibraryPageSkeleton />}>
        <LibraryManager />
      </Suspense>
    </div>
  )
}

function LibraryPageSkeleton() {
  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-8 bg-muted rounded w-32 animate-pulse" />
          <div className="h-4 bg-muted rounded w-64 animate-pulse" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 bg-muted rounded w-32 animate-pulse" />
          <div className="h-9 bg-muted rounded w-24 animate-pulse" />
        </div>
      </div>
      
      <div className="border rounded-lg p-6">
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner text="Loading library..." />
        </div>
      </div>
    </div>
  )
} 