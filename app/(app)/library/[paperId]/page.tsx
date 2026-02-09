import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PageContainer } from '@/components/ui/page-container'
import { PageHeader } from '@/components/ui/page-header'
import { PaperDetailContent } from '@/components/library/PaperDetailContent'
import { Skeleton } from '@/components/ui/skeleton'

interface PageProps {
  params: Promise<{ paperId: string }>
}

function PaperDetailSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-3 w-20 bg-muted/40 rounded-full" />
      <div className="space-y-3">
        <div className="h-6 w-3/4 bg-muted/50 rounded-lg" />
        <div className="h-4 w-1/3 bg-muted/30 rounded-lg" />
        <div className="flex gap-2 mt-2">
          <div className="h-5 w-16 bg-muted/20 rounded-full" />
          <div className="h-5 w-14 bg-muted/20 rounded-full" />
        </div>
        <div className="flex gap-1.5 mt-3">
          <div className="h-8 w-24 bg-muted/30 rounded-full" />
          <div className="h-8 w-24 bg-muted/20 rounded-full" />
        </div>
      </div>
      <div className="pt-6 border-t border-border/15 space-y-3">
        <div className="h-4 w-20 bg-muted/30 rounded-lg" />
        <div className="h-3 w-full bg-muted/20 rounded-lg" />
        <div className="h-3 w-4/5 bg-muted/20 rounded-lg" />
        <div className="h-3 w-3/5 bg-muted/20 rounded-lg" />
      </div>
    </div>
  )
}

async function PaperDetail({ paperId }: { paperId: string }) {
  const supabase = await createClient()
  
  // Get authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    notFound()
  }

  // Fetch paper details first (needed for auth check)
  const { data: paper, error: paperError } = await supabase
    .from('papers')
    .select(`
      id,
      title,
      abstract,
      authors,
      publication_date,
      venue,
      doi,
      pdf_url,
      source,
      citation_count,
      processing_status,
      created_at,
      owner_id,
      metadata
    `)
    .eq('id', paperId)
    .single()

  if (paperError || !paper) {
    notFound()
  }

  // Check if paper is accessible to user (global search papers or user's own uploads)
  if (paper.owner_id && paper.owner_id !== user.id) {
    notFound() // User doesn't have access to this private paper
  }

  // OPTIMIZATION: Run these 3 queries in parallel (they're independent)
  const [libraryEntryResult, projectCitationsResult, chunkCountResult] = await Promise.all([
    // Check if paper is in user's library
    supabase
      .from('library_papers')
      .select('id, notes, added_at')
      .eq('user_id', user.id)
      .eq('paper_id', paperId)
      .single(),
    
    // Get projects that cite this paper
    supabase
      .from('project_citations')
      .select(`
        id,
        reason,
        created_at,
        research_projects:project_id (
          id,
          topic,
          created_at
        )
      `)
      .eq('paper_id', paperId),
    
    // Get chunk count (for processing status)
    supabase
      .from('paper_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('paper_id', paperId),
  ])

  const libraryEntry = libraryEntryResult.data
  const projectCitationsRaw = projectCitationsResult.data
  const chunkCount = chunkCountResult.count

  // Transform to expected shape (research_projects comes as object or array from join)
  const projectCitations = (projectCitationsRaw || []).map((citation) => {
    // Supabase returns joined data - handle both object and array cases
    const projects = citation.research_projects
    const project = Array.isArray(projects) ? projects[0] : projects
    return {
      id: citation.id as string,
      reason: citation.reason as string | null,
      created_at: citation.created_at as string,
      research_projects: project as { id: string; topic: string; created_at: string } | null,
    }
  })

  return (
    <PaperDetailContent
      paper={{
        ...paper,
        authors: paper.authors || [],
      }}
      libraryEntry={libraryEntry}
      projectCitations={projectCitations || []}
      chunkCount={chunkCount || 0}
      userId={user.id}
    />
  )
}

export default async function PaperDetailPage({ params }: PageProps) {
  const { paperId } = await params

  return (
    <PageContainer>
      <PageHeader title="Paper Details" />
      
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          <Suspense fallback={<PaperDetailSkeleton />}>
            <PaperDetail paperId={paperId} />
          </Suspense>
        </div>
      </div>
    </PageContainer>
  )
}
