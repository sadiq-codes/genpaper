import { ProjectsGrid } from "@/components/projects/projects-grid"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { UsageIndicator } from "@/components/billing/usage-indicator"
import { createClient } from "@/lib/supabase/server"
import { getUserResearchProjects } from "@/lib/db/research"
import dynamic from "next/dynamic"

const ProjectInputSection = dynamic(
  () => import("@/components/projects/project-input-section").then((mod) => mod.ProjectInputSection),
  {
    loading: () => (
      <div className="space-y-5 pt-2">
        <div className="w-full max-w-3xl mx-auto">
          <div className="rounded-2xl border border-border/70 bg-background px-6 py-6">
            <div className="h-24 rounded-xl bg-muted/60 animate-pulse" />
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-muted/60 animate-pulse" />
              <div className="h-8 w-24 rounded-full bg-muted/60 animate-pulse" />
              <div className="h-8 w-28 rounded-full bg-muted/60 animate-pulse" />
              <div className="ml-auto h-10 w-24 rounded-full bg-muted/60 animate-pulse" />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-center gap-2">
          <div className="h-8 w-28 rounded-full bg-muted/50 animate-pulse" />
          <div className="h-8 w-28 rounded-full bg-muted/50 animate-pulse" />
          <div className="h-8 w-28 rounded-full bg-muted/50 animate-pulse" />
        </div>
      </div>
    ),
  }
)

export default async function ProjectsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const projects = user ? await getUserResearchProjects(user.id, 20, 0) : []
  const initialProjectsWithCounts = projects.map((project) => ({
    project,
    paperCount: typeof project.citation_count === "number" ? project.citation_count : 0,
  }))

  return (
    <PageContainer>
      <PageHeader title="Projects" actions={<UsageIndicator />} />

      <div className="flex-1 overflow-y-auto">
        {/* Hero Section */}
        <section className="relative py-12 md:py-16 lg:py-20 px-4 overflow-hidden">
          {/* Atmospheric background */}
          <div className="absolute inset-0 -z-10" aria-hidden="true">
            <div className="absolute top-0 right-1/4 w-[500px] h-[400px] bg-[radial-gradient(ellipse,oklch(0.93_0.03_250)_0%,transparent_70%)] dark:bg-[radial-gradient(ellipse,oklch(0.20_0.04_250)_0%,transparent_70%)]" />
            <div className="absolute bottom-0 left-1/4 w-[400px] h-[300px] bg-[radial-gradient(ellipse,oklch(0.95_0.02_30)_0%,transparent_70%)] dark:bg-[radial-gradient(ellipse,oklch(0.18_0.02_30)_0%,transparent_70%)]" />
          </div>

          <div className="max-w-3xl mx-auto text-center space-y-8">
            {/* Heading */}
            <div className="space-y-3">
              <h1 className="font-instrument text-3xl md:text-4xl lg:text-5xl tracking-tight">
                What do you want to research?
              </h1>
              <p className="text-muted-foreground text-sm md:text-base max-w-xl mx-auto">
                Describe your topic and we&apos;ll help you discover papers, synthesize findings, and write your research
              </p>
            </div>

            {/* Input & Actions - combined component with shared PDF upload state */}
            <ProjectInputSection />
          </div>
        </section>

        {/* Projects Section */}
        <section className="border-t border-border/60 bg-muted/60">
          <div className="py-8 md:py-10 px-6">
            <div className="max-w-6xl mx-auto space-y-6">
              <h2 className="font-instrument text-2xl tracking-tight">Your Projects</h2>
              <ProjectsGrid initialProjectsWithCounts={initialProjectsWithCounts} />
            </div>
          </div>
        </section>
      </div>
    </PageContainer>
  )
}
