import { Suspense } from "react"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { getUserResearchProjects } from "@/lib/db/research"
import { ProjectInput } from "@/components/projects/project-input"
import { QuickActions } from "@/components/projects/quick-actions"
import { ProjectCard } from "@/components/projects/project-card"
import { EmptyState } from "@/components/projects/empty-state"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"

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

async function ProjectsGrid() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect("/login")
  }

  const projects = await getUserResearchProjects(user.id, 20, 0)

  if (projects.length === 0) {
    return <EmptyState />
  }

  const projectIds = projects.map((p) => p.id)

  const { data: citations, error: citationError } = await supabase
    .from("project_citations")
    .select("project_id, paper_id")
    .in("project_id", projectIds)

  if (citationError) {
    console.error("Failed to fetch citation counts:", citationError)
  }

  const paperCountMap = new Map<string, Set<string>>()
  for (const row of citations || []) {
    if (!paperCountMap.has(row.project_id)) {
      paperCountMap.set(row.project_id, new Set())
    }
    paperCountMap.get(row.project_id)!.add(row.paper_id)
  }

  const allPaperIds = new Set<string>()
  for (const row of citations || []) {
    allPaperIds.add(row.paper_id)
  }

  const { data: claims, error: claimError } = await supabase
    .from("paper_claims")
    .select("paper_id")
    .in("paper_id", Array.from(allPaperIds))

  if (claimError) {
    console.error("Failed to fetch claim counts:", claimError)
  }

  const claimsPerPaper = new Map<string, number>()
  for (const claim of claims || []) {
    const count = claimsPerPaper.get(claim.paper_id) || 0
    claimsPerPaper.set(claim.paper_id, count + 1)
  }

  const projectsWithCounts = projects.map((project) => {
    const projectPapers = paperCountMap.get(project.id) || new Set()
    const paperCount = projectPapers.size

    let claimCount = 0
    for (const paperId of projectPapers) {
      claimCount += claimsPerPaper.get(paperId) || 0
    }

    return {
      project,
      paperCount,
      claimCount,
    }
  })

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {projectsWithCounts.map(({ project, paperCount, claimCount }) => (
        <ProjectCard key={project.id} project={project} paperCount={paperCount} claimCount={claimCount} />
      ))}
    </div>
  )
}

export default function ProjectsPage() {
  return (
    <PageContainer>
      <PageHeader title="Projects" />

      <div className="flex-1 overflow-y-auto">
        <section className="py-10 md:py-12 px-4">
          <div className="max-w-3xl mx-auto text-center space-y-6">
            <div className="space-y-2">
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight">What do you want to research?</h1>
              <p className="text-muted-foreground text-sm md:text-base">
                Start a new project or explore your existing research
              </p>
            </div>

            <div className="space-y-4 pt-2">
              <ProjectInput />
              <QuickActions />
            </div>
          </div>
        </section>

        <div className="px-6">
          <Separator />
        </div>

        <section className="flex-1 py-8 px-6">
          <div className="max-w-6xl mx-auto space-y-6">
            <h2 className="text-lg font-semibold">Your Projects</h2>

            <Suspense fallback={<ProjectsGridSkeleton />}>
              <ProjectsGrid />
            </Suspense>
          </div>
        </section>
      </div>
    </PageContainer>
  )
}
