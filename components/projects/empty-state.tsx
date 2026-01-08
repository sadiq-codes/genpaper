'use client'

import { FileText, Sparkles } from 'lucide-react'

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      {/* Decorative icon */}
      <div className="relative mb-6">
        <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
          <FileText className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
          <Sparkles className="h-3 w-3 text-primary" />
        </div>
      </div>

      {/* Text */}
      <h3 className="text-lg font-medium text-foreground mb-2">
        No projects yet
      </h3>
      <p className="text-sm text-muted-foreground text-center max-w-sm">
        Start by entering a research topic above. We&apos;ll help you discover papers, 
        extract key findings, and identify research gaps.
      </p>
    </div>
  )
}
