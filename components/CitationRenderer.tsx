'use client'

import type { PaperWithAuthors } from '@/types/simplified'
import CitationCore from './CitationCore'

// Temporarily disable lazy loading to debug bundling issue
// const CitationCore = lazy(() => import('./CitationCore'))

interface CitationRendererProps {
  content: string
  papers: PaperWithAuthors[]
  initialStyle?: 'apa' | 'mla' | 'chicago-author-date'
  className?: string
}

export function CitationRenderer(props: CitationRendererProps) {
  // Temporarily disable Suspense wrapper for debugging
  return <CitationCore {...props} />
} 