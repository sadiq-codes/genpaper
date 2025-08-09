'use client'

import LibraryManager from '@/components/LibraryManager'

export function LibraryTab() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight">Research Library</h2>
        <p className="text-muted-foreground">
          Manage your papers, sources, and research materials
        </p>
      </div>
      
      <LibraryManager />
    </div>
  )
}