import { createClient } from '@/lib/supabase/server'
import { CreateProjectForm } from '@/app/(dashboard)/projects/CreateProjectForm'
import Link from 'next/link'
import { Card, CardContent } from "@/components/ui/card"
import { PenTool, ImageIcon, User as UserIcon, Code, Plus } from "lucide-react"

const actionCards = [
  {
    icon: PenTool,
    label: "Write copy",
    bgColor: "bg-orange-100",
    iconColor: "text-orange-600",
  },
  {
    icon: ImageIcon,
    label: "Image generation",
    bgColor: "bg-blue-100",
    iconColor: "text-blue-600",
  },
  {
    icon: UserIcon,
    label: "Create avatar",
    bgColor: "bg-green-100",
    iconColor: "text-green-600",
  },
  {
    icon: Code,
    label: "Write code",
    bgColor: "bg-pink-100",
    iconColor: "text-pink-600",
  },
]

export default async function ProjectsPage() {
  const supabase = await createClient()
  
  // Get current user
  const { data: { user } } = await supabase.auth.getUser()
  
  // Fetch user's projects
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, title, created_at')
    .eq('user_id', user?.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching projects:', error)
  }

  // Show Script-style welcome interface if no projects
  if (!projects || projects.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-4xl font-bold mb-4 text-gray-900">Welcome to GenPaper</h2>
          <p className="text-lg text-gray-600 mb-12">
            Get started by creating a task and AI can do the rest. Not sure where to start?
          </p>

          <div className="grid grid-cols-2 gap-4 max-w-lg mx-auto mb-12">
            {actionCards.map((card, index) => (
              <Card
                key={index}
                className="cursor-pointer hover:shadow-md transition-shadow border border-gray-200"
              >
                <CardContent className="flex items-center gap-3 p-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${card.bgColor}`}>
                    <card.icon className={`w-5 h-5 ${card.iconColor}`} />
                  </div>
                  <span className="font-medium text-sm text-gray-900">{card.label}</span>
                  <Plus className="w-4 h-4 ml-auto text-gray-400" />
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Create Project Section */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Create Your First Project
              </h2>
              <p className="text-gray-600">
                Start a new research paper by providing a topic title.
              </p>
            </div>
            <CreateProjectForm />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 p-6">
      {/* Page Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Research Projects
          </h1>
          <p className="text-gray-600 max-w-2xl mx-auto">
            Create and manage your AI-powered research papers. Generate outlines, content, citations, and references with ease.
          </p>
        </div>
      </div>
      
      {/* Projects Grid */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-900">
            Your Projects ({projects.length})
          </h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="group block p-6 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-all duration-200 hover:shadow-md"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-semibold text-gray-900 group-hover:text-blue-900 text-lg leading-tight">
                  {project.title}
                </h3>
                <svg className="w-5 h-5 text-gray-400 group-hover:text-blue-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
              <p className="text-sm text-gray-500">
                Created {new Date(project.created_at).toLocaleDateString('en-US', { 
                  year: 'numeric', 
                  month: 'short', 
                  day: 'numeric' 
                })}
              </p>
              <div className="mt-4 text-xs text-blue-600 group-hover:text-blue-700 font-medium">
                Open Project →
              </div>
            </Link>
          ))}
        </div>
      </div>
      
      {/* Create Project Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Create New Project
          </h2>
          <p className="text-gray-600">
            Start a new research paper by providing a topic title.
          </p>
        </div>
        <CreateProjectForm />
      </div>
    </div>
  )
} 