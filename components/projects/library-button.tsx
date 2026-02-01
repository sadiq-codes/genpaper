'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
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
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsDrawerOpen(true)}
        className="gap-2"
      >
        <Library className="h-4 w-4" />
        My Library
      </Button>

      <LibraryDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        libraryOnlyMode={true}
      />
    </>
  )
}
