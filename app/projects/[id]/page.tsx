'use client'

import EnhancedEditor from '@/components/EnhancedEditor'
import { GlobalLibraryProvider } from '@/components/GlobalLibraryProvider'

export default function ProjectPage() {
  return (
    <GlobalLibraryProvider>
      <EnhancedEditor />
    </GlobalLibraryProvider>
  )
} 