import { Skeleton } from '@/components/ui/skeleton'

/**
 * Editor Route Group Loading State
 * 
 * Shows skeleton layout for the editor, including:
 * - Top navigation bar
 * - Left sidebar (chat/research tabs)
 * - Main editor area skeleton
 */
export default function EditorRouteLoading() {
  return (
    <div className="h-screen w-full flex flex-col rounded-3xl border-2 border-foreground/10 overflow-hidden bg-background">
      {/* Top Navigation Skeleton */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-5 w-48" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-20 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar Skeleton - Hidden on mobile */}
        <div className="hidden md:block w-[380px] min-w-[380px] p-3 pr-0">
          <div className="h-full rounded-2xl border-2 border-foreground/10 bg-background overflow-hidden">
            {/* Tab Header */}
            <div className="flex items-center justify-between p-3 border-b-2 border-foreground/10">
              <div className="flex gap-1 p-1 bg-muted rounded-lg">
                <Skeleton className="h-8 w-16 rounded-md" />
                <Skeleton className="h-8 w-20 rounded-md" />
              </div>
            </div>
            {/* Sidebar Content */}
            <div className="p-4 space-y-4">
              <Skeleton className="h-24 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-32 w-full rounded-lg" />
            </div>
          </div>
        </div>

        {/* Main Editor Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Undo/Redo Bar */}
          <div className="flex items-center justify-end px-4 py-1 border-b border-border/30">
            <div className="flex items-center gap-1">
              <Skeleton className="h-7 w-7 rounded" />
              <Skeleton className="h-7 w-7 rounded" />
            </div>
          </div>

          {/* Editor Content Skeleton */}
          <div className="flex-1 overflow-auto px-4 py-6 sm:px-8 sm:py-8 md:px-16 lg:px-24 lg:py-12">
            {/* Title */}
            <Skeleton className="h-10 w-3/4 mb-8" />

            {/* Paragraphs */}
            <div className="space-y-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>

            {/* Subheading */}
            <Skeleton className="h-7 w-1/2 mt-10 mb-6" />

            {/* More paragraphs */}
            <div className="space-y-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>

            {/* Another section */}
            <Skeleton className="h-7 w-2/5 mt-10 mb-6" />

            <div className="space-y-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
