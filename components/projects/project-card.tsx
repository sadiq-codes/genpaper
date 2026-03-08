"use client"

import type React from "react"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  MoreHorizontal,
  FileText,
  PenLine,
  Trash2,
  ExternalLink,
  BookOpen,
  FlaskConical,
  GraduationCap,
  ScrollText,
  Briefcase,
  type LucideIcon,
  ArrowUpRight,
} from "lucide-react"
import { toast } from "sonner"
import { deleteProjectAction } from "@/components/dashboard/actions"
import { cn } from "@/lib/utils"
import type { ResearchProjectWithLatestVersion, PaperTypeKey, GenerationConfig } from "@/types/simplified"

const paperTypeConfig: Record<PaperTypeKey, { icon: LucideIcon; label: string; shortLabel: string }> = {
  literatureReview: {
    icon: BookOpen,
    label: "Literature Review",
    shortLabel: "Lit Review",
  },
  researchArticle: {
    icon: FlaskConical,
    label: "Research Article",
    shortLabel: "Research",
  },
  mastersThesis: {
    icon: GraduationCap,
    label: "Master's Thesis",
    shortLabel: "Master's",
  },
  phdDissertation: {
    icon: ScrollText,
    label: "PhD Dissertation",
    shortLabel: "PhD",
  },
  capstoneProject: {
    icon: Briefcase,
    label: "Capstone Project",
    shortLabel: "Capstone",
  },
}

interface ProjectCardProps {
  project: ResearchProjectWithLatestVersion
  paperCount?: number
}

interface ProjectWithCount {
  project: Record<string, unknown> & { id: string }
  paperCount: number
}

export function ProjectCard({ project, paperCount = 0 }: ProjectCardProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [_isPending, startTransition] = useTransition()
  const [isDeleting, setIsDeleting] = useState(false)

  const editorUrl = `/editor/${project.id}`

  const getPaperType = (): PaperTypeKey | undefined => {
    if (project.paper_type) return project.paper_type
    const config = project.generation_config as GenerationConfig | undefined
    return config?.paper_settings?.paperType || config?.paperType
  }

  const paperType = getPaperType()
  const typeConfig = paperType ? paperTypeConfig[paperType] : null
  const TypeIcon = typeConfig?.icon ?? FileText

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDeleting(true)
    startTransition(async () => {
      // Optimistically remove from projects grid cache
      const previous = queryClient.getQueryData<ProjectWithCount[]>(["projects"])
      queryClient.setQueryData<ProjectWithCount[]>(["projects"], (old = []) =>
        old.filter((entry) => entry.project.id !== project.id)
      )

      const result = await deleteProjectAction(project.id)
      if (!result.success) {
        console.error("Failed to delete project:", result.error)
        // Roll back optimistic update on failure
        queryClient.setQueryData(["projects"], previous)
        toast.error(result.error || "Failed to delete project")
      } else {
        toast.success("Project deleted")
      }
      setIsDeleting(false)
      queryClient.invalidateQueries({ queryKey: ["projects"] })
    })
  }

  const handleViewDetails = (e: React.MouseEvent) => {
    e.preventDefault()
    router.push(`/projects/${project.id}`)
  }

  const getStatusLabel = (status: string): string => {
    switch (status) {
      case "complete": return "Complete"
      case "failed": return "Failed"
      case "generating": return "In Progress"
      case "draft": return "Draft"
      default: return status
    }
  }

  const getStatusColor = (status: string): string => {
    switch (status) {
      case "complete": return "bg-success/10 text-success border-success/20"
      case "failed": return "bg-destructive/10 text-destructive border-destructive/20"
      case "generating": return "bg-warning/10 text-warning border-warning/20"
      default: return "bg-muted text-muted-foreground border-border"
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffTime = Math.abs(now.getTime() - date.getTime())
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return "Today"
    if (diffDays === 1) return "Yesterday"
    if (diffDays < 7) return `${diffDays}d ago`

    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    }).format(date)
  }

  return (
    <Link
      href={editorUrl}
      className="block group"
      prefetch={true}
    >
      <div
        className={cn(
          "relative rounded-xl border border-border/60 bg-card p-5",
          "transition-all duration-300 ease-out",
          "hover:border-foreground/15 hover:shadow-sm",
          "hover:-translate-y-px",
          isDeleting && "opacity-50 pointer-events-none",
        )}
      >
        {/* Header: Type icon + Actions */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-muted/70 flex items-center justify-center shrink-0">
              <TypeIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </div>
            {typeConfig && (
              <span className="text-[11px] font-medium text-muted-foreground tracking-wide uppercase">
                {typeConfig.shortLabel}
              </span>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.preventDefault()}>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity rounded-full"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem asChild>
                <Link href={editorUrl}>
                  <PenLine className="h-3.5 w-3.5 mr-2" />
                  Open Editor
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleViewDetails}>
                <ExternalLink className="h-3.5 w-3.5 mr-2" />
                View Details
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleDelete}
                className="text-destructive focus:text-destructive"
                disabled={isDeleting}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                {isDeleting ? "Deleting…" : "Delete"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Title */}
        <h3 className="font-instrument text-lg tracking-tight leading-snug line-clamp-2 mb-4 group-hover:text-foreground transition-colors">
          {project.topic}
        </h3>

        {/* Footer: Meta row */}
        <div className="flex items-center justify-between pt-3 border-t border-border/40">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3" aria-hidden="true" />
              {paperCount}
            </span>
            <span className="text-border">·</span>
            <span>{formatDate(project.created_at)}</span>
          </div>

          <Badge
            variant="outline"
            className={cn(
              "text-[10px] px-2 py-0 h-5 font-medium border rounded-full",
              getStatusColor(project.status)
            )}
          >
            {getStatusLabel(project.status)}
          </Badge>
        </div>

        {/* Hover arrow indicator */}
        <div className="absolute top-5 right-14 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-x-[-4px] group-hover:translate-x-0">
          <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      </div>
    </Link>
  )
}
