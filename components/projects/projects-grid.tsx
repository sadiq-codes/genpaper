"use client"

import { useQuery } from "@tanstack/react-query"
import { ProjectCard } from "./project-card"
import { EmptyState } from "./empty-state"
import { Skeleton } from "@/components/ui/skeleton"

interface ProjectWithCount {
  project: Record<string, unknown> & { id: string }
  paperCount: number
}

async function fetchProjects(): Promise<ProjectWithCount[]> {
  const res = await fetch("/api/projects?limit=20&offset=0")
  if (!res.ok) throw new Error("Failed to fetch projects")
  const data = await res.json()

  const projects = data.data?.projects || data.projects || []
  if (projects.length === 0) return []

  // Fetch paper counts
  const projectIds = projects.map((p: { id: string }) => p.id)
  const countsRes = await fetch(
    `/api/projects/paper-counts?${projectIds.map((id: string) => `ids=${id}`).join("&")}`
  )
  let paperCountMap: Record<string, number> = {}
  if (countsRes.ok) {
    const countsData = await countsRes.json()
    paperCountMap = countsData.counts || {}
  }

  return projects.map((project: Record<string, unknown> & { id: string }) => ({
    project,
    paperCount: paperCountMap[project.id] || 0,
  }))
}

function ProjectsGridSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="rounded-xl border border-border/40 p-5 space-y-4">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-3 w-16" />
          </div>
          <Skeleton className="h-5 w-4/5" />
          <div className="pt-3 border-t border-border/40 flex items-center justify-between">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function ProjectsGrid() {
  const { data: projectsWithCounts, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: fetchProjects,
    staleTime: 2 * 60 * 1000, // 2 min — cached across navigations
  })

  if (isLoading) return <ProjectsGridSkeleton />

  if (!projectsWithCounts || projectsWithCounts.length === 0) {
    return <EmptyState />
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {projectsWithCounts.map(({ project, paperCount }) => (
        <ProjectCard key={project.id} project={project as any} paperCount={paperCount} />
      ))}
    </div>
  )
}
