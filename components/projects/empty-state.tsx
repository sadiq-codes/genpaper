'use client'

import { useEffect } from 'react'
import { FileText } from 'lucide-react'
import { useTour } from '@/lib/onboarding/use-tour'
import { PROJECTS_TOUR_STEPS } from '@/lib/onboarding/tours'
import { SectionEmptyState } from '@/components/ui/async-state'

export function EmptyState() {
  const { startTour } = useTour('projects', PROJECTS_TOUR_STEPS)

  useEffect(() => {
    const timer = setTimeout(startTour, 800)
    return () => clearTimeout(timer)
  }, [startTour])

  return (
    <SectionEmptyState
      title="No projects yet"
      description="Start by entering a research topic above to discover papers and begin writing."
      icon={<FileText className="h-5 w-5 text-muted-foreground/50" aria-hidden="true" />}
      className="min-h-[300px]"
    />
  )
}
