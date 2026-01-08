'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { 
  MoreHorizontal, 
  FileText, 
  MessageSquare, 
  PenLine, 
  Trash2,
  ExternalLink,
  Clock
} from 'lucide-react'
import { deleteProjectAction } from '@/components/dashboard/actions'
import { cn } from '@/lib/utils'
import type { ResearchProjectWithLatestVersion } from '@/types/simplified'

interface ProjectCardProps {
  project: ResearchProjectWithLatestVersion
  paperCount?: number
  claimCount?: number
}

export function ProjectCard({ project, paperCount = 0, claimCount = 0 }: ProjectCardProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isDeleting, setIsDeleting] = useState(false)

  const handleClick = () => {
    router.push(`/editor/${project.id}`)
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsDeleting(true)
    startTransition(async () => {
      const result = await deleteProjectAction(project.id)
      if (!result.success) {
        console.error('Failed to delete project:', result.error)
      }
      setIsDeleting(false)
    })
  }

  const handleViewDetails = (e: React.MouseEvent) => {
    e.stopPropagation()
    router.push(`/projects/${project.id}`)
  }

  const getStatusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
      case 'complete':
        return 'default'
      case 'failed':
        return 'destructive'
      case 'generating':
        return 'secondary'
      default:
        return 'outline'
    }
  }

  const getStatusLabel = (status: string): string => {
    switch (status) {
      case 'complete':
        return 'Complete'
      case 'failed':
        return 'Failed'
      case 'generating':
        return 'In Progress'
      case 'draft':
        return 'Draft'
      default:
        return status
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffTime = Math.abs(now.getTime() - date.getTime())
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    
    return new Intl.DateTimeFormat('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    }).format(date)
  }

  return (
    <Card 
      className={cn(
        "group cursor-pointer transition-all duration-200",
        "hover:shadow-md hover:border-primary/20",
        "relative overflow-hidden",
        isDeleting && "opacity-50 pointer-events-none"
      )}
      onClick={handleClick}
    >
      {/* Subtle gradient accent on hover */}
      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-primary/0 via-primary/50 to-primary/0 opacity-0 group-hover:opacity-100 transition-opacity" />

      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base font-medium line-clamp-2 leading-snug">
            {project.topic}
          </CardTitle>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleClick() }}>
                <PenLine className="h-4 w-4 mr-2" />
                Open Editor
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleViewDetails}>
                <ExternalLink className="h-4 w-4 mr-2" />
                View Details
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onClick={handleDelete}
                className="text-destructive focus:text-destructive"
                disabled={isDeleting}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {isDeleting ? 'Deleting...' : 'Delete'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      
      <CardContent className="pt-0 space-y-3">
        {/* Stats row */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            {paperCount} {paperCount === 1 ? 'paper' : 'papers'}
          </span>
          <span className="flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            {claimCount} {claimCount === 1 ? 'claim' : 'claims'}
          </span>
        </div>

        {/* Footer row */}
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {formatDate(project.created_at)}
          </span>
          <Badge variant={getStatusVariant(project.status)} className="text-xs">
            {getStatusLabel(project.status)}
          </Badge>
        </div>
      </CardContent>
    </Card>
  )
}
