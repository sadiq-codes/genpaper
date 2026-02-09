"use client"

import { Suspense } from "react"
import LibraryManager from "@/components/LibraryManager"

export function LibraryTab() {
  return (
    <div className="w-full">
      <Suspense
        fallback={
          <div className="animate-pulse space-y-4">
            <div className="flex gap-0.5 mb-4 pb-4 border-b border-border/20">
              <div className="h-8 bg-muted/40 rounded-lg w-24" />
              <div className="h-8 bg-muted/30 rounded-lg w-20" />
            </div>
            <div className="h-9 bg-muted/30 rounded-xl w-full mb-3" />
            {[0, 1, 2].map((i) => (
              <div key={i} className="py-3.5 border-b border-border/15">
                <div className="h-3.5 bg-muted/40 rounded-lg w-3/4 mb-2" />
                <div className="h-3 bg-muted/20 rounded-lg w-1/2" />
              </div>
            ))}
          </div>
        }
      >
        <LibraryManager />
      </Suspense>
    </div>
  )
}
