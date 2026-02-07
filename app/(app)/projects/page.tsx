import { ProjectInputSection } from "@/components/projects/project-input-section"
import { ProjectsGrid } from "@/components/projects/projects-grid"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { UsageIndicator } from "@/components/billing/usage-indicator"

export default function ProjectsPage() {
  return (
    <PageContainer>
      <PageHeader title="Projects" actions={<UsageIndicator />} />

      <div className="flex-1 overflow-y-auto">
        {/* Hero Section - Generous spacing for focus */}
        <section className="py-12 md:py-16 lg:py-20 px-4">
          <div className="max-w-3xl mx-auto text-center space-y-8">
            {/* Heading */}
            <div className="space-y-3">
              <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight">
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
        <section className="border-t bg-muted/30">
          <div className="py-8 md:py-10 px-6">
            <div className="max-w-6xl mx-auto space-y-6">
              <h2 className="text-lg font-semibold">Your Projects</h2>
              <ProjectsGrid />
            </div>
          </div>
        </section>
      </div>
    </PageContainer>
  )
}
