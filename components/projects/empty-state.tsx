'use client'

import { FileText } from 'lucide-react'

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4">
      <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mb-5">
        <FileText className="h-5 w-5 text-muted-foreground/50" />
      </div>

      <h3 className="font-instrument text-xl tracking-tight text-foreground mb-1.5">
        No projects yet
      </h3>
      <p className="text-sm text-muted-foreground/60 text-center max-w-xs leading-relaxed">
        Start by entering a research topic above to discover papers and begin writing.
      </p>
    </div>
  )
}
