"use client"

import { Suspense } from "react"
import LibraryManager from "@/components/LibraryManager"

export function LibraryTab() {
  return (
    <div className="w-full">
      <Suspense
        fallback={
          <div className="animate-pulse space-y-4">
            <div className="h-12 bg-muted rounded-lg" />
            <div className="h-96 bg-muted rounded-lg" />
          </div>
        }
      >
        <LibraryManager />
      </Suspense>
    </div>
  )
}
