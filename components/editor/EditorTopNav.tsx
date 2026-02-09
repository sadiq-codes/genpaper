'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
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
  projectId?: string
  onTitleChange?: (newTitle: string) => void
  saveStatus?: 'saved' | 'saving' | 'unsaved'
}

export function EditorTopNav({
  onExport,
  onPublish,
  onHistory,
  onSettings,
  projectTitle = 'Untitled Document',
  projectId,
  onTitleChange,
  saveStatus = 'saved',
}: EditorTopNavProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(projectTitle)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync editValue when projectTitle changes externally
  useEffect(() => {
    if (!isEditing) setEditValue(projectTitle)
  }, [projectTitle, isEditing])

  const handleStartEditing = useCallback(() => {
    if (!onTitleChange) return
    setEditValue(projectTitle)
    setIsEditing(true)
    // Focus after render
    requestAnimationFrame(() => inputRef.current?.select())
  }, [projectTitle, onTitleChange])

  const handleSave = useCallback(() => {
    const trimmed = editValue.trim()
    setIsEditing(false)
    if (trimmed && trimmed !== projectTitle) {
      onTitleChange?.(trimmed)
    }
  }, [editValue, projectTitle, onTitleChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      setIsEditing(false)
      setEditValue(projectTitle)
    }
  }, [handleSave, projectTitle])

  return (
    <header className="h-12 border-b border-border/30 flex items-center justify-between px-4 bg-background">
      {/* Left: Sidebar Trigger + Title */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        {/* Sidebar Trigger */}
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <SidebarTrigger className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground shrink-0" />
            </TooltipTrigger>
            <TooltipContent side="bottom">Navigation (B)</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <div className="h-4 w-px bg-border/40 shrink-0" />

        {/* Project Title — larger, wider */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isEditing ? (
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              className="font-instrument text-base tracking-tight text-foreground bg-transparent border-b border-foreground/20 outline-none w-full max-w-[500px] px-0 py-0"
              aria-label="Project title"
              autoFocus
            />
          ) : (
            <button
              onClick={handleStartEditing}
              className="font-instrument text-base tracking-tight text-foreground/80 truncate max-w-[500px] hover:text-foreground transition-colors cursor-text text-left"
              title="Click to rename"
            >
              {projectTitle}
            </button>
          )}

          {/* Save Status — inline next to title */}
          <div className={cn(
            "flex items-center gap-1 text-[11px] shrink-0 transition-opacity",
            saveStatus === 'saved' ? "text-muted-foreground/50" : "text-foreground"
          )}>
          {saveStatus === 'saving' && (
            <>
              <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden="true" />
              <span className="hidden sm:inline">Saving…</span>
            </>
          )}
          {saveStatus === 'saved' && (
            <>
              <Check className="h-2.5 w-2.5" aria-hidden="true" />
              <span className="hidden sm:inline">Saved</span>
            </>
          )}
          {saveStatus === 'unsaved' && (
            <span className="text-amber-500 dark:text-amber-400">Unsaved</span>
          )}
          </div>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-0.5">
        <TooltipProvider delayDuration={300}>
          {/* Export */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground" aria-label="Export">
                    <Upload className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Export</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => onExport('pdf')}>
                <File className="mr-2 h-3.5 w-3.5" />
                Export as PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExport('docx')}>
                <FileText className="mr-2 h-3.5 w-3.5" />
                Export as DOCX
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExport('latex')}>
                <FileCode className="mr-2 h-3.5 w-3.5" />
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
                className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                onClick={onPublish}
                aria-label="Publish"
              >
                <Globe className="h-3.5 w-3.5" />
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
                className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                onClick={onHistory}
                aria-label="History"
              >
                <Clock className="h-3.5 w-3.5" />
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
                className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                onClick={onSettings}
                aria-label="Settings"
              >
                <Settings className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </header>
  )
}
