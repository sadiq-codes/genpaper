'use client'

import dynamic from 'next/dynamic'
import type { ProjectPaper, ExtractedClaim, ResearchGap, AnalysisOutput } from '@/components/editor/types'

// Dynamic import for the heavy editor component - reduces initial bundle by ~200-400KB
// ssr: false must be in a client component per Next.js 15 requirements
const ResearchEditor = dynamic(
  () => import('@/components/editor/ResearchEditor').then(m => m.ResearchEditor),
  { 
    ssr: false,
    loading: () => (
      <div className="h-full w-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-muted-foreground text-sm">Loading editor...</p>
        </div>
      </div>
    )
  }
)

export interface EditorClientWrapperProps {
  projectId: string
  projectTitle: string
  projectTopic: string
  paperType: 'researchArticle' | 'literatureReview' | 'capstoneProject' | 'mastersThesis' | 'phdDissertation'
  initialContent?: string
  initialPapers: ProjectPaper[]
  initialAnalysis?: {
    claims: ExtractedClaim[]
    gaps: ResearchGap[]
    synthesis: AnalysisOutput | null
  }
  citationStyle: string
  isGenerating: boolean
  isWriteMode: boolean
}

export function EditorClientWrapper(props: EditorClientWrapperProps) {
  return (
    <ResearchEditor
      {...props}
      onSave={undefined}
    />
  )
}
