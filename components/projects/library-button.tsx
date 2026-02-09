'use client'

import { useState } from 'react'
import { Library } from 'lucide-react'
import dynamic from 'next/dynamic'

// Lazy load the drawer to reduce initial bundle
const LibraryDrawer = dynamic(() => import('@/components/ui/library-drawer'), {
  ssr: false,
})

export function LibraryButton() {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setIsDrawerOpen(true)}
        className="h-8 px-3 text-xs rounded-full border border-border/40 text-muted-foreground hover:text-foreground hover:border-border/60 transition-colors inline-flex items-center gap-1.5"
      >
        <Library className="h-3.5 w-3.5" />
        My Library
      </button>

      <LibraryDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        libraryOnlyMode={true}
      />
    </>
  )
}
