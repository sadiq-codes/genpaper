"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ProjectCard } from "./project-card"
import { EmptyState } from "./empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { SectionErrorState } from "@/components/ui/async-state"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import type { ResearchProjectWithLatestVersion } from "@/types/simplified"

export interface ProjectWithCount {
  project: ResearchProjectWithLatestVersion
  paperCount: number
}

async function fetchProjects(): Promise<ProjectWithCount[]> {
  const res = await fetch("/api/projects?limit=20&offset=0")
  if (!res.ok) {
    throw new Error("Failed to load projects")
  }

  const data = await res.json()
  const projects = data.data?.projects || data.projects || []

  return projects.map((project: ResearchProjectWithLatestVersion) => ({
    project,
    paperCount:
      typeof project.citation_count === "number" ? project.citation_count : 0,
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

export function ProjectsGrid({ initialProjectsWithCounts }: { initialProjectsWithCounts?: ProjectWithCount[] }) {
  const queryClient = useQueryClient()
  const { data: projectsWithCounts, isLoading, error, isFetching } = useQuery({
    queryKey: ["projects"],
    queryFn: fetchProjects,
    staleTime: 5 * 60 * 1000, // Keep cached list for quick revisits
    initialData: initialProjectsWithCounts,
  })

  if (isLoading) return <ProjectsGridSkeleton />

  if (error) {
    return (
      <SectionErrorState
        title="Failed to load projects"
        description="We couldn't load your recent projects right now."
        action={(
          <Button
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["projects"] })}
            disabled={isFetching}
          >
            {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Try again
          </Button>
        )}
      />
    )
  }

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
