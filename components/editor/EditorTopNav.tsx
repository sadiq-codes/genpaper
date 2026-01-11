'use client'

import { Button } from '@/components/ui/button'
import { SidebarTrigger } from '@/components/ui/sidebar'
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
  Check,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface EditorTopNavProps {
  onExport: (format: 'pdf' | 'docx' | 'latex') => void
  onPublish?: () => void
  onHistory?: () => void
  onSettings?: () => void
  projectTitle?: string
  saveStatus?: 'saved' | 'saving' | 'unsaved'
}

export function EditorTopNav({
  onExport,
  onPublish,
  onHistory,
  onSettings,
  projectTitle = 'Untitled Document',
  saveStatus = 'saved',
}: EditorTopNavProps) {
  return (
    <header className="h-14 border-b border-border/50 flex items-center justify-between px-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {/* Left: Sidebar Trigger + Title */}
      <div className="flex items-center gap-2">
        {/* Sidebar Trigger - Opens app navigation */}
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <SidebarTrigger className="h-8 w-8" />
            </TooltipTrigger>
            <TooltipContent side="bottom">Navigation (B)</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <div className="h-6 w-px bg-border mx-1" />

        {/* Project Title */}
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground hidden sm:block" />
          <span className="font-medium text-sm text-foreground/80 truncate max-w-[150px] sm:max-w-[250px]">
            {projectTitle}
          </span>
        </div>

        {/* Save Status Indicator */}
        <div className={cn(
          "flex items-center gap-1.5 text-xs transition-opacity",
          saveStatus === 'saved' ? "text-muted-foreground" : "text-foreground"
        )}>
          {saveStatus === 'saving' && (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="hidden sm:inline">Saving...</span>
            </>
          )}
          {saveStatus === 'saved' && (
            <>
              <Check className="h-3 w-3 text-green-600" />
              <span className="hidden sm:inline">Saved</span>
            </>
          )}
          {saveStatus === 'unsaved' && (
            <span className="text-amber-600">Unsaved changes</span>
          )}
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1">
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
                className="h-8 w-8"
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
