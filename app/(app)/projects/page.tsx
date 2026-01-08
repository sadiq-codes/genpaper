import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getUserResearchProjects } from '@/lib/db/research'
import { ProjectInput } from '@/components/projects/project-input'
import { QuickActions } from '@/components/projects/quick-actions'
import { ProjectCard } from '@/components/projects/project-card'
import { EmptyState } from '@/components/projects/empty-state'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { PageContainer } from '@/components/ui/page-container'
import { PageHeader } from '@/components/ui/page-header'

// Loading skeleton for projects grid
function ProjectsGridSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="rounded-lg border p-4 space-y-3">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <div className="flex gap-4">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
      ))}
    </div>
  )
}

// Server component to fetch and render projects
async function ProjectsGrid() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    redirect('/login')
  }

  const projects = await getUserResearchProjects(user.id, 20, 0)

  if (projects.length === 0) {
    return <EmptyState />
  }

  const projectIds = projects.map(p => p.id)

  // Batch query: Get paper counts using project_citations (unique papers per project)
  const { data: citations, error: citationError } = await supabase
    .from('project_citations')
    .select('project_id, paper_id')
    .in('project_id', projectIds)

  if (citationError) {
    console.error('Failed to fetch citation counts:', citationError)
  }

  // Count unique papers per project
  const paperCountMap = new Map<string, Set<string>>()
  for (const row of citations || []) {
    if (!paperCountMap.has(row.project_id)) {
      paperCountMap.set(row.project_id, new Set())
    }
    paperCountMap.get(row.project_id)!.add(row.paper_id)
  }

  // Get all unique paper IDs across all projects for claim counting
  const allPaperIds = new Set<string>()
  for (const row of citations || []) {
    allPaperIds.add(row.paper_id)
  }

  // Batch query: Get claim counts for all papers
  const { data: claims, error: claimError } = await supabase
    .from('paper_claims')
    .select('paper_id')
    .in('paper_id', Array.from(allPaperIds))

  if (claimError) {
    console.error('Failed to fetch claim counts:', claimError)
  }

  // Count claims per paper
  const claimsPerPaper = new Map<string, number>()
  for (const claim of claims || []) {
    const count = claimsPerPaper.get(claim.paper_id) || 0
    claimsPerPaper.set(claim.paper_id, count + 1)
  }

  // Build final results with paper and claim counts
  const projectsWithCounts = projects.map(project => {
    const projectPapers = paperCountMap.get(project.id) || new Set()
    const paperCount = projectPapers.size
    
    // Sum claims across all papers in this project
    let claimCount = 0
    for (const paperId of projectPapers) {
      claimCount += claimsPerPaper.get(paperId) || 0
    }
    
    return {
      project,
      paperCount,
      claimCount
    }
  })

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {projectsWithCounts.map(({ project, paperCount, claimCount }) => (
        <ProjectCard 
          key={project.id} 
          project={project}
          paperCount={paperCount}
          claimCount={claimCount}
        />
      ))}
    </div>
  )
}

export default function ProjectsPage() {
  return (
    <PageContainer>
      {/* Fixed Header */}
      <PageHeader title="Projects" />

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Hero Section - Create New Project */}
        <section className="py-12 md:py-16 px-4">
          <div className="max-w-3xl mx-auto text-center space-y-6">
            {/* Main Heading */}
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              What do you want to research?
            </h1>

            {/* Input */}
            <ProjectInput />

            {/* Quick Actions */}
            <QuickActions />
          </div>
        </section>

        {/* Separator */}
        <div className="px-6">
          <Separator />
        </div>

        {/* Projects Section */}
        <section className="flex-1 py-8 px-6">
          <div className="max-w-6xl mx-auto space-y-6">
            {/* Section Header */}
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Your Projects</h2>
            </div>

            {/* Projects Grid */}
            <Suspense fallback={<ProjectsGridSkeleton />}>
              <ProjectsGrid />
            </Suspense>
          </div>
        </section>
      </div>
    </PageContainer>
  )
}
