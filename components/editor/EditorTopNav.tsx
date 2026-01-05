'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { 
  Upload, 
  Globe, 
  Clock, 
  Settings,
  FileText,
  FileCode,
  File,
} from 'lucide-react'

interface EditorTopNavProps {
  onExport: (format: 'pdf' | 'docx' | 'latex') => void
  onPublish?: () => void
  onHistory?: () => void
  onSettings?: () => void
  projectTitle?: string
}

export function EditorTopNav({
  onExport,
  onPublish,
  onHistory,
  onSettings,
  projectTitle = 'Untitled Document',
}: EditorTopNavProps) {
  return (
    <header className="h-14 border-b-2 border-foreground/10 flex items-center justify-between px-4">
      {/* Left: Logo */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-md border-2 border-foreground/20 flex items-center justify-center bg-foreground/5">
          <FileText className="w-4 h-4 text-foreground/60" />
        </div>
        <span className="font-medium text-sm text-foreground/80 truncate max-w-[200px]">
          {projectTitle}
        </span>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        <TooltipProvider delayDuration={300}>
          {/* Export Dropdown */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Upload className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Export</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onExport('pdf')}>
                <File className="mr-2 h-4 w-4" />
                Export as PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExport('docx')}>
                <FileText className="mr-2 h-4 w-4" />
                Export as DOCX
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExport('latex')}>
                <FileCode className="mr-2 h-4 w-4" />
                Export as LaTeX
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Publish */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8"
                onClick={onPublish}
              >
                <Globe className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Publish</TooltipContent>
          </Tooltip>

          {/* History */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 rounded-full"
                onClick={onHistory}
              >
                <Clock className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>History</TooltipContent>
          </Tooltip>

          {/* Settings */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8"
                onClick={onSettings}
              >
                <Settings className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </header>
  )
}
