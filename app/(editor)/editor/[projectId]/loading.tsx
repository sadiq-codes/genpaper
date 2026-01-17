import { Skeleton } from '@/components/ui/skeleton'

/**
 * Editor Loading State
 * 
 * Shows immediately when navigating to editor, providing instant feedback.
 * Mimics the actual editor layout for a smooth transition.
 */
export default function EditorLoading() {
  return (
    <div className="h-screen w-full p-2 md:p-4">
      <div className="h-full w-full flex flex-col rounded-3xl border-2 border-foreground/10 overflow-hidden bg-background">
        {/* Top Nav Skeleton */}
        <div className="flex-shrink-0 h-14 border-b-2 border-foreground/10 px-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-5 w-48" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-20 rounded-lg" />
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-8 w-8 rounded-lg" />
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex min-h-0">
          {/* Sidebar Skeleton */}
          <div className="hidden lg:flex w-80 xl:w-96 flex-shrink-0 border-r-2 border-foreground/10">
            <div className="flex flex-col h-full w-full p-4">
              {/* Tab Header */}
              <div className="flex items-center gap-2 mb-4">
                <Skeleton className="h-9 w-20 rounded-lg" />
                <Skeleton className="h-9 w-24 rounded-lg" />
              </div>
              
              {/* Chat Messages */}
              <div className="flex-1 space-y-4">
                <div className="flex gap-3">
                  <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-16 w-full rounded-lg" />
                  </div>
                </div>
                
                <div className="flex gap-3">
                  <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-24 w-full rounded-lg" />
                  </div>
                </div>
              </div>
              
              {/* Chat Input */}
              <div className="mt-4">
                <Skeleton className="h-24 w-full rounded-xl" />
              </div>
            </div>
          </div>

          {/* Document Editor Skeleton */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex-1 overflow-hidden p-6 md:p-8">
              <div className="max-w-3xl mx-auto space-y-6">
                {/* Title */}
                <Skeleton className="h-10 w-3/4" />
                
                {/* Paragraphs */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                  </div>
                  
                  {/* Subheading */}
                  <Skeleton className="h-7 w-1/3 mt-6" />
                  
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-4/5" />
                  </div>
                  
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                  
                  {/* Another section */}
                  <Skeleton className="h-7 w-2/5 mt-6" />
                  
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
