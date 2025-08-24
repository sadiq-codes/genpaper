import { Suspense } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getUserResearchProjects } from '@/lib/db/research'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Plus, Grid3X3, List, Filter, Search } from 'lucide-react'
import { ProjectsGridSkeleton } from './skeletons'
import { ProjectsList } from './projects-list'
import { redirect } from 'next/navigation'

async function ProjectsData() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    redirect('/login')
  }

  const projects = await getUserResearchProjects(user.id, 20, 0)
  
  return <ProjectsList projects={projects} />
}

export function ProjectsTab() {
  return (
    <div className="space-y-6">
      {/* Projects Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight">Your Research Projects</h2>
          <p className="text-muted-foreground">
            Continue working on existing papers or start a new research project
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          {/* View Toggle */}
          <div className="flex items-center border rounded-lg p-1">
            <Button variant="default" size="sm" className="h-7 px-2">
              <Grid3X3 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2">
              <List className="h-4 w-4" />
            </Button>
          </div>
          
          <Button asChild className="flex items-center gap-2">
            <Link href="/dashboard?tab=generate">
              <Plus className="h-4 w-4" />
              New Project
            </Link>
          </Button>
        </div>
      </div>

      {/* Quick Start Card */}
      <div className="flex justify-center">
        <Card className="cursor-pointer hover:bg-muted/50 transition-colors border-2 border-dashed border-primary/30">
          <CardHeader className="pb-3">
            <Link href="/dashboard?tab=generate" className="flex items-center gap-3">
              <div className="p-3 bg-primary/10 rounded-lg">
                <Plus className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">Start New Research Paper</CardTitle>
                <CardDescription>Generate a comprehensive academic paper from your research topic</CardDescription>
              </div>
            </Link>
          </CardHeader>
        </Card>
      </div>

      <Separator />

      {/* Projects List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Recent Projects</h3>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Filter className="h-4 w-4 mr-2" />
              Filter
            </Button>
            <Button variant="outline" size="sm">
              <Search className="h-4 w-4 mr-2" />
              Search
            </Button>
          </div>
        </div>
        
        <Suspense fallback={<ProjectsGridSkeleton />}>
          <ProjectsData />
        </Suspense>
      </div>
    </div>
  )
}
