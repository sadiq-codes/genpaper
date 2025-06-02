import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import HistoryManager from '@/components/HistoryManager'
import { Suspense } from 'react'
import { History, Loader2 } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Project History | Genpaper',
  description: 'View and manage your research paper generation history',
}

export default async function HistoryPage() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/auth/login')
  }

  return (
    <div className="min-h-screen bg-background">
      <Suspense fallback={<HistoryPageSkeleton />}>
        <HistoryManager />
      </Suspense>
    </div>
  )
}

function HistoryPageSkeleton() {
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="space-y-2">
        <div className="h-8 bg-muted rounded w-48 animate-pulse" />
        <div className="h-4 bg-muted rounded w-72 animate-pulse" />
      </div>
      
      <div className="grid gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="border rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-2 flex-1">
                <div className="h-5 bg-muted rounded w-3/4 animate-pulse" />
                <div className="h-4 bg-muted rounded w-1/2 animate-pulse" />
              </div>
              <div className="h-6 bg-muted rounded w-16 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
      
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        <span>Loading project history...</span>
      </div>
    </div>
  )
} 